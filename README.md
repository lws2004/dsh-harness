# dsh-harness 本地插件仓库

本机 DeepSeek Harness 自研插件源码的**统一管理仓库**。

## 布局

```
dsh-harness/
├── README.md
├── plugins/
│   ├── dsh-image-text-fallback/   # 图片自动降级(OCR 转文本)
│   ├── dsh-language-zh/           # 全局中文语言指令
│   ├── dsh-agent-policy/          # 全局 Agent 行为策略
│   ├── dsh-hindsight-adapt/       # Hindsight 薄适配层(file 插件)
│   └── dsh-qwen-gw/               # 阿里云 Token Plan 网关(file 插件)
└── scripts/                       # verify-install.sh:安装完整性校验
```

每个插件是**独立 npm 项目**(自己的 package.json / README / test)。

## 安装方式(正规,fine)

插件通过 pnpm 的 `link:` 协议安装到 DSH profile
(`~/.dsh/profiles/<name>/package.json` 的 `dependencies` 中声明
`"<pkg>": "link:/Users/lanws/workspace/dsh-harness/plugins/<pkg>"`),
由 pnpm 建立符号链接——**单一权威源码,修改即时生效**,
不再需要手工拷贝副本。

## 环境

- 本地 web 版 profile: `~/.dsh/profiles/web`
- Oh-DSH Desktop: `~/Library/Application Support/Oh-DSH-Desktop/dsh/profiles/desktop`

改插件后需重启对应环境生效。

## 当前状态(2026-08-17)

- **样板项目已提交**: `plugins/dsh-image-text-fallback`(官方 cordis 插件规范,
  README + 类型声明 + node 测试 5/5 通过)。
- **正规安装已落地**: web/desktop profile 均以 pnpm `link:` 协议安装三个 npm 包
  形态插件(重装 profile 后 `pnpm install` 即可恢复链接)。
- 校验: `bash scripts/verify-install.sh`。
- `dsh-hindsight-adapt` / `dsh-qwen-gw` 为 file 插件(经 `cordis.patch.yml` 的
  `file://` 引用),源码同样在本仓库 `plugins/` 下。
## 官方规范参考

本仓库的插件组织与发布方式对齐 [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)。以下为核心参考文档:

| 文档 | 说明 | 链接 |
|---|---|---|
| **打包与安装插件** | Bundle/Profile 机制、`dsh plugin add`、层顺序 | [publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) |
| **插件配置** | Config schema、Schemastery、HMR | [config.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md) |
| **Cordis 入门** | 五个核心概念、分发模式、Waterfall | [cordis-primer.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md) |
| **Cordis 教程** | 入门→配置→组合→进入 Harness | [cordis-tutorial/](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/cordis-tutorial) |
| **扩展插件形态** | Tool/Hook/UI/Protocol 示例 | [extension-cookbook.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md) |
| **开发指南** | TypeScript 布局、构建、测试、CI | [development.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/development.md) |
| **架构文档** | 整体架构、模块图、发布流程 | [architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) |

### 核心约定速查

- **Bundle 组合包**: `package.json` 声明 `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`, 自带 `cordis.patch.yml` 按包名引用自身。
- **Profile manifest**: `dsh.profile.bundles` 按顺序列出组合包, cordis.layer 逐层合成。
- **安装命令**: `dsh plugin --profile <name> add <path>` — 自动维护 dependencies + bundles。
- **层顺序**: bundles(按顺序) → profile cordis.patch.yml → home cordis.patch.yml → `--patch` overlays。
- **版本语义**: `0.x.y` 表示未稳定 API, `1.0.0` 标记稳定发布。

