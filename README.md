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
│   ├── dsh-adapt/                 # Hindsight 薄适配层(file 插件)
│   └── dsh-qwen-gw/               # 阿里云 Token Plan 网关(file 插件)
└── scripts/                       # 安装/校验脚本(待建)
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
