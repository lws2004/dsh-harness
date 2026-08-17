# dsh-ocr-tool

OCR 工具,为 dsh-image-text-fallback 提供图片识别能力。

## 功能

- **RapidOCR (Tier 1)**:轻量级 OCR,0.6-0.9s,适合清晰印刷文档
- **PaddleOCR-VL (Tier 2)**:高精度 VL 模型,3.7-4.1s,适合复杂场景

## 一键安装

```bash
# 方式 1:通过 npm 安装
npm install -g dsh-ocr-tool

# 方式 2:手动安装
git clone https://github.com/lws2004/dsh-harness.git
bash dsh-harness/plugins/dsh-ocr-tool/install.sh
```

安装完成后,OCR 工具位于 `~/.ocr-tool/`。

## 使用方法

```bash
# 基本用法
~/.ocr-tool/ocr.py <图片路径> --mode json

# 指定档位
~/.ocr-tool/ocr.py <图片路径> --profile fast      # 快速模式
~/.ocr-tool/ocr.py <图片路径> --profile accurate   # 精确模式

# 交叉验证
~/.ocr-tool/ocr.py <图片路径> --both
```

## 配合 dsh-image-text-fallback 使用

安装 dsh-ocr-tool 后,dsh-image-text-fallback 会自动检测并使用:

```bash
dsh plugin --profile web add dsh-image-text-fallback
```

如果 OCR 工具不在默认路径,可在 cordis.yml 中配置:

```yaml
- insert:
    - id: image-text-fallback
      name: dsh-image-text-fallback
      config:
        ocrScript: ~/.ocr-tool/ocr.py
        venvPython: ~/.ocr-tool/venv/bin/python
```
