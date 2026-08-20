#!/bin/bash
# DSH 自动更新检测脚本
# 对比本地已安装的 @deepseek-ai/dsh 版本与 npm 最新版本
# 发现新版本时:写入标志文件 update-available,记录旧版本到 previous-version,追加日志
# 本地版本高于 npm latest(如使用 next 预发布)时:写入 update-state 标记 ahead=1
#
# 本文件是源码,由 install.sh 部署到 ~/.dsh/update-check/check-update.sh
# 修改后需重新运行 install.sh 才会生效

PKG=@deepseek-ai/dsh
NODE=/Users/lanws/.local/bin/node
NPM=/Users/lanws/.local/bin/npm
BUN=/Users/lanws/.bun/bin/bun
BASE="$HOME/.dsh/update-check"
LOG="$BASE/logs/update-check.log"
FLAG="$BASE/update-available"
PREV="$BASE/previous-version"
STATE="$BASE/update-state"
PKG_JSON="$HOME/.bun/install/global/node_modules/$PKG/package.json"
# npm cache 绕过:~/.npm/_cacache 可能有 root-owned 文件(老版本 npm bug)导致 EPERM
NPM_CACHE="/tmp/dsh-npm-cache-$(id -u)"

# cron/launchd 环境 PATH 很保守且可能无 HOME;显式补全
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if [ -z "$HOME" ]; then HOME=/Users/lanws; fi

mkdir -p "$BASE/logs"

# ========== 本地版本检测 ==========
LOCAL="unknown"
if [ -f "$PKG_JSON" ]; then
  # 方法1: node require(可靠,只要 node 能跑)
  LOCAL=$("$NODE" -p "require('$PKG_JSON').version" 2>/dev/null)
fi
if [ -z "$LOCAL" ] || [ "$LOCAL" = "undefined" ] || [ "$LOCAL" = "unknown" ]; then
  # 方法2: bun pm ls -g
  if [ -x "$BUN" ]; then
    LOCAL=$("$BUN" pm ls -g 2>/dev/null | grep "$PKG@" | sed 's/.*@//;s/ .*//' | head -1)
  fi
fi
if [ -z "$LOCAL" ] || [ "$LOCAL" = "undefined" ]; then
  LOCAL="unknown"
fi

# ========== npm 版本检测(latest 稳定版 + next 预发布) ==========
LATEST=$("$NPM" view "$PKG" dist-tags.latest --cache "$NPM_CACHE" 2>/dev/null)
NEXT=$("$NPM" view "$PKG" dist-tags.next --cache "$NPM_CACHE" 2>/dev/null)
if [ -z "$LATEST" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') [skip] npm query failed (network?)" >> "$LOG"
  # npm 失败时保留现有 flag,避免误清
  exit 0
fi
[ -z "$NEXT" ] && NEXT="$LATEST"

echo "$(date '+%Y-%m-%d %H:%M:%S') local=$LOCAL latest=$LATEST next=${NEXT:-none}" >> "$LOG"

# ========== 版本比较 ==========
# 辅助函数:把 semver(含 rc)转成可比较的数值
# 例: 0.1.0-rc.7 → 000001.000000.000007
ver_num() {
  local v="${1#v}"  # 去掉可能的 v 前缀
  local base="${v%%-*}"     # rc 之前的部分
  local rc=""
  if [[ "$v" == *-* ]]; then
    rc="${v#*-}"             # rc.7
  fi
  local major minor patch
  IFS='.' read -r major minor patch <<< "$base"
  patch="${patch:-0}"
  # rc 部分:rc.7 → 7,rc → 0
  local rc_num=0
  if [[ "$rc" =~ ^rc\.([0-9]+)$ ]]; then
    rc_num="${BASH_REMATCH[1]}"
  elif [[ "$rc" == "rc" ]]; then
    rc_num=0
  fi
  # 输出: major*10^12 + minor*10^6 + patch*1000 + rc_num(无rc时+999表示正式版优先)
  printf '%d%06d%06d%04d' "$major" "$minor" "$patch" "$rc_num"
}

# rc 版本排序:正式版 > rc(同主版本号时)
# 0.1.0 (正式) > 0.1.0-rc.7 > 0.1.0-rc.1
# 0.1.1 (正式) > 0.1.0 (正式)
LOCAL_NUM=$(ver_num "$LOCAL")
LATEST_NUM=$(ver_num "$LATEST")
NEXT_NUM=$(ver_num "$NEXT")

# 状态文件写入:$1=AHEAD(本地领先 latest) $2=NEXT_AVAILABLE(next 比本地新)
write_state() {
  {
    echo "LOCAL=$LOCAL"
    echo "LATEST=$LATEST"
    echo "NEXT=$NEXT"
    echo "AHEAD=$1"
    echo "NEXT_AVAILABLE=$2"
  } > "$STATE"
}

if [ "$LOCAL" = "unknown" ]; then
  # 无法检测本地版本,保守写 flag 让用户知道有新版
  echo "$LOCAL" > "$PREV"
  {
    echo "DSH 有新版本可用!"
    echo "当前版本: $LOCAL (检测失败,建议手动确认)"
    echo "最新版本: $LATEST"
    if [ "$NEXT_NUM" -gt "$LATEST_NUM" ] 2>/dev/null; then
      echo "预发布版: $NEXT (next,可用 update-dsh --next 更新)"
    fi
    echo "检测时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "更新方式: update-dsh   (一键更新)"
  } > "$FLAG"
  write_state 0 0
  echo "$(date '+%Y-%m-%d %H:%M:%S') [WARN] local=unknown, latest=$LATEST, flag set conservatively" >> "$LOG"
elif [ "$LATEST_NUM" -gt "$LOCAL_NUM" ] 2>/dev/null; then
  # 有稳定版更新
  echo "$LOCAL" > "$PREV"
  {
    echo "DSH 有新版本可用!"
    echo "当前版本: $LOCAL"
    echo "最新版本: $LATEST"
    if [ "$NEXT_NUM" -gt "$LATEST_NUM" ] 2>/dev/null; then
      echo "预发布版: $NEXT (next,可用 update-dsh --next 更新)"
    fi
    echo "检测时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "更新方式: update-dsh   (一键更新)"
  } > "$FLAG"
  write_state 0 0
  echo "$(date '+%Y-%m-%d %H:%M:%S') [UPDATE] $LOCAL -> $LATEST" >> "$LOG"
else
  # 无稳定版更新:区分 本地领先 latest / next 预发布可更新 / 完全最新
  rm -f "$FLAG"
  AHEAD=0
  NEXT_AVAILABLE=0
  if [ "$LATEST_NUM" -lt "$LOCAL_NUM" ] 2>/dev/null; then
    AHEAD=1
  fi
  if [ "$NEXT_NUM" -gt "$LOCAL_NUM" ] 2>/dev/null; then
    NEXT_AVAILABLE=1
  fi
  write_state "$AHEAD" "$NEXT_AVAILABLE"
  if [ "$AHEAD" = "1" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [AHEAD] local=$LOCAL > latest=$LATEST (local is ahead of npm latest)" >> "$LOG"
  elif [ "$NEXT_AVAILABLE" = "1" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [PRERELEASE] next=$NEXT > local=$LOCAL (prerelease available via --next)" >> "$LOG"
  else
    echo "$(date '+%Y-%m-%d %H:%M:%S') [OK] local=$LOCAL, no update" >> "$LOG"
  fi
fi
