// ═══════════════════════════════════════════════════════════════════
// dsh-qwen-gw — 阿里云 Token Plan(MaaS) DeepSeek 网关适配器插件
//
// 背景:
//   pi-ai 适配器(qwen-token-plan-cn)对 reasoning 模型会把 system prompt
//   提升为 developer 角色,而阿里云 MaaS 端点不接受 developer → 400;
//   且 pi-ai 无法在这个链路上发送显式的 thinking 开关参数(off 只是省略)。
//   本插件复用官方 DeepSeek 适配器内核(强制 role:"system"、
//   thinking/reasoning_effort 参数、SSE 解析/翻译),注册独立 provider
//   路由,baseURL 指向阿里云 Token Plan 端点,模型 id 用阿里云官方
//   deepseek-v4-flash-0731 / deepseek-v4-pro-0813。
//
// 装配:
//   ~/.dsh/cordis.patch.yml 末尾 insert 本文件,重启 DSH 生效。
//
// 默认思考策略(reasoningEffort):
//   - "off"   → 显式发 thinking: {type:"disabled"}(阿里云默认思考,此值可关)
//   - "high"  → 发 thinking: {type:"enabled"} + reasoning_effort:"high"
//   - "max"   → 同上,effort "max"
//   - 删除该行 → 不发任何 thinking 参数(等同阿里云默认行为,最保守)
// ═══════════════════════════════════════════════════════════════════
import { DeepSeekAdapter, resolveAdapterOptions } from "@deepseek-ai/dsh-llm-deepseek";
import { getOrCreateAnonymousUserId } from "@deepseek-ai/dsh-anonymous-user-id";
import { assertUsableApiKey, LlmError } from "@deepseek-ai/dsh-llm";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";

export const name = "dsh-qwen-gw";
export const inject = ["llm"];

/** 独立 provider 路由,不与 qwen-token-plan-cn / deepseek-official 冲突。 */
const PROVIDER = "qwen-token-plan-gw";
/** 阿里云 MaaS Token Plan(北京)OpenAI 兼容端点。 */
const BASE_URL = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";
/** 凭证引用(用户 .credentials.yaml / Model 页面已有)。 */
const API_KEY_ENV = "QWEN_TOKEN_PLAN_CN_API_KEY";

export function apply(ctx) {
  const options = () =>
    resolveAdapterOptions(
      {
        baseURL: BASE_URL,
        apiKeyEnv: API_KEY_ENV,
        maxTokens: 384000,
        reasoningEffort: "off", // 默认关思考; 实测如 400 参照头注释调整
        models: [
          { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash", contextWindow: 1000000, maxTokens: 384000 },
          { id: "deepseek-v4-pro-0813", name: "DeepSeek V4 Pro", contextWindow: 1000000, maxTokens: 384000 },
        ],
      },
      undefined,
    );

  let userId;
  const resolveUserId = () => (userId ??= getOrCreateAnonymousUserId());

  const resolveApiKey = async (connection) => {
    const ref = connection.apiKeyEnv;
    const credentials = ctx.get("credentials");
    if (credentials !== void 0) {
      const hit = await credentials.resolve(ref);
      if (hit !== void 0) return assertUsableApiKey(hit.value, "dsh-qwen-gw", ref);
    }
    const ambient = launchEnvironmentOf(ctx).get(ref);
    if (ambient !== void 0 && ambient.value.length > 0) return assertUsableApiKey(ambient.value, "dsh-qwen-gw", ref);
    throw new LlmError(`dsh-qwen-gw: no API key for ${ref}`, "MISSING_CREDENTIAL");
  };

  const adapter = new DeepSeekAdapter({ options, resolveApiKey, resolveUserId });
  // 只注册适配器路由: 模型目录/Effort 菜单走 adapter.listModels, 不进入
  // Models 页"可配置 provider"列表(本插件参数写死, 无需 GUI 编辑入口)。
  ctx.llm.registerAdapter([PROVIDER], adapter);
}