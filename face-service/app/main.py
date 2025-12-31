import base64
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException

try:
    import cv2  # type: ignore
except Exception as e:  # pragma: no cover
    raise RuntimeError(f"OpenCV import failed: {e}")

try:
    from insightface.app import FaceAnalysis  # type: ignore
except Exception as e:  # pragma: no cover
    raise RuntimeError(f"InsightFace import failed: {e}")


app = FastAPI(title="tidy-face-service", version="0.1.0")

_fa: Optional[FaceAnalysis] = None


def _get_face_app() -> FaceAnalysis:
  global _fa
  if _fa is not None:
    return _fa

  # Providers:
  # - CPU-only: onnxruntime (default)
  # - If you install onnxruntime-gpu and CUDA runtime is available, ORT may use CUDA provider.
  fa = FaceAnalysis(name="buffalo_l")
  # det_size affects detector speed/accuracy; can be made configurable
  fa.prepare(ctx_id=0, det_size=(640, 640))
  _fa = fa
  return _fa


def _decode_image(b64: str) -> np.ndarray:
  try:
    raw = base64.b64decode(b64)
  except Exception:
    raise HTTPException(status_code=400, detail="invalid base64")
  arr = np.frombuffer(raw, dtype=np.uint8)
  img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
  if img is None:
    raise HTTPException(status_code=400, detail="cannot decode image")
  return img


@app.get("/health")
def health() -> Dict[str, Any]:
  return {"ok": True}


@app.post("/detect+embed")
def detect_embed(payload: Dict[str, Any]) -> Dict[str, Any]:
  b64 = payload.get("image_base64")
  if not isinstance(b64, str) or not b64:
    raise HTTPException(status_code=400, detail="image_base64 required")

  img = _decode_image(b64)
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



