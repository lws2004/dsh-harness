/**
 * image-text-fallback — DeepSeek Harness 插件
 *
 * 两层拦截,实现 hermes 式"检测到图片先 OCR":
 *
 * 1. 包装 llm.resolveModelInfo:纯文本路由(如 deepseek-official)的
 *    inputModalities 置为 undefined(unknown),让 host 的图片提交检查
 *    (`Model does not support image input`)放行——否则带图消息在提交时
 *    就被拒绝,根本到不了请求边界。
 * 2. 包装 llm.prepareCall/stream:请求前扫描 image 块,读附件调本地
 *    ocr.py 转成文本块替换,deepseek 适配器不再抛 UNSUPPORTED_CONTENT。
 *
 * 视觉路由(inputModalities 含 "image" 的模型)原样放行。
 *
 * v3:不再依赖 provider 白名单,按模型 inputModalities 自动识别——
 * 不含 "image"([text] 或未知)即视为纯文本并降级,任何适配器
 * (deepseek-official / pi-ai 等)新模型开箱即用,无需配置。
 *
 * v2 增强(参考 dsh-vision-proxy 的工程实践):
 * - 内容哈希缓存:按图片字节 SHA-256 缓存转译结果(进程内,cap 默认 200),
 *   同一张图跨会话/换附件 id 也只 OCR 一次;只缓存成功,失败不缓存可重试。
 * - 递归处理 tool-result 内嵌图片:工具返回的截图也能被转译,不止顶层消息块。
 * - 结构化日志:每张图记录 engine/tier/耗时/置信度与失败原因,便于排障。
 * - 可操作的失败占位:区分"图中无可转录文字"与"本地视觉服务异常",给出指引。
 *
 * v4:多引擎路由(engineRoute)。
 * - auto(默认):本地 ocr.py 优先;转录失败/置信非 high/交叉复核缺失/转录
 *   子任务失败/交叉复核缺失)时,自动升级 modlens analyze(云端视觉证据)
 *   并注入【图片解析】,无需用户切换任何模型选项。
 * - local:仅本地;modlens:仅云端。
 * - 引擎失败冷却(engineCooldownMs):某引擎整体不可用时冷却期内不反复尝试。
 * - modlens CLI 自动探测 profile 安装点,或显式配置 modlensCli。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";

const execFileAsync = promisify(execFile);

export const name = "image-text-fallback";

export const inject = ["llm", "attachments"];

export const Config = z.object({
  enabled: z.boolean().default(true),
  
  // 模型配置(从 DSH 读取)
  ocrProvider: z.string().default(""),      // OCR provider 名称(空=自动检测)
  describeProvider: z.string().default(""), // 图像描述 provider(空=自动检测)
  
  // 高级配置(一般不需要)
  modelDir: z.string().default(""),        // 模型目录(空=默认路径)
  timeoutMs: z.number().min(1000).default(120000),
  maxConcurrent: z.number().min(1).max(8).default(2),
  cacheCap: z.number().min(1).max(1000).default(200),
  textOnlyProviders: z.array(z.string()).default([]),

  // ---- v4 多引擎路由 ----
  // 引擎路由策略:
  //   auto    = 本地 OCR 优先;失败/低置信/复核缺失时自动升级 modlens(默认)
  //   local   = 只用本地 OCR,不调用 modlens
  //   modlens = 全部交给 modlens(注意:不再有本地免费通道)
  engineRoute: z.union([z.const("auto"), z.const("local"), z.const("modlens")]).default("auto"),
  // modlens CLI 入口(空=自动探测 ~/.dsh/profiles/*/node_modules/@liustack/modlens)
  modlensCli: z.string().default(""),
  // 显式指定 modlens 视觉 provider(空=用 ~/.modlens/config.json 的 selected provider)
  modlensProvider: z.string().default(""),
  // modlens 单次超时(ms)
  modlensTimeoutMs: z.number().min(1000).default(180000),
  // 引擎失败冷却(ms):某个引擎整体不可用时,冷却期内不再反复尝试
  engineCooldownMs: z.number().min(0).default(60000),

  // 本地 OCR 可执行文件(空=默认 ~/.ocr-tool)
  ocrScript: z.string().default(""),
  venvPython: z.string().default(""),
});

const MEDIA_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};


/**
 * 自动检测 DSH 配置的 provider
 * @param ctx - Cordis 上下文
 * @param type - 'ocr' 或 'describe'
 * @returns provider 名称或 null
 */
function detectProvider(ctx, type) {
  // 从 ctx.llm 获取已配置的 providers
  if (!ctx.llm || !ctx.llm.providers) return null;
  
  const providers = ctx.llm.providers;
  
  // 查找匹配的 provider
  for (const [name, config] of Object.entries(providers)) {
    const models = config.models || [];
    
    // OCR 模型特征
    if (type === 'ocr') {
      const hasOcrModel = models.some(m => 
        m.toLowerCase().includes('ocr') || 
        m.toLowerCase().includes('paddleocr')
      );
      if (hasOcrModel) return name;
    }
    
    // 描述模型特征
    if (type === 'describe') {
      const hasDescModel = models.some(m => 
        m.toLowerCase().includes('vl') || 
        m.toLowerCase().includes('vision') ||
        m.toLowerCase().includes('minicpm')
      );
      if (hasDescModel) return name;
    }
  }
  
  return null;
}

export function apply(ctx, config) {
  // 自动检测 DSH 配置的模型
  const ocrProvider = config.ocrProvider || detectProvider(ctx, 'ocr');
  const describeProvider = config.describeProvider || detectProvider(ctx, 'describe');
  
  // 提示用户配置(如果未检测到)
  if (!ocrProvider) {
    ctx.logger('image-text-fallback').warn(
      '未检测到 OCR provider,将使用本地 ocr.py。' +
      '如需使用远程 OCR 服务,请在 DSH 中配置 provider。'
    );
  }
  if (!describeProvider) {
    ctx.logger('image-text-fallback').info(
      '未检测到图像描述 provider,将禁用图像描述功能。' +
      '如需启用,请在 DSH 中配置 provider。'
    );
  }

  if (!config.enabled) return;
  const llm = ctx.llm;
  const logger = ctx.logger("image-text-fallback");

  /** 图片内容哈希缓存:sha256 -> {ok, text, engine, tier, elapsed_ms, confidence} */
  const cache = new Map();
  /** attachmentId -> sha256 key:同一附件重复出现在消息里时,免去重复 readImage 算哈希 */
  const idToKey = new Map();
  const stats = { total: 0, hits: 0, failures: 0, modlens: 0 };

  /** 执行一次 ocr.py,返回解析后的 JSON 信封;任何异常向外抛。 */
  async function runOcr(file, signal, extraArgs) {
    const py = config.venvPython || process.env.HOME + "/.ocr-tool/venv/bin/python";
    const script = config.ocrScript || process.env.HOME + "/.ocr-tool/ocr.py";
    const { stdout } = await execFileAsync(
      py,
      [script, file, "--mode", "json", ...extraArgs],
      { timeout: config.timeoutMs, maxBuffer: 64 * 1024 * 1024, signal },
    );
    // ocr.py --mode json 是 indent=2 的多行 JSON,必须整段解析,不能只取最后一行
    return JSON.parse(stdout.trim());
  }

  // ---- v4 多引擎路由:本地 OCR 优先,失败/低置信升级 modlens ----

  /** 引擎级失败冷却:该引擎整体不可用时,冷却期内不再反复尝试(modlens 的 cooldown 设计) */
  const engineCooldown = new Map();
  function markCooldown(engine, error) {
    engineCooldown.set(engine, {
      until: Date.now() + config.engineCooldownMs,
      error,
    });
    logger.warn(`引擎降级: ${engine} 进入冷却 ${config.engineCooldownMs}ms (${error})`);
  }
  function inCooldown(engine) {
    const c = engineCooldown.get(engine);
    if (!c) return null;
    if (Date.now() >= c.until) {
      engineCooldown.delete(engine);
      return null;
    }
    return c;
  }

  /** modlens CLI 探测(进程内只探测一次):显式配置 > 本机各 profile 安装点 */
  let modlensCliCached = null;
  let modlensCliProbed = false;
  function findModlensCli() {
    if (modlensCliProbed) return modlensCliCached;
    modlensCliProbed = true;
    if (config.modlensCli) {
      modlensCliCached = config.modlensCli;
      return modlensCliCached;
    }
    const home = process.env.HOME || "";
    const profilesDir = join(home, ".dsh", "profiles");
    const candidates = [];
    try {
      for (const name of readdirSync(profilesDir)) {
        // 扁平布局
        candidates.push(
          join(profilesDir, name, "node_modules", "@liustack", "modlens", "dist", "main.js"),
        );
        // pnpm 严格布局
        const pnpmDir = join(profilesDir, name, "node_modules", ".pnpm");
        if (existsSync(pnpmDir)) {
          for (const dir of readdirSync(pnpmDir)) {
            if (dir.startsWith("@liustack+modlens@")) {
              candidates.push(
                join(pnpmDir, dir, "node_modules", "@liustack", "modlens", "dist", "main.js"),
              );
            }
          }
        }
      }
    } catch { /* profiles 目录不可读 → 放弃自动探测 */ }
    for (const c of candidates) {
      if (existsSync(c)) {
        modlensCliCached = c;
        return c;
      }
    }
    modlensCliCached = null;
    return null;
  }

  /** 执行一次 modlens analyze,把结构化证据压成注入文本 */
  async function runModlensAttempt(file, signal) {
    const cli = findModlensCli();
    if (!cli) {
      return { ok: false, error: "未找到 modlens CLI(安装 @liustack/modlens 或配置 modlensCli)", engine: "modlens-cli" };
    }
    const args = ["analyze", "-i", file];
    if (config.modlensProvider) args.push("-p", config.modlensProvider);
    let stdout;
    try {
      ({ stdout } = await execFileAsync(
        process.execPath,
        [cli, ...args],
        { timeout: config.modlensTimeoutMs, maxBuffer: 64 * 1024 * 1024, signal },
      ));
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error), engine: "modlens" };
    }
    let envelope;
    try {
      envelope = JSON.parse(stdout.trim());
    } catch {
      return { ok: false, error: "modlens 输出不是合法 JSON", engine: "modlens" };
    }
    if (!envelope?.result) {
      return { ok: false, error: envelope?.error ?? "modlens 返回结构异常", engine: "modlens" };
    }
    stats.modlens += 1;
    return {
      ok: true,
      text: buildEvidenceText(envelope.result),
      engine: "modlens",
      provider: envelope.provider ?? null,
      elapsed_ms: envelope.meta?.elapsed_ms ?? null,
      confidence: "high",
      evidence: true,
    };
  }

  /** 本地转录单次尝试(含 balanced→accurate 自愈),返回统一 entry 形状;
   *  只做 OCR 转录(RapidOCR/PaddleOCR-VL),不再请求 --both 的画面描述——
   *  MiniCPM 描述已从主链路退场,"看懂"类任务统一交给 modlens 升级通道。 */
  async function localAttempt(file, signal) {
    let out;
    try {
      out = await runOcr(file, signal, []);
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error), engine: "local-exception" };
    }
    let attempt = "balanced";
    if (!(out && out.ok)) {
      try {
        out = await runOcr(file, signal, ["--profile", "accurate"]);
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error), engine: "local-exception" };
      }
      attempt = "accurate";
    }
    if (out && out.ok) {
      return {
        ok: true,
        text: String(out.result ?? ""),
        engine: out.metadata?.engine ?? out.tool_used ?? "?",
        tier: out.metadata?.used_tier,
        elapsed_ms: out.metadata?.elapsed_ms,
        confidence: out.confidence,
        // ocr.py 交叉验证:要求 VLM 复核但 VLM 不可用 → 回退快速通道结果
        crossCheckFailed: out.metadata?.cross_check_failed === true,
        crossCheckError: out.metadata?.cross_check_error,
      };
    }
    const err = out?.metadata?.error ?? out?.error ?? "unknown";
    return {
      ok: false,
      error: err,
      engine: out?.metadata?.engine ?? "none",
      attempt,
    };
  }

  /** 统一收尾:成功进缓存并记日志;失败只记失败数,不缓存(可重试) */
  function finishEntry(entry, key) {
    if (entry.ok) {
      if (cache.size >= config.cacheCap) cache.delete(cache.keys().next().value);
      cache.set(key, entry);
      logger.info(
        `转译 ok: engine=${entry.engine} ${entry.elapsed_ms ?? "?"}ms ` +
          `conf=${entry.confidence ?? "?"} hash=${key.slice(0, 12)}`,
      );
    } else {
      stats.failures += 1;
      logger.warn(`转译失败: engine=${entry.engine} (${entry.error})`);
    }
    return entry;
  }

  /** 根据引擎路由决策,判断是否要把本地结果升级给 modlens */
  function shouldUpgrade(local, route, modlensCooled) {
    if (route === "local") return false;
    if (route === "modlens") return !modlensCooled;
    // auto:本地转录成功、置信 high、复核未丢失 → 直接用本地,不烧配额
    if (
      local.ok &&
      local.confidence === "high" &&
      !local.crossCheckFailed
    ) {
      return false;
    }
    return !modlensCooled;
  }

  /**
   * 转译一张图片(带哈希缓存)。返回 {ok:true, text, engine, ...} 或 {ok:false, error, engine}。
   * 成功结果进缓存;失败不缓存,下次请求可重试。
   */
  async function transcribe(attachment, signal) {
    let key = idToKey.get(attachment.attachmentId);
    if (key !== undefined) {
      const hit = cache.get(key);
      if (hit !== undefined) {
        stats.hits += 1;
        return hit;
      }
    }
    const stored = await ctx.attachments.readImage(attachment, signal);
    key = `sha256:${createHash("sha256").update(stored.data).digest("hex")}`;
    idToKey.set(attachment.attachmentId, key);
    const hit = cache.get(key);
    if (hit !== undefined) {
      stats.hits += 1;
      return hit;
    }

    const ext = MEDIA_EXT[attachment.mediaType] ?? "png";
    const dir = await mkdtemp(join(tmpdir(), "dsh-ocr-"));
    const file = join(dir, `img-${randomUUID()}.${ext}`);
    await writeFile(file, stored.data);
    try {
      // v4 引擎链:本地优先;按 engineRoute 与本地结果质量决定是否升级 modlens
      const local = await localAttempt(file, signal);
      const route = config.engineRoute;
      const cooled = inCooldown("modlens");
      if (!shouldUpgrade(local, route, Boolean(cooled))) {
        // 纯本地模式,或 modlens 冷却中:直接用本地结果(失败也走占位,不再额外尝试)
        return finishEntry(local, key);
      }
      // 升级尝试 modlens;失败则冷却该引擎,冷却期内退回本地结果
      const remote = await runModlensAttempt(file, signal);
      if (remote.ok) return finishEntry(remote, key);
      markCooldown("modlens", remote.error);
      return finishEntry(route === "modlens" ? remote : local, key);
    } catch (error) {
      stats.failures += 1;
      logger.warn(`转译异常: ${String(error?.message ?? error)}`);
      return { ok: false, error: String(error?.message ?? error), engine: "exception" };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** 失败占位文本:区分"无可转录文字"与"视觉服务异常",给出可操作指引 */
  function failurePlaceholder(r) {
    const err = r?.error ?? "unknown";
    const text = String(err);
    if (r?.engine === "none" && /no text detected/i.test(text)) {
      return "(OCR 未检测到文字:图片可能没有可转录文本,可直接让模型描述画面内容)";
    }
    if (r?.engine === "modlens-cli") {
      return `(本地 OCR 失败且未找到 modlens CLI: 安装 @liustack/modlens 或配置 modlensCli 启用云端升级)`;
    }
    if (/omlx|tier2|minicpm|vlm/i.test(text) && /fail|error|refused|timeout|connect/i.test(text)) {
      return `(本地视觉服务异常: ${err} — 可运行 ~/.ocr-tool/ocr.py --check 排查)`;
    }
    return `(图片解析失败: ${err})`;
  }

  /** 注入文本:modlens 证据与本地 OCR 结果用不同标签,便于模型理解证据来源 */
  function buildInjected(r) {
    let label;
    if (r.engine === "modlens") {
      label = "【图片解析】(云端视觉证据,可据此回答)";
    } else if (r.crossCheckFailed) {
      label = "【图片内容】(⚠ 本地 VLM 复核不可用,以下为 OCR 快速通道结果,个别字符可能不准确)";
    } else {
      label = "【图片内容】";
    }
    return `${label}\n${r.text}`;
  }

  /** 递归收集 content 中的 image 块(含 tool-result 内嵌),用于统计与去重 */
  function collectImageBlocks(content, out) {
    for (const block of content) {
      if (block?.type === "image" && block.attachment) out.push(block);
      else if (block?.type === "tool-result" && Array.isArray(block?.content)) {
        collectImageBlocks(block.content, out);
      }
    }
  }

  /** 递归把 image 块替换为文本块;tool-result 结构保持不变,无变化时返回原引用 */
  function replaceImageBlocks(content, textFor) {
    let changed = false;
    const next = content.map((block) => {
      if (block.type === "image" && block.attachment) {
        changed = true;
        return { type: "text", text: textFor(block.attachment.attachmentId) };
      }
      if (block.type === "tool-result" && Array.isArray(block.content)) {
        const inner = replaceImageBlocks(block.content, textFor);
        if (inner !== block.content) {
          changed = true;
          return { ...block, content: inner };
        }
      }
      return block;
    });
    return changed ? next : content;
  }

  async function downgrade(options) {
    if (!options || !Array.isArray(options.messages)) return options;
    const targets = [];
    for (const msg of options.messages) {
      if (!Array.isArray(msg?.content)) continue;
      collectImageBlocks(msg.content, targets);
    }
    if (targets.length === 0) return options;

    // 视觉路由:模型显式声明接受 image → 原样放行
    let supportsImage = false;
    try {
      const info = await llm.resolveModelInfo(
        options.provider,
        options.model,
        options.signal,
      );
      supportsImage =
        Array.isArray(info?.inputModalities) &&
        info.inputModalities.includes("image");
    } catch {
      /* 能力未知 → 按纯文本路由降级,保守不破坏请求 */
    }
    if (supportsImage) return options;

    // 按 attachmentId 去重后逐图转译(带小并发保护)
    const textByAttachment = new Map();
    const unique = new Map();
    for (const block of targets) {
      unique.set(block.attachment.attachmentId, block.attachment);
    }
    const entries = [...unique.entries()];
    for (let i = 0; i < entries.length; i += config.maxConcurrent) {
      const batch = entries.slice(i, i + config.maxConcurrent);
      await Promise.all(
        batch.map(async ([id, ref]) => {
          try {
            stats.total += 1;
            const r = await transcribe(ref, options.signal);
            textByAttachment.set(id, r.ok ? buildInjected(r) : failurePlaceholder(r));
          } catch (error) {
            textByAttachment.set(
              id,
              `(图片解析失败: ${String(error?.message ?? error)})`,
            );
          }
        }),
      );
    }

    const messages = options.messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;
      const content = replaceImageBlocks(
        msg.content,
        (id) => textByAttachment.get(id) ?? "(图片内容提取失败)",
      );
      return { ...msg, content };
    });
    logger.info(
      `provider=${options.provider} model=${options.model}: ` +
        `${targets.length} 张图片降级为文本 ` +
        `(unique=${entries.length} total=${stats.total} hits=${stats.hits} ` +
        `failures=${stats.failures} modlens=${stats.modlens})`,
    );
    return { ...options, messages };
  }

  // 1) 模型能力自动识别:凡 inputModalities 不含 "image"(纯文本 [text] 或未知)
  //    的路由,能力上报为 undefined(unknown),放行 host 的图片提交检查
  //    (Model does not support image input)——否则带图消息在提交时就被拒绝,
  //    根本到不了请求边界。pi-ai / deepseek 适配器对未声明 input 的模型默认
  //    报 ["text"],因此任何纯文本模型(deepseek-v4-flash-0731 等)无需配置即可自动降级。
  //    真视觉模型(inputModalities 含 "image")原样放行,不受影响。
  const origResolveModelInfo = llm.resolveModelInfo?.bind(llm);
  if (typeof origResolveModelInfo === "function") {
    llm.resolveModelInfo = async (provider, model, signal) => {
      const info = await origResolveModelInfo(provider, model, signal);
      if (
        info &&
        (config.textOnlyProviders.includes(provider) ||
          !Array.isArray(info.inputModalities) ||
          !info.inputModalities.includes("image"))
      ) {
        return { ...info, inputModalities: undefined };
      }
      return info;
    };
  }

  // 2a) 主路径:agent-loop 用 prepareCall(...).stream(request)
  // ⚠️ 关键坑:dsh-llm 的 prepareCall 返回 Object.freeze() 的对象,stream 是只读属性,
  // 原地赋值 `call.stream = ...` 会抛 Cannot assign to read only property 'stream'。
  // 必须展开成新对象再替换 stream;callConfigEquals 只比 provider/model 等路由字段,
  // 不比 messages,所以 downgrade 改消息不会触发校验失败。
  const origPrepareCall = llm.prepareCall?.bind(llm);
  if (typeof origPrepareCall === "function") {
    llm.prepareCall = async (callConfig, signal) => {
      const call = await origPrepareCall(callConfig, signal);
      const origStream = call?.stream;
      if (typeof origStream === "function") {
        return {
          ...call,
          stream: async function* (options) {
            yield* origStream.call(call, await downgrade(options));
          },
        };
      }
      return call;
    };
  }

  // 2b) 兜底:llm.stream 直接调用方(会话标题、子代理、一次性请求)
  const origStream = llm.stream?.bind(llm);
  if (typeof origStream === "function") {
    llm.stream = async function* (options) {
      yield* origStream(await downgrade(options));
    };
  }

  logger.info(
    `已挂载:纯文本模型(自动识别)图片自动降级为文本 ` +
      `(route=${config.engineRoute}, cacheCap=${config.cacheCap}, ` +
      `maxConcurrent=${config.maxConcurrent}, timeoutMs=${config.timeoutMs}, ` +
      `modlens=${findModlensCli() ?? "未找到"})`,
  );
}

/**
 * 把 modlens analyze 的结构化证据压成注入文本(模块级纯函数,便于单测)。
 * 裁剪策略:摘要 + 完整转录 + 非文本布局区域(图表/表格等)+ 关系三元组,
 * 避免与转录重复、控制 token 量的同时保留"可回答性"。
 */
export function buildEvidenceText(ev) {
  const parts = [];
  if (ev?.summary) parts.push(`【总结】${ev.summary}`);

  const ft = ev?.ocr?.full_text;
  if (ft) parts.push(`【完整转录】\n${ft}`);

  const regions = Array.isArray(ev?.layout?.regions) ? ev.layout.regions : [];
  const struct = regions.filter(
    (r) =>
      r && r.text &&
      !["text", "paragraph", "title"].includes(String(r.type ?? "")),
  );
  if (struct.length > 0) {
    parts.push(
      "【布局要点】\n" +
        struct
          .slice(0, 12)
          .map((r) => `[${r.reading_order ?? r.type ?? "?"}] ${String(r.text).trim()}`)
          .join("\n"),
    );
  }

  const rels = Array.isArray(ev?.semantics?.relations) ? ev.semantics.relations : [];
  if (rels.length > 0) {
    parts.push(
      "【关系】" +
        rels
          .slice(0, 12)
          .map((r) => `${r.subject ?? "?"} → ${r.predicate ?? "?"} → ${r.object ?? "?"}`)
          .join("; "),
    );
  }

  return parts.join("\n\n");
}