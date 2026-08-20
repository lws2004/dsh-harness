# DSH 自动更新检测与一键更新

## 目录结构

本目录是**源码**,通过 `install.sh` 部署到运行位置:

```
scripts/update-check/          ← 源码(本目录,git 管理)
├── check-update.sh            检测脚本
├── update-dsh                 一键更新命令
├── install.sh                 部署脚本
└── README.md                  本文档

~/.dsh/update-check/           ← 运行时(不纳入 git)
├── check-update.sh            从源码部署
├── update-available           标志文件:存在 = 有新版本(自动维护)
├── previous-version           更新前版本号(回滚用,自动维护)
├── update-state               状态文件:LOCAL/LATEST/NEXT/AHEAD/NEXT_AVAILABLE
│                               (AHEAD=1 本地领先 latest;NEXT_AVAILABLE=1 有 next 预发布比本地新)
└── logs/
    └── update-check.log       检测历史日志

~/.local/bin/update-dsh        ← 一键更新命令(从源码部署)
```

## 快速开始

```bash
# 部署(安装 crontab + 复制文件)
bash scripts/update-check/install.sh

# 卸载(移除 crontab,保留文件)
bash scripts/update-check/install.sh --uninstall
```

## 工作原理

### check-update.sh

1. **本地版本检测**: 优先 `node require()` 读 `package.json`,fallback 到 `bun pm ls -g`
2. **npm 版本检测**: `npm view <pkg> dist-tags.latest / dist-tags.next`(绕过可能损坏的默认 cache),同时感知 latest 稳定版与 next 预发布版
3. **语义化版本比较**: `ver_num()` 将 semver(含 rc) 转成数值比较,正式版 > rc 同版本号
4. **输出**: 有稳定版更新 → 写入 `update-available` 标志;本地已领先 npm latest(如装过 next 预发布)→ `update-state` 标记 ahead=1;next 预发布比本地新 → 标记 next_available=1;两者皆非 → ahead=0
5. **日志**: 每次检测追加 `[OK]/[UPDATE]/[AHEAD]/[PRERELEASE]/[WARN]/[skip]` 到 `logs/update-check.log`

### update-dsh

| 命令 | 说明 |
|---|---|
| `update-dsh` | 检查 + 确认后更新到最新稳定版(latest)(推荐) |
| `update-dsh --check` | 仅检查是否有新版本 |
| `update-dsh --force` | 跳过确认,直接更新到最新稳定版 |
| `update-dsh --next` | 更新到 next 预发布版(比 latest 新时) |
| `update-dsh --rollback` | 回滚到更新前的版本 |

> **防降级**: 本地版本已不低于目标版本时(例如已装 next 预发布版),`--force`/无参数 会提示"无需更新",不会盲目重装降级到 latest。

> **显示逻辑**: 本地已领先 npm latest 时,`--check` 显示"最新版本: <本地版>(领先 npm 最新版 <latest>)";本地停在 latest 而 next 更新时,额外提示"⭐ 有 next 预发布版可用:`update-dsh --next`"。

## 已知问题

### npm cache 损坏

老版本 npm 在 `~/.npm/_cacache/tmp/` 中创建 root 所有的文件,导致后续 `npm view` 写缓存时 EPERM 失败。

**临时绕过**: 脚本使用 `--cache /tmp/dsh-npm-cache-$UID` 指向临时目录。

**永久修复**: 运行 `sudo chown -R $(id -u):$(id -g) ~/.npm` 修复默认 cache 权限。

## 维护

- **修改检测时间**: 编辑 crontab `crontab -e`,格式 `分 时 * * *`
- **停用检测**: `bash scripts/update-check/install.sh --uninstall`
- **修改后重新部署**: `bash scripts/update-check/install.sh`
