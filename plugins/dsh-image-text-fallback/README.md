# dsh-image-text-fallback

[![npm version](https://img.shields.io/npm/v/dsh-image-text-fallback?color=blue)](https://www.npmjs.com/package/dsh-image-text-fallback)
[![npm downloads](https://img.shields.io/npm/dm/dsh-image-text-fallback)](https://www.npmjs.com/package/dsh-image-text-fallback)

DeepSeek Harness 插件:图片自动降级(OCR 转文本)。

纯文本路由(如 deepseek-official)遇到 image 块时,自动调用本地
[ocr.py](ocr.py 由 `~/.ocr-tool` 提供)把图片转成文本块替换,避免
适配器抛 `UNSUPPORTED_CONTENT`;真正支持 image 输入的视觉模型原样放行。

v4 起支持**多引擎路由**:本地 OCR 优先,失败/低置信/转录缺失时自动升级
[modlens](https://github.com/liustack/modlens)(云端视觉证据)。贴图体验
保持"粘贴即用",且**不需要增加任何 vision 模型选项**。

## 安装

```bash
dsh plugin --profile web add dsh-image-text-fallback
```

发布前可从本地路径安装:`dsh plugin --profile web add ./plugins/dsh-image-text-fallback`;
装完重启 `dsh web` 生效。

> 使用 modlens 升级通道需本机安装 `@liustack/modlens`
> (`dsh plugin --profile web add @liustack/modlens`)并配置好视觉 provider
> (`~/.modlens/config.json`,如 gemini-api)。插件会自动探测入口,也可用
> `modlensCli` 显式指定。

## 工作原理

两层拦截,基于 Cordis 事件/服务包装:

1. **模型能力上报放行** — 包装 `llm.resolveModelInfo`:凡 `inputModalities`
   不含 "image" 的纯文本路由,能力上报为 `undefined`(unknown),放行 host
   的图片提交检查(`Model does not support image input`)——否则带图消息在
   提交时就被拒绝,根本到不了请求边界。
2. **请求前图片转译** — 包装 `llm.prepareCall/stream`:请求前扫描
   `options.messages` 中的 image 块(含 tool-result 内嵌、按 attachmentId
   去重、小并发保护),按 `engineRoute` 路由:

   - `auto`(默认):本地 OCR **转录**优先(纯转录,不再请求画面描述——本地
     MiniCPM 描述已从主链路退场);**转录失败 / 置信非 high / 交叉复核缺失**
     时,自动升级 `modlens analyze`(Gemini 结构证据:完整转录 + 布局要点 +
     关系),注入 `【图片解析】` 文本块。
   - `local`:只用本地 OCR,不调用 modlens。
   - `modlens`:全部交给 modlens(无本地免费通道)。

特性:

- **内容哈希缓存**(进程内):同一图片字节只转译一次(默认 cap 200),本地与
  modlens 结果共用,跨轮次不重复烧配额。
- **自愈重试**:本地默认档失败自动升级 `--profile accurate`(强制 PaddleOCR-VL)。
- **引擎失败冷却**:某引擎整体不可用时进入冷却(默认 60s),冷却期内不再
  反复尝试,避免每个请求重复失败等待。
- **交叉验证回退**:ocr.py 短文本交叉验证要求 VLM 复核但不可用时,返回
  OCR 快速通道结果并加 ⚠ 标注。
- **可操作失败占位**:区分「图中无可转录文字」「本地视觉服务异常」
  「modlens 未安装」等场景,给出指引。

## 开发依赖安装

确认依赖可用:

```bash
npm install   # 或 pnpm install / bun install
```

本地 `node_modules` 只需 `@deepseek-ai/schemastery`(运行时由 profile 的
peerDependencies 提供 `@deepseek-ai/cordis`)。

## 配置

通过 cordis 插件配置注入,默认值:

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 是否启用 |
| `ocrScript` | `~/.ocr-tool/ocr.py` | ocr.py 脚本路径 |
| `venvPython` | `~/.ocr-tool/venv/bin/python` | ocr.py 依赖的 venv Python |
| `timeoutMs` | `120000` | 单次 OCR 超时 |
| `maxConcurrent` | `2` | 最大并发 OCR 数(1–8) |
| `cacheCap` | `200` | 内容哈希缓存上限(1–1000) |
| `textOnlyProviders` | `[]` | 显式强制纯文本的 provider(默认空 = 按模型自动识别) |
| `engineRoute` | `"auto"` | 引擎路由:`auto` / `local` / `modlens` |
| `modlensCli` | `""` | modlens CLI 入口(空 = 自动探测 `~/.dsh/profiles/*/node_modules/@liustack/modlens`) |
| `modlensProvider` | `""` | 显式 modlens 视觉 provider(空 = 用 `~/.modlens/config.json` 选中项) |
| `modlensTimeoutMs` | `180000` | modlens 单次超时 |
| `engineCooldownMs` | `60000` | 引擎失败冷却(ms,0 = 禁用冷却) |

## 开发

```bash
npm test       # 运行测试(node --test)
```

源码在 `lib/index.js`,类型声明在 `lib/types/index.d.ts`。

## 维护提示

- 改插件后需**重启对应环境**(`dsh web` 或重启 Oh-DSH Desktop)才生效。
- 视觉路由(inputModalities 含 "image")不受本插件影响。

## 官方规范参考

- [打包与安装插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) — Bundle/Profile 机制
- [插件配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md) — Config schema 定义
- [Cordis 入门](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md) — 核心概念与事件模式