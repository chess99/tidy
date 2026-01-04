本目录是 Python AI 服务的应用入口（FastAPI）：为主服务提供人脸与 CLIP（智能搜索）推理能力。
输入：图片（base64 或本地路径）/文本；输出：人脸框与 embedding；CLIP 图像/文本 embedding。
更新规则：API 路由/返回结构/模型参数变化时，更新本 README + `docs/README.md`。

### 关键约束（性能/并发）

- `main.py` 的 CLIP 推理默认 **并发=1**（避免 FastAPI 线程池并发推理导致 CPU/MPS/CUDA 资源争用与长尾延迟）。
  - 可用环境变量 `TIDY_CLIP_CONCURRENCY` 调整（仅内部使用；改动需同步更新本文档与 `docs/智能搜索_CLIP.md`）。

### 文件

- `main.py`：FastAPI 应用与 `/health`、`/detect+embed`、`/clip/*` 实现。
- `clip_encoder.py`：CLIP 编码抽象层（统一 `encode_text/encode_images`，便于替换模型，如 Jina v2 / Chinese-CLIP / SigLIP）。
- `profiler.py`：轻量 profiling（分段耗时 + CPU 时间 + RSS 峰值），用于定位推理接口慢点。
- `__init__.py`：包标记文件，保证 `app.*` 导入稳定。


