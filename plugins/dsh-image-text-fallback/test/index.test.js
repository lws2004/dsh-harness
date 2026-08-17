import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

import { apply, name, inject, Config } from "../lib/index.js";

/** 构造一个最小可注入的 ctx 替身 */
function fakeCtx() {
  const resolvedModelInfo = { inputModalities: ["text"] };
  const llm = {
    async resolveModelInfo() {
      return { ...resolvedModelInfo };
    },
    async prepareCall(callConfig) {
      return {
        ...callConfig,
        stream: async function* (options) {
          yield { downgraded: options };
        },
      };
    },
    setResolved(info) {
      Object.assign(resolvedModelInfo, info);
    },
  };
  return {
    llm,
    attachments: {
      async readImage(attachment) {
        return { data: Buffer.from("fake-image-bytes-" + attachment.attachmentId) };
      },
    },
    logger: () => ({
      info: () => {},
      warn: () => {},
    }),
  };
}

test("导出形状符合 cordis 插件规范", () => {
  assert.equal(name, "image-text-fallback");
  assert.deepEqual(inject, ["llm", "attachments"]);
  assert.ok(Config, "应导出 zod Config schema");
  assert.equal(typeof apply, "function");
});

test("apply 后 llm.resolveModelInfo 被包装:纯文本模型 inputModalities 置 undefined", async () => {
  const ctx = fakeCtx();
  apply(ctx, {
    enabled: true,
    ocrScript: "/nonexistent/ocr.py",
    venvPython: "python3",
    timeoutMs: 1000,
    maxConcurrent: 2,
    cacheCap: 200,
    textOnlyProviders: [],
  });
  const info = await ctx.llm.resolveModelInfo("deepseek-official", "deepseek-v4-flash-0731");
  assert.equal(info.inputModalities, undefined, "纯文本模型应放行图片提交检查");
});

test("apply 后视觉模型(inputModalities 含 image)不被降级", async () => {
  const ctx = fakeCtx();
  ctx.llm.setResolved({ inputModalities: ["text", "image"] });
  apply(ctx, {
    enabled: true,
    ocrScript: "/nonexistent/ocr.py",
    venvPython: "python3",
    timeoutMs: 1000,
    maxConcurrent: 2,
    cacheCap: 200,
    textOnlyProviders: [],
  });
  const info = await ctx.llm.resolveModelInfo("vision-provider", "some-vl-model");
  assert.deepEqual(info.inputModalities, ["text", "image"], "视觉模型原样放行");
});

test("enabled=false 时不注入任何包装", () => {
  const ctx = fakeCtx();
  const orig = ctx.llm.resolveModelInfo;
  apply(ctx, {
    enabled: false,
    ocrScript: "/nonexistent/ocr.py",
    venvPython: "python3",
    timeoutMs: 1000,
    maxConcurrent: 2,
    cacheCap: 200,
    textOnlyProviders: [],
  });
  assert.equal(ctx.llm.resolveModelInfo, orig, "未启用时不应包装");
});

test("集成:真实 ocr.py 在纯文本路由下把 image 块降级为文本", async (t) => {
  // 用真实 ocr.py(本机已安装),生成一张纯色小图,验证降级链路(内容哈希缓存 + 替换)
  const dir = await mkdtemp(join(tmpdir(), "dsh-test-"));
  const pngPath = join(dir, "tiny.png");
  // 1x1 红色 PNG
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(pngPath, pngBytes);
  t.after(() => rm(dir, { recursive: true, force: true }).catch(() => {}));

  // 生成一个"附件",交由真实 ocr.py 转录
  const ctx = fakeCtx();
  ctx.attachments.readImage = async () => ({ data: pngBytes });

  // 使用真实 ocr.py 路径
  const ocrScript = "/Users/lanws/.ocr-tool/ocr.py";
  const venvPython = "/Users/lanws/.ocr-tool/venv/bin/python";
  let available = true;
  try {
    await execFileAsync(venvPython, [ocrScript, "--check"], { timeout: 10000 });
  } catch {
    available = false;
  }
  if (!available) {
    t.skip("ocr.py 不可用,跳过集成测试");
    return;
  }

  apply(ctx, {
    enabled: true,
    ocrScript,
    venvPython,
    timeoutMs: 60000,
    maxConcurrent: 2,
    cacheCap: 200,
    textOnlyProviders: [],
  });

  // 走 prepareCall 主路径:构造带 image 块的消息
  const attachment = { attachmentId: "att-1", mediaType: "image/png" };
  const options = {
    provider: "deepseek-official",
    model: "deepseek-v4-flash-0731",
    messages: [
      { role: "user", content: [{ type: "image", attachment }] },
    ],
  };

  const call = await ctx.llm.prepareCall({ provider: options.provider, model: options.model });
  const chunks = [];
  for await (const chunk of call.stream(options)) chunks.push(chunk);
  const { downgraded } = chunks[0];

  assert.ok(Array.isArray(downgraded.messages), "消息数组存在");
  const content = downgraded.messages[0].content;
  const textBlock = content.find((b) => b.type === "text");
  assert.ok(textBlock, "image 块被替换为 text 块");
  assert.match(textBlock.text, /【图片内容】|OCR|未检测到文字|失败/, "包含 OCR 结果或占位");
});