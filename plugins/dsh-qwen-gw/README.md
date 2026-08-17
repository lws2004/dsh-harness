# dsh-qwen-gw

阿里云 Token Plan(MaaS) DeepSeek 网关适配器。

复用官方 DeepSeek 适配器内核(强制 `role:"system"`、
`thinking/reasoning_effort` 参数、SSE 解析/翻译),注册独立 provider
路由,baseURL 指向阿里云 Token Plan 端点,模型 id 用阿里云官方
`deepseek-v4-flash-0731` / `deepseek-v4-pro-0813`。

## 安装

```bash
dsh plugin --profile <name> add /path/to/dsh-harness/plugins/dsh-qwen-gw
```

## 配置

在 cordis.patch.yml 中配置:

```yaml
- insert:
    - id: qwen-gw
      name: dsh-qwen-gw
      config:
        reasoningEffort: "off"
```

默认思考策略(`reasoningEffort`):
- `"off"` → 显式发 `thinking: {type:"disabled"}`
- `"high"` → 发 `thinking: {type:"enabled"}` + `reasoning_effort:"high"`
- `"max"` → 同上,effort "max"

## 官方规范参考

- [打包与安装插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) — Bundle/Profile 机制
- [插件配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md) — Config schema 定义
- [Cordis 入门](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md) — 核心概念与事件模式
