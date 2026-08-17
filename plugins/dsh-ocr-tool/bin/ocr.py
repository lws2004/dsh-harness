#!/usr/bin/env python3
"""识图工具 (OCR Tool)

为 deepseek-v4-flash 等非多模态模型补全图像理解能力。

两个 tier(准确度优先,基于实测):
  Tier 1  RapidOCR (ONNX)        0.6-0.9s   清晰印刷中文/英文文档、扫描件、发票
  Tier 2  PaddleOCR-VL (omlx)    3.7-4.1s   复杂布局、手写、低质量、含照片场景

路由逻辑:不是无脑优先快的,而是"置信度不够就降级"——
  - _text_quality():启发式评估文本质量(字母数字CJK占比、特殊字符占比、平均词长)
  - _blend_confidence():融合引擎置信度 + 文本质量打分
  - --profile fast|balanced|accurate 三档,阈值不同(fast 禁 VLM,accurate 更积极进 VLM)
  - --roi x1,y1,x2,y2 局部裁剪后 OCR
  - 短文本交叉验证:≤3 行/≤60 字符且含数字夹字母/全大写缩写等疑似图形污染
    token(balanced/accurate)时,即使快速通道达标也强制 VLM 复核
    (cross_checked=true,附 rapidocr_text/conf/blend 对照);VLM 不可用时
    回退快速通道结果并标记 cross_check_failed=true,绝不因复核失败读不出图
  - 全失败返回 engine='none',禁止把乱码当高置信结果

Tesseract 已移除:实测它读错证件号/中文字段,准确度不达标。

用法:
  ocr.py <image> [--tier auto|1|2] [--profile fast|balanced|accurate] [--roi x1,y1,x2,y2] [--mode text|json]
  ocr.py <image> --describe            # 直接用 VLM 描述图片内容(不逐行转录)
  ocr.py --check                       # 检查各引擎可用性
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time

# ---------------- 配置 ----------------
VENV_PYTHON = os.path.expanduser("~/.ocr-tool/venv/bin/python")
OMLX_BASE_URL = os.environ.get("OMLX_URL", "http://localhost:8080/v1")
OMLX_KEY = os.environ.get("OMLX_KEY", "180180")
# 转录用 OCR 专用 VLM(准),describe 用通用 VLM(语义理解)
OMLX_OCR_MODEL = os.environ.get("OMLX_OCR_MODEL", "PaddleOCR-VL-1.6-8bit")
OMLX_DESCRIBE_MODEL = os.environ.get("OMLX_DESCRIBE_MODEL", "MiniCPM-V-4.6-5bit")
# 向后兼容:旧的 OMLX_MODEL 覆盖 describe 模型
OMLX_MODEL = os.environ.get("OMLX_MODEL") or OMLX_DESCRIBE_MODEL
# 若 8080 不通,自动探测这些备选端口(omlx launchd 默认 8010 / serve 默认 8000)
OMLX_PROBE_PORTS = [8080, 8010, 8000]

# 各 profile 的置信度阈值 / 最低字符数
PROFILES = {
    # fast: 只用 RapidOCR,不进 VLM
    "fast":     {"min_conf": 0.50, "min_chars": 10, "allow_vlm": False},
    # balanced: RapidOCR → 不足则升 PaddleOCR-VL
    "balanced": {"min_conf": 0.60, "min_chars": 15, "allow_vlm": True},
    # accurate: 更积极进 VLM
    "accurate": {"min_conf": 0.80, "min_chars": 20, "allow_vlm": True},
}


def _omlx_endpoint() -> str:
    """解析可用的 omlx /v1 端点。优先 OMLX_URL,否则探测常见端口。"""
    if os.environ.get("OMLX_URL"):
        return OMLX_BASE_URL
    import socket
    for port in OMLX_PROBE_PORTS:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        try:
            s.connect(("127.0.0.1", port))
            return f"http://localhost:{port}/v1"
        except OSError:
            pass
        finally:
            s.close()
    return OMLX_BASE_URL  # 默认,调用时会报错


# ---------------- 统一 JSON 信封 ----------------
def _result_envelope(result: dict) -> dict:
    """统一 JSON 信封,参考 ds-vision-skill-plus 的规范。

    {task_type, tool_used, confidence, result, metadata}
    """
    if not isinstance(result, dict):
        return {"task_type": "ocr", "tool_used": "unknown",
                "confidence": "low", "result": "", "metadata": {}, "ok": False}
    engine = result.get("engine", f"tier{result.get('used_tier')}")
    if engine == "minicpm-v":
        task_type = "image_reasoning"
    else:
        task_type = "ocr"
    # confidence 归一化为 high/medium/low
    conf = result.get("confidence")
    if isinstance(conf, dict):
        blended = conf.get("blended", 0)
    elif isinstance(conf, (int, float)):
        blended = conf
    else:
        blended = None
    if blended is None:
        level = "high" if result.get("ok") else "low"
    elif blended >= 0.8:
        level = "high"
    elif blended >= 0.5:
        level = "medium"
    else:
        level = "low"
    env = {
        "task_type": task_type,
        "tool_used": engine,
        "confidence": level,
        "result": result.get("text", ""),
        "ok": result.get("ok", False),
    }
    metadata = {}
    for k in ("engine", "used_tier", "elapsed_ms", "roi", "chars", "lines",
              "text_boxes", "boxes", "engine_conf", "describe", "error",
              "attempts", "both", "ocr", "describe_result",
              "cross_checked", "rapidocr_text", "rapidocr_conf",
              "rapidocr_blend", "cross_check_failed", "cross_check_error"):
        if k in result and result[k] is not None:
            metadata[k] = result[k]
    env["metadata"] = metadata
    return env


# ---------------- 置信度与文本质量 ----------------
_CJK_RE = re.compile(r'[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]')
_ALNUM_RE = re.compile(r'[A-Za-z0-9]')
_PRINTABLE_RE = re.compile(r'[\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\uff00-\uffef]')


def _text_quality(text: str) -> dict:
    """启发式评估文本质量。返回 {score(0-1), garbage(bool), cjk, alnum, spec}。

    - 可打印/字母数字CJK占比高 → 质量好;大量陌生符号/重复 → 疑似乱码
    """
    if not text:
        return {"score": 0.0, "garbage": True, "cjk": 0.0, "alnum": 0.0, "spec": 1.0}
    n = len(text)
    cjk = len(_CJK_RE.findall(text))
    alnum = len(_ALNUM_RE.findall(text))
    printable = len(_PRINTABLE_RE.findall(text))
    spec = n - cjk - alnum  # 非字母数字CJK的字符(符号/空格/标点)
    printable_ratio = printable / n
    # 字母数字CJK应占"有意义的"主体;符号占比过高通常是乱码或布局噪声
    alnum_cjk_ratio = (alnum + cjk) / n
    # 词切分用于检测纯符号垃圾串
    words = [w for w in re.split(r'[\s,;:.!?(){}[\]"\'|/\\+=<>*-]+', text) if w]

    score = printable_ratio * 0.5 + min(alnum_cjk_ratio * 1.6, 0.5)
    # 高频重复同字符(乱码特征):如 乚は乚は...
    repeated = any(ch in text and text.count(ch) >= max(5, n // 3)
                   for ch in set(text) if not ch.isspace())
    # 长串内若无字母数字CJK(纯符号垃圾串)才算乱码;
    # 合法长词(证件号/手机号/长英文单词)不算
    junk_words = [w for w in words if w and not _CJK_RE.search(w)
                  and not _ALNUM_RE.search(w)]
    garbage = (printable_ratio < 0.6) or repeated or bool(junk_words)
    return {"score": max(0.0, min(score, 1.0)), "garbage": garbage,
            "cjk": cjk / n if n else 0, "alnum": alnum / n if n else 0,
            "spec": spec / n if n else 0}


def _blend_confidence(engine_conf, text: str) -> dict:
    """融合引擎置信度(如有) + 文本质量启发式,得到最终可信度。"""
    q = _text_quality(text)
    if engine_conf is None:
        blended = q["score"]
    else:
        blended = 0.6 * engine_conf + 0.4 * q["score"]
    return {"blended": blended, "engine_conf": engine_conf,
            "quality": q["score"], "garbage": q["garbage"], "chars": len(text)}


# ---------------- 短文本交叉验证启发式 ----------------
# 背景:启发式乱码检测只能拦住"读出来是乱码"的结果,拦不住
# "读出来通顺但个别字符错"(典型:小图标/图形被误识别成字母数字,
# 如三点图标 → "6",且引擎置信度照常给 0.99)。
# 策略:短文本中出现"数字夹字母"或"全大写缩写"这类疑似图形污染的
# token 时,快速通道结果不可直接采信,强制走 VLM 复核。
# 误触发代价仅为一次 ~1s 的复核,准确性优先。
_SUSPECT_TOKEN_RE = re.compile(r'[0-9][A-Za-z]|[A-Za-z][0-9]|\b[A-Z]{2,5}\b')


def _needs_cross_check(text: str, lines: int) -> bool:
    """判断是否需要对短文本做 VLM 交叉验证。

    触发条件(需同时满足):
      - 文本不超过 3 行,总字符 ≤ 60(信息密度低,小图形污染概率高)
      - 存在可疑 token:数字紧邻字母(如 6PTC、15 Pro)、或全大写缩写(如 PTC,OCR)
    长文档(>3 行 / >60 字符)信任 RapidOCR,不做复核,保持速度。
    """
    if not text:
        return False
    text = text.strip()
    if lines is not None and lines > 3:
        return False
    if len(text) > 60:
        return False
    return bool(_SUSPECT_TOKEN_RE.search(text))


# ---------------- Tier 1: RapidOCR ----------------
def tier1_rapidocr(image: str) -> dict:
    """清晰印刷中文/英文文档。通过 venv 调 RapidOCR ONNX。"""
    t0 = time.time()
    code = r'''
import json, sys
try:
    from rapidocr_onnxruntime import RapidOCR
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)})); sys.exit(0)
try:
    r = RapidOCR()
    res, elapse = r(sys.argv[1])
    lines = [ln[1] for ln in (res or [])]
    conf = sum(ln[2] for ln in (res or [])) / len(res) if res else 0.0
    boxes = []
    for ln in (res or []):
        pts = ln[0]
        x1 = min(p[0] for p in pts); y1 = min(p[1] for p in pts)
        x2 = max(p[0] for p in pts); y2 = max(p[1] for p in pts)
        boxes.append({"text": ln[1], "conf": float(ln[2]),
                      "box": [x1, y1, x2, y2]})
    print(json.dumps({"ok": True, "text": "\n".join(lines), "lines": len(lines),
                      "text_boxes": len(res or []), "boxes": boxes, "conf": conf}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
'''
    try:
        r = subprocess.run([VENV_PYTHON, "-c", code, image],
                           capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        return {"used_tier": 1, "ok": False,
                "error": "venv python not found", "text": "",
                "elapsed_ms": int((time.time() - t0) * 1000)}
    except subprocess.TimeoutExpired:
        return {"used_tier": 1, "ok": False, "error": "rapidocr timeout",
                "text": "", "elapsed_ms": int((time.time() - t0) * 1000)}
    elapsed = int((time.time() - t0) * 1000)
    try:
        out = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return {"used_tier": 1, "ok": False,
                "error": ("rapidocr parse fail: " + r.stdout[-200:]),
                "text": "", "elapsed_ms": elapsed}
    if not out.get("ok"):
        return {"used_tier": 1, "ok": False, "error": out.get("error", "?"),
                "text": "", "elapsed_ms": elapsed}
    text = out.get("text", "")
    conf = out.get("conf")
    return {"used_tier": 1, "ok": True, "text": text,
            "elapsed_ms": elapsed, "chars": len(text),
            "lines": out.get("lines", 0), "text_boxes": out.get("text_boxes", 0),
            "boxes": out.get("boxes"), "engine_conf": conf}


# ---------------- Tier 2: OMLX PaddleOCR-VL / MiniCPM-V (VLM) ----------------
def _omlx_request(image: str, prompt: str, max_tokens: int, model: str = None) -> dict:
    with open(image, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    payload = {
        "model": model or OMLX_MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        ]}],
        "max_tokens": max_tokens,
    }
    import urllib.request
    endpoint = _omlx_endpoint()
    req = urllib.request.Request(
        f"{endpoint}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {OMLX_KEY}"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode())
    return data["choices"][0]["message"]["content"]


def tier2_vlm(image: str, describe: bool = False) -> dict:
    """VLM 转录或描述。处理复杂布局、手写、低质量、含照片场景。

    转录用 OCR 专用模型 PaddleOCR-VL(准),describe 用通用 VLM
    MiniCPM-V(语义理解)。
    """
    t0 = time.time()
    if describe:
        prompt = ("请用中文详细描述这张图片的内容:识别画面中的物体、文字、布局、"
                  "上下文。如果是截图/文档/表格,请尽量转录其中的文字并说明结构。")
        model = OMLX_DESCRIBE_MODEL
    else:
        prompt = ("请逐行转录图片中的所有文字,保留原有换行和结构。"
                  "对于表格,保持行列对齐;对于手写体,尽力辨认。"
                  "只输出转录内容本身,不要额外说明。")
        model = OMLX_OCR_MODEL
    try:
        content = _omlx_request(image, prompt, max_tokens=800, model=model)
    except Exception as e:
        return {"used_tier": 2, "ok": False, "error": f"omlx request failed: {e}",
                "text": "", "elapsed_ms": int((time.time() - t0) * 1000)}
    elapsed = int((time.time() - t0) * 1000)
    # VLM 无引擎置信度,用文本质量兜底
    q = _text_quality(content)
    return {"used_tier": 2, "ok": True, "text": content.strip(),
            "elapsed_ms": elapsed, "chars": len(content.strip()),
            "describe": describe, "engine_conf": None, "quality": q}


# ---------------- ROI 局部裁剪 ----------------
def _crop_roi(image: str, roi: tuple) -> str:
    """按 (x1,y1,x2,y2) 裁剪,返回临时文件路径。

    用 venv python 执行(系统 python 的 PIL 可能损坏,且与 RapidOCR 保持一致)。
    """
    code = r'''
import sys
from PIL import Image
src, x1, y1, x2, y2 = sys.argv[1], *map(int, sys.argv[2:6])
im = Image.open(src)
w, h = im.size
x1, x2 = max(0, min(x1, w)), max(0, min(x2, w))
y1, y2 = max(0, min(y1, h)), max(0, min(y2, h))
if x1 >= x2 or y1 >= y2:
    print("INVALID_ROI"); sys.exit(1)
im.crop((x1, y1, x2, y2)).save("/tmp/ocr_roi.png")
print("OK")
'''
    r = subprocess.run([VENV_PYTHON, "-c", code, image,
                        str(roi[0]), str(roi[1]), str(roi[2]), str(roi[3])],
                       capture_output=True, text=True, timeout=30)
    if r.returncode != 0 or "OK" not in r.stdout:
        raise ValueError(f"roi crop failed: {(r.stderr or r.stdout).strip()[-150:]}")
    return "/tmp/ocr_roi.png"


# ---------------- 调度逻辑 ----------------
def _engine_none(reason: str, attempts: list) -> dict:
    """全失败返回 engine='none',禁止乱码兜底。"""
    return {"ok": False, "used_tier": 0, "engine": "none", "error": reason,
            "text": "", "attempts": attempts}


def auto_run(image: str, profile: str = "balanced", roi: tuple = None) -> dict:
    """置信度驱动降级路由(准确度优先,不无脑优先快的)。

    流程:
    1. 若有 roi 先裁剪
    2. RapidOCR → 融合置信度(引擎conf + 文本质量)达标则返回
    3. 未达标且 profile 允许 VLM → PaddleOCR-VL
    4. 全失败 → engine='none'
    """
    target = image
    roi_note = None
    if roi:
        try:
            target = _crop_roi(image, roi)
            roi_note = f"roi={roi}"
        except Exception as e:
            return _engine_none(f"roi crop failed: {e}", [])

    p = PROFILES.get(profile, PROFILES["balanced"])
    attempts = []

    # Tier1: RapidOCR
    r1 = tier1_rapidocr(target)
    r1["roi"] = roi_note
    text_boxes = r1.get("text_boxes", 0)
    attempts.append({"engine": "rapidocr", "used_tier": 1,
                     "elapsed_ms": r1.get("elapsed_ms"),
                     "conf": r1.get("engine_conf"), "chars": r1.get("chars", 0),
                     "text_boxes": text_boxes})
    need_xcheck = False
    if r1.get("ok"):
        blend = _blend_confidence(r1.get("engine_conf"), r1.get("text", ""))
        r1["confidence"] = blend
        ok_quick = (blend["blended"] >= p["min_conf"]
                    and blend["chars"] >= p["min_chars"]
                    and not blend["garbage"])
        # 短文本 + 疑似图形污染 token → 即使快速通道达标也不直接采信,
        # 强制 VLM 复核;仅在 profile 允许 VLM 时生效(fast 档保持原行为)
        need_xcheck = (p["allow_vlm"]
                       and _needs_cross_check(r1.get("text", ""),
                                              r1.get("lines", 0)))
        if ok_quick and not need_xcheck:
            r1["engine"] = "rapidocr"
            r1["cross_checked"] = False
            return r1
        # RapidOCR 检测到 0 文字框 → 图里没有可转录文字。
        # 进 VLM 转录只会乱码或幻觉输出无关文本,故直接判定无文字,
        # 返回 none(提示该图可能是照片/场景,应用 ocr_describe)。
        if text_boxes == 0:
            return _engine_none(
                "no text detected (image may be a photo/scene; use ocr_describe "
                "for semantic description)", attempts)

    # 升级到 PaddleOCR-VL(仅当 profile 允许且 RapidOCR 检测到文字但质量不足)
    if p["allow_vlm"]:
        r2 = tier2_vlm(target, describe=False)
        r2["roi"] = roi_note
        attempts.append({"engine": "paddleocr-vl", "used_tier": 2,
                         "elapsed_ms": r2.get("elapsed_ms"),
                         "chars": r2.get("chars", 0)})
        if r2.get("ok"):
            q = _text_quality(r2.get("text", ""))
            r2["confidence"] = {"blended": q["score"], "engine_conf": None,
                                "quality": q["score"], "garbage": q["garbage"],
                                "chars": len(r2.get("text", ""))}
            r2["engine"] = "paddleocr-vl"
            # 交叉验证:附带 RapidOCR 原始对照,供调用方判断一致/分歧
            if need_xcheck:
                r2["cross_checked"] = True
                r2["rapidocr_text"] = r1.get("text", "")
                r2["rapidocr_conf"] = r1.get("engine_conf")
                r2["rapidocr_blend"] = (r1.get("confidence") or {}).get("blended")
            if not q["garbage"] and len(r2.get("text", "")) >= 1:
                return r2

    # 交叉验证要求 VLM 复核,但 VLM 不可用/失败:回退快速通道结果,
    # 绝不因复核失败让整张图"读不出来"(返回未复核结果并显式标记,
    # 调用方应提示"该结果未经 VLM 复核,可能存在个别字符错误")。
    if need_xcheck and r1.get("ok"):
        r1["engine"] = "rapidocr"
        r1["cross_checked"] = True
        r1["cross_check_failed"] = True
        r1["cross_check_error"] = r2.get("error") or "vlm unavailable"
        return r1

    # 全失败
    return _engine_none(
        "all engines failed or produced garbage (accuracy-first)", attempts)


def run_ocr(image: str, tier: str, describe: bool = False, profile: str = "balanced",
            roi: tuple = None) -> dict:
    if tier == "auto":
        return auto_run(image, profile=profile, roi=roi)
    target = image
    roi_note = None
    if roi:
        try:
            target = _crop_roi(image, roi)
            roi_note = f"roi={roi}"
        except Exception as e:
            return _engine_none(f"roi crop failed: {e}", [])
    if tier == "1":
        r = tier1_rapidocr(target)
        r["roi"] = roi_note
        if r.get("ok"):
            r["confidence"] = _blend_confidence(r.get("engine_conf"), r.get("text", ""))
            r["engine"] = "rapidocr"
        return r
    if tier == "2":
        r = tier2_vlm(target, describe=describe)
        r["roi"] = roi_note
        r["engine"] = "paddleocr-vl" if not describe else "minicpm-v"
        return r
    raise ValueError(f"unknown tier: {tier}")


def check_available() -> dict:
    out = {}
    # tier1: RapidOCR
    code = "import rapidocr_onnxruntime; print('ok')"
    try:
        r = subprocess.run([VENV_PYTHON, "-c", code], capture_output=True,
                           text=True, timeout=20)
        out["tier1_rapidocr"] = {"ok": r.stdout.strip() == "ok",
                                 "error": r.stderr.strip()[:200] if r.returncode else None}
    except Exception as e:
        out["tier1_rapidocr"] = {"ok": False, "error": str(e)}
    # tier2: omlx VLM
    import urllib.request
    try:
        endpoint = _omlx_endpoint()
        req = urllib.request.Request(f"{endpoint}/models",
                                     headers={"Authorization": f"Bearer {OMLX_KEY}"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        ids = [m["id"] for m in data.get("data", [])]
        # 转录用 OCR 模型和 describe 用通用模型都要可用
        missing = [m for m in (OMLX_OCR_MODEL, OMLX_DESCRIBE_MODEL) if m not in ids]
        out["tier2_omlx"] = {
            "ok": not missing,
            "ocr_model": OMLX_OCR_MODEL,
            "describe_model": OMLX_DESCRIBE_MODEL,
            "missing": missing,
            "models": ids,
        }
    except Exception as e:
        out["tier2_omlx"] = {"ok": False, "error": str(e)}
    return out


def main():
    ap = argparse.ArgumentParser(description="识图工具")
    ap.add_argument("image", nargs="?", help="图片路径")
    ap.add_argument("--tier", default="auto", choices=["auto", "1", "2"],
                    help="1=RapidOCR(清晰印刷文档,快), 2=PaddleOCR-VL(复杂/手写/"
                         "照片场景);auto 按置信度自动降级")
    ap.add_argument("--profile", default="balanced",
                    choices=["fast", "balanced", "accurate"],
                    help="路由档位:fast=只用RapidOCR禁VLM, balanced=默认, "
                         "accurate=更积极进VLM")
    ap.add_argument("--roi", default=None, metavar="x1,y1,x2,y2",
                    help="局部裁剪区域后 OCR")
    ap.add_argument("--mode", default="text", choices=["text", "json"],
                    help="输出格式")
    ap.add_argument("--describe", action="store_true",
                    help="用 VLM 描述图片内容而非转录文字(仅 tier 2)")
    ap.add_argument("--both", action="store_true",
                    help="OCR 转录 + VLM 语义描述双通道一次输出")
    ap.add_argument("--check", action="store_true", help="检查各引擎可用性")
    args = ap.parse_args()

    if args.check:
        print(json.dumps(check_available(), ensure_ascii=False, indent=2))
        return

    if not args.image:
        ap.error("image required (或使用 --check)")

    roi = None
    if args.roi:
        try:
            roi = tuple(int(v) for v in args.roi.split(","))
            if len(roi) != 4:
                raise ValueError
        except ValueError:
            ap.error("--roi 需为 x1,y1,x2,y2 四个整数")

    if args.both:
        # 双通道:OCR(自动路由)+ VLM 语义描述,合并输出
        ocr_r = run_ocr(args.image, args.tier, profile=args.profile, roi=roi)
        des_r = tier2_vlm(args.image, describe=True)
        des_r["engine"] = "minicpm-v"
        parts = []
        if ocr_r.get("ok"):
            parts.append(f"【OCR 转录】\n{ocr_r.get('text', '')}")
        else:
            parts.append(f"【OCR 转录】(失败: {ocr_r.get('error')})")
        if des_r.get("ok"):
            parts.append(f"【图像描述】\n{des_r.get('text', '')}")
        else:
            parts.append(f"【图像描述】(失败: {des_r.get('error')})")
        confs = [c for c in (ocr_r.get("confidence"), des_r.get("quality"))
                 if isinstance(c, dict) and isinstance(c.get("blended", c.get("score")), (int, float))]
        result = {
            "ok": ocr_r.get("ok") or des_r.get("ok"),
            "text": "\n\n".join(parts),
            "engine": f"{ocr_r.get('engine', 'none')}+{des_r.get('engine', 'none')}",
            "used_tier": ocr_r.get("used_tier", 0),
            "elapsed_ms": (ocr_r.get("elapsed_ms", 0) or 0)
                          + (des_r.get("elapsed_ms", 0) or 0),
            "both": True,
            "describe": True,
            "confidence": max([c.get("blended", c.get("score", 0)) for c in confs] + [0.5]),
            "ocr": ocr_r,
            "describe_result": des_r,
        }
        # 交叉验证标记从 ocr 子结果提升到信封顶层(插件/调用方直接读 metadata)
        for _k in ("cross_checked", "cross_check_failed", "cross_check_error",
                   "rapidocr_text", "rapidocr_conf", "rapidocr_blend"):
            if ocr_r.get(_k) is not None:
                result[_k] = ocr_r[_k]
        if not result["ok"]:
            result["error"] = "both engines failed"
    elif args.describe:
        # --describe 强制使用 VLM 描述,忽略 --tier/--profile
        result = tier2_vlm(args.image, describe=True)
        result["engine"] = "minicpm-v"
    else:
        result = run_ocr(args.image, args.tier, profile=args.profile, roi=roi)

    # 统一 JSON 信封
    env = _result_envelope(result)

    if args.mode == "json":
        print(json.dumps(env, ensure_ascii=False, indent=2))
    else:
        if not result.get("ok"):
            print(f"[engine {result.get('engine')}] 失败: {result.get('error')}",
                  file=sys.stderr)
            sys.exit(1)
        engine = result.get("engine", f"tier{result.get('used_tier')}")
        print(f"--- 识别结果 ({engine}, {result['elapsed_ms']}ms) ---")
        if result.get("roi"):
            print(f"[roi: {result['roi']}]")
        print(result["text"])


if __name__ == "__main__":
    main()
