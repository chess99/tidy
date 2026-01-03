"""input: env(TIDY_CLIP_MODEL_ID) + torch/transformers + text/PIL images
output: encode_text/encode_images -> (model_id, device, dim, normalized, embeddings)
pos: AI service CLIP 抽象层：为 FastAPI 路由提供统一编码接口（变更需同步更新本头注释与所属目录 README）
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, List, Optional

import numpy as np


def _l2_normalize(vec: np.ndarray) -> np.ndarray:
    v = vec.astype(np.float32)
    n = float(np.linalg.norm(v))
    if n <= 0:
        return v
    return v / n


def _pick_device(torch_mod: Any) -> str:
    # Priority: CUDA > Apple MPS > CPU
    try:
        if bool(torch_mod.cuda.is_available()):
            return "cuda"
    except Exception:
        pass
    try:
        if hasattr(torch_mod.backends, "mps") and bool(torch_mod.backends.mps.is_available()):  # type: ignore[attr-defined]
            return "mps"
    except Exception:
        pass
    return "cpu"


@dataclass(frozen=True)
class ClipEncodeResult:
    model: str
    device: str
    dim: int
    normalized: bool
    embeddings: np.ndarray  # shape: [N, dim], float32


class ClipEncoder:
    def __init__(self, model: Any, processor: Any, model_id: str, device: str):
        self.model = model
        self.processor = processor
        self.model_id = model_id
        self.device = device

    @staticmethod
    def load(model_id: Optional[str] = None) -> "ClipEncoder":
        # Lazy import to avoid heavy deps for non-CLIP endpoints.
        import torch  # type: ignore
        from transformers import AutoModel, AutoProcessor  # type: ignore

        mid = (model_id or os.environ.get("TIDY_CLIP_MODEL_ID") or "jinaai/jina-clip-v2").strip()
        if not mid:
            mid = "jinaai/jina-clip-v2"

        device = _pick_device(torch)

        # Some models (notably Jina) require trust_remote_code for custom encode_* helpers.
        trust_rc = bool(os.environ.get("TIDY_CLIP_TRUST_REMOTE_CODE", "1").strip() not in ("0", "false", "False"))

        try:
            model = AutoModel.from_pretrained(mid, trust_remote_code=trust_rc)
            processor = AutoProcessor.from_pretrained(mid, trust_remote_code=trust_rc)
        except Exception as e:
            raise RuntimeError(
                f"failed to load model '{mid}': {e}. "
                "If running offline, download/cache the model files first or set TIDY_CLIP_MODEL_ID to a local path."
            ) from e

        try:
            model.to(device)
        except Exception:
            # Some remote-code models may manage device internally; fall back to CPU.
            device = "cpu"
            try:
                model.to(device)
            except Exception:
                pass

        try:
            model.eval()
        except Exception:
            pass

        return ClipEncoder(model=model, processor=processor, model_id=mid, device=device)

    def _to_numpy(self, t: Any) -> np.ndarray:
        # Some remote-code models return numpy arrays directly.
        if isinstance(t, np.ndarray):
            arr = t.astype(np.float32, copy=False)
        elif isinstance(t, list):
            arr = np.asarray(t, dtype=np.float32)
        else:
            # Assume torch tensor-like
            arr = t.detach().to("cpu").numpy().astype(np.float32)
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        return arr

    def encode_text(self, texts: List[str], normalize: bool = True, profile: Any = None) -> ClipEncodeResult:
        import torch  # type: ignore

        items = [str(t).strip() for t in texts if str(t).strip()]
        if not items:
            raise ValueError("texts must be non-empty")

        with torch.no_grad():
            if hasattr(self.model, "encode_text"):
                if profile is not None:
                    feats = profile.wrap("clip.encode_text.model.encode_text", lambda: self.model.encode_text(items))  # type: ignore[attr-defined]
                else:
                    feats = self.model.encode_text(items)  # type: ignore[attr-defined]
            else:
                if profile is not None:
                    inputs = profile.wrap(
                        "clip.encode_text.processor",
                        lambda: self.processor(text=items, images=None, return_tensors="pt", padding=True, truncation=True),
                        {"n": len(items)},
                    )
                else:
                    inputs = self.processor(text=items, images=None, return_tensors="pt", padding=True, truncation=True)
                if profile is not None:
                    inputs = profile.wrap(
                        "clip.encode_text.to_device", lambda: {k: v.to(self.device) for k, v in inputs.items()}, {"device": self.device}
                    )
                else:
                    inputs = {k: v.to(self.device) for k, v in inputs.items()}
                if hasattr(self.model, "get_text_features"):
                    if profile is not None:
                        feats = profile.wrap("clip.encode_text.model.get_text_features", lambda: self.model.get_text_features(**inputs))  # type: ignore[attr-defined]
                    else:
                        feats = self.model.get_text_features(**inputs)  # type: ignore[attr-defined]
                else:
                    # Best-effort generic fallback: forward pass and take pooled output if present.
                    if profile is not None:
                        out = profile.wrap("clip.encode_text.model.forward", lambda: self.model(**inputs))
                    else:
                        out = self.model(**inputs)
                    feats = getattr(out, "pooler_output", None) or getattr(out, "text_embeds", None)
                    if feats is None:
                        raise RuntimeError("model does not support text encoding (missing encode_text/get_text_features)")

        if profile is not None:
            arr = profile.wrap("clip.encode_text.to_numpy", lambda: self._to_numpy(feats))
        else:
            arr = self._to_numpy(feats)
        if normalize:
            if profile is not None:
                arr = profile.wrap("clip.encode_text.l2_normalize", lambda: np.stack([_l2_normalize(v) for v in arr], axis=0), {"n": int(arr.shape[0])})
            else:
                arr = np.stack([_l2_normalize(v) for v in arr], axis=0)
        return ClipEncodeResult(model=self.model_id, device=self.device, dim=int(arr.shape[1]), normalized=bool(normalize), embeddings=arr)

    def encode_images(self, images: List[Any], normalize: bool = True, profile: Any = None) -> ClipEncodeResult:
        import torch  # type: ignore

        if not images:
            raise ValueError("images must be non-empty")

        with torch.no_grad():
            if hasattr(self.model, "encode_image"):
                if profile is not None:
                    feats = profile.wrap("clip.encode_image.model.encode_image", lambda: self.model.encode_image(images))  # type: ignore[attr-defined]
                else:
                    feats = self.model.encode_image(images)  # type: ignore[attr-defined]
            else:
                if profile is not None:
                    inputs = profile.wrap("clip.encode_image.processor", lambda: self.processor(text=None, images=images, return_tensors="pt"), {"n": len(images)})
                else:
                    inputs = self.processor(text=None, images=images, return_tensors="pt")
                if profile is not None:
                    inputs = profile.wrap(
                        "clip.encode_image.to_device", lambda: {k: v.to(self.device) for k, v in inputs.items()}, {"device": self.device}
                    )
                else:
                    inputs = {k: v.to(self.device) for k, v in inputs.items()}
                if hasattr(self.model, "get_image_features"):
                    if profile is not None:
                        feats = profile.wrap("clip.encode_image.model.get_image_features", lambda: self.model.get_image_features(**inputs))  # type: ignore[attr-defined]
                    else:
                        feats = self.model.get_image_features(**inputs)  # type: ignore[attr-defined]
                else:
                    if profile is not None:
                        out = profile.wrap("clip.encode_image.model.forward", lambda: self.model(**inputs))
                    else:
                        out = self.model(**inputs)
                    feats = getattr(out, "pooler_output", None) or getattr(out, "image_embeds", None)
                    if feats is None:
                        raise RuntimeError("model does not support image encoding (missing encode_image/get_image_features)")

        if profile is not None:
            arr = profile.wrap("clip.encode_image.to_numpy", lambda: self._to_numpy(feats))
        else:
            arr = self._to_numpy(feats)
        if normalize:
            if profile is not None:
                arr = profile.wrap("clip.encode_image.l2_normalize", lambda: np.stack([_l2_normalize(v) for v in arr], axis=0), {"n": int(arr.shape[0])})
            else:
                arr = np.stack([_l2_normalize(v) for v in arr], axis=0)
        return ClipEncodeResult(model=self.model_id, device=self.device, dim=int(arr.shape[1]), normalized=bool(normalize), embeddings=arr)


_ENCODER: Optional[ClipEncoder] = None


def get_encoder() -> ClipEncoder:
    global _ENCODER
    if _ENCODER is None:
        _ENCODER = ClipEncoder.load()
    return _ENCODER


