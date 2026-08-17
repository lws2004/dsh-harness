import test from "node:test";
import assert from "node:assert/strict";
import { apply, name, inject, Config } from "../lib/index.js";

test("导出形状符合 cordis 插件规范", () => {
  assert.equal(name, "agent-policy");
  assert.deepEqual(inject, ["systemPrompt"]);
  assert.ok(Config, "应导出 zod Config schema");
  assert.equal(typeof apply, "function");
});

test("apply 后 ctx.systemPrompt.section 被调用", async () => {
  let sectionCalled = false;
  const ctx = {
    effect: (fn) => { fn(); },
    systemPrompt: {
      section: (opts) => {
        sectionCalled = true;
        assert.equal(opts.name, "user:agent-policy");
        assert.ok(opts.text.includes("能力边界"), "应包含能力边界策略");
        assert.ok(opts.text.includes("指令优先级"), "应包含指令优先级策略");
      },
    },
  };
  const cfg = Config({});
  apply(ctx, cfg);
  assert.ok(sectionCalled, "systemPrompt.section 应被调用");
});

test("Config 默认值正确", () => {
  const cfg = Config({});
  assert.ok(cfg.text.length > 100, "默认策略文本不应为空");
  assert.equal(cfg.order, 2);
});