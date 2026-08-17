# Changelog

本仓库内各插件的版本演进记录,遵循 [Keep a Changelog](https://keepachangelog.com/) 风格。
每个插件的 `version` 独立演进;发布时打 `v<version>` 格式的 git tag
(如 `v1.0.0`),tag 命名 = 仓库根所有插件共用一个版本号(当前)。


## [0.2.0] - 2026-08-17

### Changed
- **dsh-image-text-fallback**: 重大更新
  - 移除 Python 依赖,使用 TS OCR 引擎(onnxruntime-node)
  - 自动检测 DSH 已配置的模型(provider)
  - 未配置时提示用户配置
  - 模型文件自动下载到 `~/.dsh/models/ocr/`
  - 版本: 0.1.2 → 0.2.0

### Removed
- **dsh-ocr-tool**: 已删除(功能集成到 dsh-image-text-fallback)

## [0.1.0] - 2026-08-17

### Added

- 仓库初始化,5 个本地插件源码统一迁入 `plugins/` 管理。
- **dsh-image-text-fallback v0.1.0** — 首个按官方 cordis 插件规范构建的
  样板项目:完整 `package.json`(`exports`/`peerDependencies`/`dependencies`)、
  `index.d.ts` 类型声明、`README.md`、node 测试 5/5 通过
  (含真实 ocr.py 集成测试)。
- **正规安装方式落地** — web / desktop profile 均以 pnpm `link:` 协议
  安装 npm 包形态插件(替代手工拷贝副本);新增 `scripts/verify-install.sh`
  完整性校验(21/21 通过)。
- 其余 4 个插件(`dsh-language-zh` / `dsh-agent-policy` / `dsh-hindsight-adapt` /
  `dsh-qwen-gw`)源码已入仓;全部插件统一 `v0.1.0` 起始(0.x 语义版本,未稳定 API 前不升 1.0)。
- 新增 README「官方规范参考」章节:核心文档链接 + Bundle/Profile 约定速查。

- README 新增「使用方式」章节: Git 安装 / 本地安装 / npm 发布 / tarball 分发。