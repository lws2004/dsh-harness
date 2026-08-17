# dsh-agent-policy

全局 Agent 行为策略:向所有会话注入「纯文本模型能力边界」与「指令优先级」的独立 systemPrompt section。

## 工作原理

在 host 平面注册独立命名的 `systemPrompt` section(`user:agent-policy`),注入两条策略:
1. **能力边界**: 当前路由是纯文本模型,不能直接接收图片,识图走 ocr.py
2. **指令优先级**: 技能摘要优先于通用工具指引

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `text` | (见源码) | 注入的策略文本 |
| `order` | 2 | section 顺序 |

## 官方规范参考

- [打包与安装插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) — Bundle/Profile 机制
- [插件配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md) — Config schema 定义
- [Cordis 入门](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md) — 核心概念与事件模式
