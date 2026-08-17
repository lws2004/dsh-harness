#!/usr/bin/env bash
# release.sh — 版本发布流程(对齐官方 release.yml 语义)
# 用法: bash scripts/release.sh <version>
# 示例: bash scripts/release.sh 0.2.0
set -eu

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo '用法: bash scripts/release.sh <version>'
  echo '示例: bash scripts/release.sh 0.2.0'
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== 1. 版本一致性检查 =="
ROOT_VER=$(node -p "require('./package.json').version")
if [ "$ROOT_VER" != "$VERSION" ]; then
  echo "  WARNING: 根 package.json version($ROOT_VER) 与目标($VERSION) 不一致"
fi
FAIL=0
for p in plugins/*/package.json; do
  PKG_VER=$(node -p "require('./$p').version")
  PKG_NAME=$(node -p "require('./$p').name")
  if [ "$PKG_VER" != "$VERSION" ]; then
    echo "  FAIL: $PKG_NAME version=$PKG_VER ≠ $VERSION"
    FAIL=1
  fi
done
if [ "$FAIL" -eq 1 ]; then
  echo '  请先统一版本号(修改各 plugins/*/package.json 和根 package.json)'
  exit 1
fi
echo '  所有包版本一致 ✓'

echo '== 2. 测试 =='
for p in plugins/*/; do
  if [ -d "${p}test" ]; then
    echo "  测试 $(basename $p)..."
    cd "$p" && node --test 'test/*.test.js' 2>&1 | tail -1 && cd "$ROOT"
  fi
done

echo '== 3. npm pack 校验 =='
for p in plugins/*/; do
  NAME=$(node -p "require('./$p/package.json').name")
  echo "  pack $NAME..."
  cd "$p" && npm pack --dry-run 2>&1 | grep -E 'Tarball|filename|unpacked' | head -3 && cd "$ROOT"
done

echo '== 4. 打 tag =='
TAG="v$VERSION"
if git tag -l | grep -q "^$TAG$"; then
  echo "  tag $TAG 已存在,跳过"
else
  git tag -a "$TAG" -m "Release $VERSION"
  echo "  已打 tag: $TAG"
fi

echo '== 5. 完成 =='
echo "版本 $VERSION 发布准备就绪".
echo "如需发布到 npm: git push origin $TAG && pnpm publish --recursive --tag $TAG"
