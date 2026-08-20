/**
 * dsh-language-zh — 全局语言指令
 *
 * 在 host 平面注册一个独立命名的 systemPrompt section(`user:language`),
 * 要求所有会话始终用中文思考和回复。
 *
 * 为什么用独立 section 而不是覆盖全局 persona:preset 自带的 persona
 * (如 cordis/standard 的 persona 行)会 shadow 全局 `deployment:persona`
 * section;独立命名的 section 不受遮蔽,对每个 preset 的每个会话都生效。
 */
import z from "@deepseek-ai/schemastery";

export const name = "language-zh";

export const inject = ["systemPrompt"];

export const Config = z.object({
  text: z.string().default(
    "始终使用中文进行思考和回复;包括内部推理过程也必须使用中文,除非用户明确要求使用其他语言。",
  ),
  order: z.number().default(1),
});

export function apply(ctx, config) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: "user:language",
    order: config.order,
    text: config.text,
  }), "language-zh.section()");
}
