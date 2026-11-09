# ai-service (Face + CLIP / Transformers)

这是一个内部使用的 **统一 AI 推理服务**：承载人脸检测/embedding 与 CLIP（图像/文本 embedding），供 `server` 调用以实现人脸系统与智能搜索。

## 文件

- `app/`：FastAPI 应用代码。
- `scripts/`：桌面 sidecar 可执行文件的打包脚本。
- `requirements.txt`：Python 依赖（含 face + CLIP）。
- `pyrightconfig.json`：编辑器静态分析配置（避免未装 venv 时满屏 missing-import）。

## 运行方式

### 本地运行（开发）

使用 Python 3.12；固定的 SciPy 1.18 依赖不再支持 Python 3.11。

```bash
cd ai-service
python -m venv .venv && source .venv/bin/activate
pip install --only-binary=:all: -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8002
```

依赖安装使用 wheel-only 模式，避免 Windows 交付时触发本机编译。人脸检测使用
`insightface==1.0.1`，该版本提供通用 wheel；首次调用人脸接口时仍会按
InsightFace 默认机制下载模型到用户缓存目录。

### 打包为可执行文件（桌面分发）

桌面应用通过 `desktop/scripts/prepare-resources.mjs` 收集构建产物；完整分发流程见 `docs/桌面分发.md`。

## 接口

- `GET /health`：轻量健康检查；只检查 import/依赖可用性，不主动加载 InsightFace/CLIP 重模型。返回 `capabilities.faces` 与 `capabilities.clip`，结构均为 `{ available, code, message }`；`capabilities.clip` 在可用时还会带 `model`。
- `POST /detect+embed`：人脸检测 + embedding（输入 `image_base64`）
- `POST /clip/text-embed`：文本 embedding（输入 `text` 或 `texts`）
- `POST /clip/image-embed`：图片 embedding（输入 `image_path` 或 `image_base64`）
  - 调试：加请求头 `x-tidy-profile: 1` 或 query `?profile=1`，响应会附带 `profile`（分段耗时 + CPU 时间 + RSS 峰值）

`GET /health` 响应示例（开发环境常见地址：`http://127.0.0.1:8002/health`）：

```json
{
  "ok": true,
  "service": "tidy-ai-service",
  "capabilities": {
    "faces": { "available": true, "code": null, "message": "..." },
    "clip": { "available": true, "code": null, "message": "...", "model": "jinaai/jina-clip-v2" }
  }
}
```

## 环境变量

- `TIDY_CLIP_MODEL_ID`：CLIP 模型 id 或本地路径（默认 `jinaai/jina-clip-v2`）
- `TIDY_CLIP_TRUST_REMOTE_CODE`：是否允许 Transformers `trust_remote_code`（默认开启；Jina CLIP v2 需要）
- `TIDY_CLIP_CONCURRENCY`：CLIP 推理并发（默认 `1`）。
  - 说明：FastAPI 的同步 handler 会跑在线程池里；如果允许多请求并发进 Torch 推理，CPU/MPS/CUDA 很容易争用并产生严重长尾。
  - 调参：结合 profiling 中的 `clip.slot.waitMs`（排队等待）与 `totalMs`（端到端）一起看，避免“吞吐略升但 P95/P99 暴涨”。
