#!/usr/bin/env bash
# dsh-ocr-tool 一键安装脚本
# 自动安装 Python venv + OCR 依赖
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OCR_DIR="$HOME/.ocr-tool"
VENV_DIR="$OCR_DIR/venv"

echo "== dsh-ocr-tool 安装 =="

# 检查 Python
if ! command -v python3 &>/dev/null; then
  echo '错误: 未找到 python3,请先安装 Python 3.8+'
  exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo "Python 版本: $PYTHON_VERSION"

# 创建安装目录
mkdir -p "$OCR_DIR"

# 复制 ocr.py
cp "$SCRIPT_DIR/bin/ocr.py" "$OCR_DIR/ocr.py"
chmod +x "$OCR_DIR/ocr.py"
echo "已复制 ocr.py 到 $OCR_DIR"

# 创建或重建 venv
if [ ! -d "$VENV_DIR" ] || [ ! -f "$VENV_DIR/bin/pip" ]; then
  echo "创建 Python venv..."
  python3 -m venv "$VENV_DIR"
fi

# 安装依赖
echo "安装 OCR 依赖..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet rapidocr-onnxruntime

# 验证安装
echo "验证安装..."
if "$VENV_DIR/bin/python" -c "from rapidocr_onnxruntime import RapidOCR; print('RapidOCR OK')" 2>/dev/null; then
  echo "✓ RapidOCR 安装成功"
else
  echo "✗ RapidOCR 安装失败"
  exit 1
fi

# 创建符号链接(可选)
if [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
  ln -sf "$OCR_DIR/ocr.py" /usr/local/bin/dsh-ocr 2>/dev/null || true
  echo "✓ 已创建 /usr/local/bin/dsh-ocr 符号链接"
fi

echo "
=== 安装完成 ==="
OCR 工具: $OCR_DIR/ocr.py
Python venv: $VENV_DIR

使用方法:
  $VENV_DIR/bin/python $OCR_DIR/ocr.py <图片路径> --mode json
  或直接调用: ~/.ocr-tool/ocr.py <图片路径> --mode json