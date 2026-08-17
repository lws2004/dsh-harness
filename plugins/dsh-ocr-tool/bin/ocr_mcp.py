#!/usr/bin/env python3
"""MCP server:分层识图工具,供 Hermes agent 直接调用。

暴露工具:
  ocr_image    转录图片文字 (tier auto|1|2, 自动升级)
  ocr_describe 用 VLM 描述图片内容
  ocr_check    检查各引擎可用性

优化:ocr_image 的 RapidOCR 引擎在本进程内常驻(懒加载一次,后续复用),
避免每次调用 spawn 子进程 + 重新加载 ONNX 模型(实测省约50%端到端耗时)。
VLM 相关(describe/升级)仍走 omlx(经 CLI)。

stdout 只输出 MCP 协议(JSON-RPC over stdio),日志写 stderr。
"""

import json
import os
import subprocess
import sys
import threading
import time

# 核心 CLI 路径
OCR_PY = os.path.expanduser("~/.ocr-tool/ocr.py")
VENV_PYTHON = os.path.expanduser("~/.ocr-tool/venv/bin/python")

# 常驻 RapidOCR 引擎(进程内单例,懒加载)
_rapidocr_engine = None
_rapidocr_lock = threading.Lock()


def _get_rapidocr():
    """懒加载常驻 RapidOCR 引擎(仅首次调用加载模型)。"""
    global _rapidocr_engine
    if _rapidocr_engine is None:
        with _rapidocr_lock:
            if _rapidocr_engine is None:
                try:
                    from rapidocr_onnxruntime import RapidOCR
                    _rapidocr_engine = RapidOCR()
                except Exception as e:
                    _rapidocr_engine = None
                    raise RuntimeError(f"RapidOCR load failed: {e}")
    return _rapidocr_engine


def _rapidocr_inprocess(image: str) -> dict:
    """用常驻 RapidOCR 引擎识别(不 spawn 子进程,模型已加载)。"""
    t0 = time.time()
    engine = _get_rapidocr()
    res, elapse = engine(image)
    dt = int((time.time() - t0) * 1000)
    lines = [ln[1] for ln in (res or [])]
    conf = sum(ln[2] for ln in (res or [])) / len(res) if res else 0.0
    text = "\n".join(lines)
    return {"ok": True, "used_tier": 1, "engine": "rapidocr",
            "text": text, "elapsed_ms": dt, "chars": len(text),
            "lines": len(lines), "text_boxes": len(res or []),
            "engine_conf": conf, "resident": True}


def _run_ocr(args):
    """调用核心 CLI,返回 dict。适配统一 JSON 信封格式。"""
    cmd = [VENV_PYTHON, OCR_PY] + args
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "OCR timed out"}
    if r.returncode != 0:
        return {"ok": False, "error": (r.stderr or r.stdout).strip()[-500:]}
    # 核心 CLI 的 --mode json 输出统一信封在 stdout
    try:
        env = json.loads(r.stdout.strip())
    except json.JSONDecodeError:
        return {"ok": False, "error": "unparseable output: " + r.stdout[-300:]}
    # 信封 → 扁平 dict 兼容现有 handler
    meta = env.get("metadata", {}) or {}
    flat = {
        "ok": env.get("ok", False),
        "text": env.get("result", ""),
        "engine": env.get("tool_used"),
        "confidence": env.get("confidence"),
        "task_type": env.get("task_type"),
        "used_tier": meta.get("used_tier"),
        "elapsed_ms": meta.get("elapsed_ms"),
        "chars": meta.get("chars"),
        "lines": meta.get("lines"),
        "engine_conf": meta.get("engine_conf"),
        "roi": meta.get("roi"),
        "error": meta.get("error") or env.get("error"),
    }
    return flat


# ---------- 工具处理 ----------
TOOLS = [
    {
        "name": "ocr_image",
        "description": (
            "转录图片中的所有文字(OCR)。置信度驱动路由,准确度优先:"
            "清晰印刷文档用 RapidOCR(常驻,快),质量不足时自动升级 PaddleOCR-VL。"
            "检测到无文字(照片/场景)时返回错误并提示用 ocr_describe。"
            "可选 --profile fast|balanced|accurate 和 --roi 局部裁剪。"
            "注意:本工具只读文字,不理解画面语义(物体/场景);需要理解图片内容请用 ocr_describe。"
            "图片路径必须是 agent 当前可访问的绝对路径。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "image_path": {"type": "string",
                               "description": "图片绝对路径(png/jpg/webp 等)"},
                "profile": {"type": "string", "enum": ["fast", "balanced", "accurate"],
                            "default": "balanced",
                            "description": "fast=只用RapidOCR禁VLM(最快); "
                                           "balanced=默认; "
                                           "accurate=更积极用VLM(最准)"},
                "roi": {"type": "string",
                        "description": "可选局部裁剪区域 x1,y1,x2,y2(像素),只识别该区域"},
            },
            "required": ["image_path"],
        },
    },
    {
        "name": "ocr_describe",
        "description": (
            "用本地视觉模型(MiniCPM-V-4.6)理解图片内容:识别物体、场景、布局、"
            "颜色、上下文,给出语义描述。适合照片、示意图、需要'这是什么'的问题。"
            "也能转录文字但较慢且不逐字;需要精确文字请用 ocr_image。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "image_path": {"type": "string",
                               "description": "图片绝对路径"},
            },
            "required": ["image_path"],
        },
    },
    {
        "name": "ocr_check",
        "description": "检查各 OCR 引擎(RapidOCR、PaddleOCR-VL、MiniCPM-V)的可用性。",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def _ocr_image_resident(path, profile, roi):
    """用常驻 RapidOCR 引擎做快速识别,置信度不足时经 CLI 升级 PaddleOCR-VL。

    返回扁平 dict。
    """
    from PIL import Image
    # ROI 裁剪(用 venv python,因为本进程可能无 PIL 完整支持)
    target = path
    roi_note = None
    if roi:
        try:
            code = "import sys;from PIL import Image;im=Image.open(sys.argv[1]);w,h=im.size;" \
                   "x1,x2=max(0,min(int(sys.argv[2]),w)),max(0,min(int(sys.argv[4]),w));" \
                   "y1,y2=max(0,min(int(sys.argv[3]),h)),max(0,min(int(sys.argv[5]),h));" \
                   "im.crop((x1,y1,x2,y2)).save('/tmp/ocr_roi.png')"
            subprocess.run([VENV_PYTHON, "-c", code, path, str(roi[0]), str(roi[1]),
                            str(roi[2]), str(roi[3])], check=True, capture_output=True)
            target = "/tmp/ocr_roi.png"
            roi_note = f"roi={roi}"
        except Exception as e:
            return {"ok": False, "engine": "none",
                    "error": f"roi crop failed: {e}"}

    # 常驻 RapidOCR
    try:
        r1 = _rapidocr_inprocess(target)
    except Exception as e:
        r1 = {"ok": False, "engine": "rapidocr", "error": str(e)}
    r1["roi"] = roi_note

    # 置信度路由阈值(与 CLI 一致)
    from ocr import _blend_confidence, PROFILES, _text_quality
    p = PROFILES.get(profile, PROFILES["balanced"])
    if r1.get("ok"):
        blend = _blend_confidence(r1.get("engine_conf"), r1.get("text", ""))
        r1["confidence"] = blend
        if (blend["blended"] >= p["min_conf"]
                and blend["chars"] >= p["min_chars"]
                and not blend["garbage"]):
            return r1
        if r1.get("text_boxes", 0) == 0:
            return {"ok": False, "engine": "none",
                    "error": "no text detected (image may be a photo/scene; "
                             "use ocr_describe for semantic description)",
                    "attempts": [{"engine": "rapidocr", "resident": True}]}
    # 升级到 PaddleOCR-VL(经 CLI,omlx)
    if p["allow_vlm"]:
        cmd = [target, "--tier", "2", "--mode", "json"]
        r2 = _run_ocr(cmd)
        if r2.get("ok"):
            q = _text_quality(r2.get("text", ""))
            r2["confidence"] = {"blended": q["score"], "garbage": q["garbage"]}
            if not q["garbage"]:
                r2["roi"] = roi_note
                return r2
    return {"ok": False, "engine": "none",
            "error": "all engines failed or produced garbage (accuracy-first)"}


def handle_call(name, arguments):
    args = arguments or {}
    if name == "ocr_image":
        path = args.get("image_path", "")
        if not os.path.exists(path):
            return {"content": [{"type": "text",
                    "text": json.dumps({"ok": False,
                                        "error": f"file not found: {path}"})}]}
        profile = args.get("profile", "balanced")
        roi = None
        if args.get("roi"):
            try:
                roi = tuple(int(v) for v in args.get("roi").split(","))
                if len(roi) != 4:
                    roi = None
            except ValueError:
                roi = None
        try:
            res = _ocr_image_resident(path, profile, roi)
        except Exception as e:
            res = {"ok": False, "engine": "none", "error": str(e)}
        return {"content": [{"type": "text", "text": json.dumps(res,
                ensure_ascii=False)}]}
    if name == "ocr_describe":
        path = args.get("image_path", "")
        if not os.path.exists(path):
            return {"content": [{"type": "text",
                    "text": json.dumps({"ok": False,
                                        "error": f"file not found: {path}"})}]}
        res = _run_ocr([path, "--describe", "--mode", "json"])
        return {"content": [{"type": "text", "text": json.dumps(res,
                ensure_ascii=False)}]}
    if name == "ocr_check":
        res = _run_ocr(["--check"])
        return {"content": [{"type": "text", "text": json.dumps(res,
                ensure_ascii=False)}]}
    return {"content": [{"type": "text", "text": json.dumps(
            {"ok": False, "error": f"unknown tool: {name}"})}]}


def main():
    # stdio JSON-RPC 循环
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg_id = msg.get("id")
        method = msg.get("method")

        if method == "initialize":
            resp = {
                "jsonrpc": "2.0", "id": msg_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "ocr-tiered", "version": "1.0.0"},
                },
            }
        elif method == "tools/list":
            resp = {"jsonrpc": "2.0", "id": msg_id,
                    "result": {"tools": TOOLS}}
        elif method == "tools/call":
            name = msg.get("params", {}).get("name", "")
            arguments = msg.get("params", {}).get("arguments", {})
            result = handle_call(name, arguments)
            resp = {"jsonrpc": "2.0", "id": msg_id, "result": result}
        elif method == "notifications/initialized":
            continue  # 无响应
        elif method == "ping":
            resp = {"jsonrpc": "2.0", "id": msg_id, "result": {}}
        else:
            resp = {"jsonrpc": "2.0", "id": msg_id,
                    "error": {"code": -32601,
                              "message": f"method not found: {method}"}}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
