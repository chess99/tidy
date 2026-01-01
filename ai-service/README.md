# ai-service (Face + CLIP / Transformers)

这是一个内部使用的 **统一 AI 推理服务**：承载人脸检测/embedding 与 CLIP（图像/文本 embedding），供 `server` 调用以实现人脸系统与智能搜索。

## 运行方式

### 本地运行（开发）

```bash
cd ai-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8002
```

## 接口

- `GET /health`
- `POST /detect+embed`：人脸检测 + embedding（输入 `image_base64`）
- `POST /clip/text-embed`：文本 embedding（输入 `text` 或 `texts`）
- `POST /clip/image-embed`：图片 embedding（输入 `image_path` 或 `image_base64`）

## 环境变量

- `TIDY_CLIP_MODEL_ID`：CLIP 模型 id 或本地路径（默认 `openai/clip-vit-base-patch32`）


