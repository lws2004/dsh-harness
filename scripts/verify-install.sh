#!/usr/bin/env bash
# 校验 dsh-harness 插件在各 profile 的正规安装完整性
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGINS=("dsh-image-text-fallback" "dsh-language-zh" "dsh-agent-policy")
PASS=0; FAIL=0

check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  OK $desc"; PASS=$((PASS+1))
  else
    echo "  FAIL $desc"; FAIL=$((FAIL+1))
  fi
}

echo "== 源码权威副本 =="
for p in "${PLUGINS[@]}"; do
  check "plugins/$p/package.json" test -f "$ROOT/plugins/$p/package.json"
  check "plugins/$p/lib/index.js" test -f "$ROOT/plugins/$p/lib/index.js"
done

echo "== web profile (pnpm link:) =="
for p in "${PLUGINS[@]}"; do
  check "web: $p 已声明" grep -q "\"$p\"" /Users/lanws/.dsh/profiles/web/package.json
  check "web: $p 链接可达" test -e "/Users/lanws/.dsh/profiles/node_modules/$p"
done

echo "== desktop profile (pnpm link:) =="
for p in "${PLUGINS[@]}"; do
  check "desktop: $p 已声明" grep -q "\"$p\"" "/Users/lanws/Library/Application Support/Oh-DSH-Desktop/dsh/profiles/desktop/package.json"
  check "desktop: $p 链接可达" test -e "/Users/lanws/Library/Application Support/Oh-DSH-Desktop/dsh/profiles/node_modules/$p"
done

echo "== 运行解析(web profile) =="
cd /Users/lanws/.dsh/profiles/web
for p in "${PLUGINS[@]}"; do
  check "web: import $p" node --input-type=module -e "import('$p').then(()=>process.exit(0)).catch(()=>process.exit(1))"
done

echo
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] || exit 1
