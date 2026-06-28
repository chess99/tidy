"""input: base64 图片/本地路径 + InsightFace/OpenCV + CLIP(Transformers/Torch)
output: 人脸检测框/关键点/embedding 向量；CLIP 图像/文本 embedding
pos: Python AI 服务入口：供主服务调用（变更需同步更新本头注释与所属目录 README）
"""

import base64
import io
import os
import threading
import time
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Request

try:
    import cv2  # type: ignore
except Exception as e:  # pragma: no cover
    raise RuntimeError(f"OpenCV import failed: {e}") from e

_face_import_error: Optional[Exception] = None
try:
    from insightface.app import FaceAnalysis  # type: ignore
except Exception as e:  # pragma: no cover
    FaceAnalysis = None  # type: ignore
    _face_import_error = e

try:
    from PIL import Image  # type: ignore
except Exception as e:  # pragma: no cover
    raise RuntimeError(f"PIL import failed: {e}") from e


app = FastAPI(title="tidy-ai-service", version="0.2.0")

_fa: Optional[Any] = None

# CLIP model is loaded lazily because it is heavy and may require offline model files.
_clip: Optional[Any] = None  # ClipEncoder (lazy)
_clip_load_lock = threading.Lock()

# CLIP inference concurrency control:
# - FastAPI runs sync endpoints in a threadpool, so without a guard, multiple concurrent requests will run
#   Torch inference at the same time and can thrash CPU/MPS/CUDA, causing severe tail latency.
try:
    _clip_concurrency = int(str(os.environ.get("TIDY_CLIP_CONCURRENCY", "1")).strip() or "1")
except Exception:
    _clip_concurrency = 1
_clip_concurrency = max(1, _clip_concurrency)
_clip_sem = threading.Semaphore(_clip_concurrency)
_clip_inflight = 0
_clip_inflight_lock = threading.Lock()


def _decode_image_b64(b64: str) -> np.ndarray:
    try:
        raw = base64.b64decode(b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid base64") from exc
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="cannot decode image")
    return img


def _decode_pil_from_b64(b64: str) -> Image.Image:
    try:
        raw = base64.b64decode(b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid base64") from exc
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        # If bytes are not a normal image container, try OpenCV decode and convert.
        cv = _decode_image_b64(b64)
        rgb = cv[:, :, ::-1]
        img = Image.fromarray(rgb)  # type: ignore[arg-type]
    return img


def _pil_from_path(p: str) -> Image.Image:
    if not p or not isinstance(p, str):
        raise HTTPException(status_code=400, detail="image_path required")
    if not os.path.isabs(p):
        raise HTTPException(status_code=400, detail="image_path must be absolute")
    if not os.path.exists(p):
        raise HTTPException(status_code=404, detail="image_path not found")
    try:
        return Image.open(p).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"cannot open image_path: {e}") from e


def _get_face_app() -> Any:
    global _fa
    if _fa is not None:
        return _fa

    if FaceAnalysis is None:
        raise HTTPException(status_code=503, detail=f"InsightFace unavailable: {_face_import_error}")

  # Providers:
  # - CPU-only: onnxruntime (default)
  # - If you install onnxruntime-gpu and CUDA runtime is available, ORT may use CUDA provider.
    fa = FaceAnalysis(name="buffalo_l", allowed_modules=["detection", "recognition"])
    # det_size affects detector speed/accuracy; can be made configurable
    fa.prepare(ctx_id=0, det_size=(640, 640))
    _fa = fa
    return _fa


def _get_clip():
    global _clip
    if _clip is not None:
        return _clip
    with _clip_load_lock:
        if _clip is not None:
            return _clip
        try:
            from app.clip_encoder import get_encoder  # type: ignore
        except Exception as e:  # pragma: no cover
            raise HTTPException(status_code=500, detail=f"CLIP encoder import failed: {e}") from e
        try:
            _clip = get_encoder()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e
        return _clip


def _with_clip_slot(kind: str, prof, fn):
    global _clip_inflight
    t0 = time.perf_counter_ns()
    _clip_sem.acquire()
    wait_ms = (time.perf_counter_ns() - t0) / 1e6
    with _clip_inflight_lock:
        _clip_inflight += 1
        inflight = _clip_inflight
    if prof is not None:
        prof.mark("clip.slot", {"kind": str(kind), "waitMs": float(wait_ms), "inflight": int(inflight), "concurrency": int(_clip_concurrency)})
    try:
        return fn()
    finally:
        with _clip_inflight_lock:
            _clip_inflight -= 1
        _clip_sem.release()


def _l2_normalize(vec: np.ndarray) -> np.ndarray:
    v = vec.astype(np.float32)
    n = float(np.linalg.norm(v))
    if n <= 0:
        return v
    return v / n


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "service": "tidy-ai-service"}


@app.post("/detect+embed")
def detect_embed(payload: Dict[str, Any]) -> Dict[str, Any]:
    b64 = payload.get("image_base64")
    if not isinstance(b64, str) or not b64:
        raise HTTPException(status_code=400, detail="image_base64 required")

    img = _decode_image_b64(b64)
    fa = _get_face_app()
    faces = fa.get(img)

    out: List[Dict[str, Any]] = []
    for f in faces:
        box = f.bbox.tolist()  # [x1,y1,x2,y2]
        kps = f.kps.tolist() if getattr(f, "kps", None) is not None else None
        emb = f.embedding.astype(np.float32).tolist()
        det_score = float(getattr(f, "det_score", 0.0))
        out.append({"box": box, "kps": kps, "embedding": emb, "score": det_score})

    return {"faces": out}


@app.post("/clip/text-embed")
def clip_text_embed(payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
    text = payload.get("text")
    texts = payload.get("texts")
    normalize = payload.get("normalize", True)
    want_profile = str(request.query_params.get("profile", "")).strip() == "1" or str(request.headers.get("x-tidy-profile", "")).strip() == "1"
    request_id = f"{int(time.time() * 1000)}-{os.urandom(3).hex()}"
    prof = None
    if want_profile:
        from app.profiler import Profiler  # type: ignore

        prof = Profiler(name="POST /clip/text-embed", request_id=request_id, enabled=True)
        prof.mark("start")

    if isinstance(text, str) and text.strip():
        items = [text.strip()]
    elif isinstance(texts, list) and all(isinstance(t, str) for t in texts) and len(texts) > 0:
        items = [str(t).strip() for t in texts if str(t).strip()]
    else:
        raise HTTPException(status_code=400, detail="text (string) or texts (string[]) required")

    if prof is not None:
        prof.mark("parsed", {"n": len(items), "normalize": bool(normalize)})
    cold = _clip is None
    enc = prof.wrap("clip.get_encoder", _get_clip, {"cold": bool(cold)}) if prof is not None else _get_clip()
    out = (
        prof.wrap(
            "clip.encode_text",
            lambda: _with_clip_slot("text", prof, lambda: enc.encode_text(items, normalize=bool(normalize), profile=prof)),
            {"n": len(items)},
        )
        if prof is not None
        else _with_clip_slot("text", None, lambda: enc.encode_text(items, normalize=bool(normalize)))
    )
    arr = out.embeddings
    payload_out: Dict[str, Any] = {
        "model": out.model,
        "device": out.device,
        "dim": int(out.dim),
        "normalized": bool(out.normalized),
        "embeddings": arr.tolist(),
    }
    if prof is not None:
        prof.mark("serialized", {"n": len(items), "dim": int(out.dim), "device": out.device})
        payload_out["profile"] = prof.finish()
    return payload_out


@app.post("/clip/image-embed")
def clip_image_embed(payload: Dict[str, Any], request: Request) -> Dict[str, Any]:
  # One of:
  # - image_path: absolute path on local filesystem (recommended for indexing)
  # - image_paths: absolute path list (batch)
  # - image_base64: image bytes as base64 (useful for browser uploads)
  # - image_base64s: base64 list (batch)
    image_path = payload.get("image_path")
    image_paths = payload.get("image_paths")
    image_b64 = payload.get("image_base64")
    image_b64s = payload.get("image_base64s")
    normalize = payload.get("normalize", True)
    want_profile = str(request.query_params.get("profile", "")).strip() == "1" or str(request.headers.get("x-tidy-profile", "")).strip() == "1"
    request_id = f"{int(time.time() * 1000)}-{os.urandom(3).hex()}"
    prof = None
    if want_profile:
        from app.profiler import Profiler  # type: ignore

        prof = Profiler(name="POST /clip/image-embed", request_id=request_id, enabled=True)
        prof.mark("start")

    images: List[Image.Image] = []
    if isinstance(image_path, str) and image_path:
        images = [prof.wrap("decode.image_path", lambda: _pil_from_path(image_path), {"mode": "image_path"})] if prof is not None else [_pil_from_path(image_path)]
    elif isinstance(image_paths, list) and all(isinstance(p, str) for p in image_paths) and len(image_paths) > 0:
        images = [_pil_from_path(str(p)) for p in image_paths]
    elif isinstance(image_b64, str) and image_b64:
        images = [prof.wrap("decode.image_base64", lambda: _decode_pil_from_b64(image_b64), {"mode": "image_base64"})] if prof is not None else [_decode_pil_from_b64(image_b64)]
    elif isinstance(image_b64s, list) and all(isinstance(b, str) for b in image_b64s) and len(image_b64s) > 0:
        images = [_decode_pil_from_b64(str(b)) for b in image_b64s]
    else:
        raise HTTPException(status_code=400, detail="image_path/image_paths (absolute) or image_base64/image_base64s required")

    if prof is not None:
        prof.mark("parsed", {"n": len(images), "normalize": bool(normalize)})
    cold = _clip is None
    enc = prof.wrap("clip.get_encoder", _get_clip, {"cold": bool(cold)}) if prof is not None else _get_clip()
    out = (
        prof.wrap(
            "clip.encode_images",
            lambda: _with_clip_slot("image", prof, lambda: enc.encode_images(images, normalize=bool(normalize), profile=prof)),
            {"n": len(images)},
        )
        if prof is not None
        else _with_clip_slot("image", None, lambda: enc.encode_images(images, normalize=bool(normalize)))
    )
    arr = out.embeddings
    payload_out2: Dict[str, Any] = {
        "model": out.model,
        "device": out.device,
        "dim": int(out.dim),
        "normalized": bool(out.normalized),
        "embeddings": arr.tolist(),
    }
    if prof is not None:
        prof.mark("serialized", {"n": len(images), "dim": int(out.dim), "device": out.device})
        payload_out2["profile"] = prof.finish()
    return payload_out2

