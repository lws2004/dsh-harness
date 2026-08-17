/**
 * dsh-agent-policy — 全局 Agent 行为策略
 *
 * 在 host 平面注册一个独立命名的 systemPrompt section(`user:agent-policy`),
 * 向所有会话注入两条跨 preset 的策略:
 *
 * 1. 能力边界:当前路由(deepseek-official / deepseek-v4-flash)是纯文本
 *    模型,不能直接接收图片,read_image 不可用;贴图由 image-text-fallback
 *    在请求边界自动转文本,手动识图一律走 ~/.ocr-tool/ocr.py。
 * 2. 指令优先级:当系统提示词中的通用工具指引与已加载技能的摘要/说明中
 *    的工具偏好冲突时,以技能摘要/技能说明为准。
 *
 * 与 dsh-language-zh 同构:独立命名的 section 不受 preset persona 遮蔽,
 * 对每个 preset 的每个会话都生效。
 */
import z from "@deepseek-ai/schemastery";

export const name = "agent-policy";

export const inject = ["systemPrompt"];

export const Config = z.object({
  text: z.string().default(`## Agent 行为策略

**能力边界(纯文本模型)**:当前路由是纯文本模型,不能直接接收图片,不要使用 read_image 工具。用户贴图时,image-text-fallback 插件会在请求边界自动把图片转成「【图片内容 OCR】」文本块,无需额外处理。需要手动识图时,用 bash 调用 \`~/.ocr-tool/ocr.py <图片路径> --both --mode json\`(OCR 转录 + 语义描述双通道);图表/UI/照片侧重理解用 \`--describe\`,定位局部区域用 \`--roi x1,y1,x2,y2\`,清晰截图求快用 \`--profile fast\`。

**指令优先级**:当系统提示词中的通用工具指引(如"用 read 工具而非 cat"、"用 grep 工具而非 shell grep")与已加载技能的摘要或说明中的工具偏好(如 rtk、codebase-memory 建议的工具选择)冲突时,以技能摘要/技能说明为准。`),
  order: z.number().default(2),
});

export function apply(ctx, config) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: "user:agent-policy",
    order: config.order,
    text: config.text,
  }), "agent-policy.section()");
}
