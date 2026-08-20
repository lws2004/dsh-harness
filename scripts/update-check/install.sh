#!/bin/bash
# DSH 更新检测 — 部署脚本
# 将 scripts/update-check/ 下的源码部署到运行位置
#
# 用法:  bash scripts/update-check/install.sh [--uninstall]
#
# 部署目标:
#   ~/.dsh/update-check/check-update.sh   检测脚本(cron 调用)
#   ~/.dsh/update-check/logs/             运行时日志目录
#   ~/.local/bin/update-dsh               一键更新命令
#   crontab: 每天 09:00/21:00 自动检测
#
# --uninstall: 移除 crontab 条目,保留文件(不删除用户数据)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="$HOME/.dsh/update-check"
LOGS="$BASE/logs"
LOCAL_BIN="$HOME/.local/bin"
CRON_TAG="# DSH auto-update check"

GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; RESET='\033[0m'

info()  { echo -e "${GREEN}✓${RESET} $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET} $*"; }
error() { echo -e "${RED}✗${RESET} $*"; exit 1; }

# ---------- --uninstall ----------
if [ "${1:-}" = "--uninstall" ]; then
  echo "正在移除 crontab 条目..."
  crontab -l 2>/dev/null | grep -v "$CRON_TAG" | crontab - 2>/dev/null && \
    info "crontab 条目已移除" || warn "无 crontab 条目可移除"
  echo
  warn "文件保留在 $BASE 和 $LOCAL_BIN,如需彻底清理请手动删除"
  exit 0
fi

# ---------- 检查依赖 ----------
[ -f "$SCRIPT_DIR/check-update.sh" ] || error "缺少 $SCRIPT_DIR/check-update.sh"
[ -f "$SCRIPT_DIR/update-dsh" ]      || error "缺少 $SCRIPT_DIR/update-dsh"
[ -d "$LOCAL_BIN" ]                  || error "缺少 $LOCAL_BIN 目录"

# ---------- 部署文件 ----------
mkdir -p "$BASE" "$LOGS" "$LOCAL_BIN"

cp "$SCRIPT_DIR/check-update.sh" "$BASE/check-update.sh"
chmod +x "$BASE/check-update.sh"
info "check-update.sh → $BASE/check-update.sh"

cp "$SCRIPT_DIR/update-dsh" "$LOCAL_BIN/update-dsh"
chmod +x "$LOCAL_BIN/update-dsh"
info "update-dsh → $LOCAL_BIN/update-dsh"

# ---------- 设置 crontab ----------
CRON_LINE="0 9,21 * * * /bin/bash $BASE/check-update.sh $CRON_TAG"
EXISTING=$(crontab -l 2>/dev/null || true)

# 匹配有或无 tag 的旧条目(含 check-update.sh 路径即视为同类)
if echo "$EXISTING" | grep -qF "check-update.sh"; then
  NEW_CRON=$(echo "$EXISTING" | grep -v "check-update.sh")
  echo "$NEW_CRON
$CRON_LINE" | crontab -
  info "crontab 条目已更新"
else
  # 新增条目
  (echo "$EXISTING"; echo "$CRON_LINE") | crontab -
  info "crontab 条目已添加 (09:00 / 21:00)"
fi

# ---------- 确认 ----------
echo
echo "部署完成!"
echo "  检测脚本: $BASE/check-update.sh"
echo "  更新命令: $LOCAL_BIN/update-dsh"
echo "  定时任务: 每天 09:00 / 21:00"
echo
echo "立即测试:"
echo "  bash $BASE/check-update.sh"
echo "  $LOCAL_BIN/update-dsh --check"
