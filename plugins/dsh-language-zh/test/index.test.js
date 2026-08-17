import test from "node:test";
import assert from "node:assert/strict";
import { apply, name, inject, Config } from "../lib/index.js";

test("导出形状符合 cordis 插件规范", () => {
  assert.equal(name, "language-zh");
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
        assert.equal(opts.name, "user:language");
        assert.ok(opts.text.includes("中文"), "应包含中文指令");
      },
    },
  };
  apply(ctx, { text: "始终使用中文回复", order: 1 });
  assert.ok(sectionCalled, "systemPrompt.section 应被调用");
});

test("Config 默认值正确", () => {
  const cfg = Config({});
  assert.ok(cfg.text.includes("中文"));
  assert.equal(cfg.order, 1);
});
