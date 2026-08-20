#!/usr/bin/env bash
# 从 deepseek-harness 工作区启动 dsh web。
#
# 为什么需要它：DSH 会话的工作空间根 = 启动 dsh 时的当前目录（cwd）。
# 之前在空的 /Users/lanws/workspace/dsh-harness 里启动，导致所有新会话
# 都被绑定到那个空目录。从这个脚本启动可确保工作区正确落在代码仓库。
set -euo pipefail

# 切到脚本所在目录（即 deepseek-harness 仓库根）
cd "$(dirname "$0")"

exec dsh web