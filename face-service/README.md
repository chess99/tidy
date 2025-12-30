# face-service (InsightFace / ONNXRuntime)

这是一个**可选**的独立人脸服务，用于替换当前 Node 内的 face-api pipeline（提升检测与识别质量，便于 CPU/GPU 自动切换）。

## 运行方式

### 本地运行（开发）

- CPU：默认可用
- NVIDIA GPU：需要额外的 CUDA runtime 与 `onnxruntime-gpu`（当前未在 requirements 默认安装）

```bash
cd face-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8002
```

## 接口

- `GET /health`
- `POST /detect+embed`

请求/响应以 JSON 为主：输入图片 base64，输出 boxes/landmarks/embeddings。

> 注意：此服务在当前阶段是“工程骨架 + 可扩展点”。模型下载与 provider 选择会在后续版本完善。
