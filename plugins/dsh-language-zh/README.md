# dsh-language-zh

全局语言指令:为所有会话的 system prompt 注入「始终用中文思考和回复」的独立 section。

## 工作原理

在 host 平面注册独立命名的 `systemPrompt` section(`user:language`),不受 preset persona 遮蔽,
对每个 preset 的每个会话都生效。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `text` | "始终使用中文..." | 注入的指令文本 |
| `order` | 1 | section 顺序 |

## 官方规范参考

- [打包与安装插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) — Bundle/Profile 机制
- [插件配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md) — Config schema 定义
- [Cordis 入门](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md) — 核心概念与事件模式
