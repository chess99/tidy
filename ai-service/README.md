本目录是统一 AI 推理服务（FastAPI）：承载人脸检测/embedding 与多语言 CLIP（智能搜索）推理。
输入：图片（base64/本地路径）与文本；输出：人脸框/embedding、图像/文本 embedding；供 `server` 通过 HTTP 调用。
更新规则：API/模型/依赖/目录结构变化时，更新本 README + `docs/智能搜索_CLIP.md` + `docs/README.md`。

# ai-service (Face + CLIP / Transformers)

这是一个内部使用的 **统一 AI 推理服务**：承载人脸检测/embedding 与 CLIP（图像/文本 embedding），供 `server` 调用以实现人脸系统与智能搜索。

## 文件

- `app/`：FastAPI 应用代码（见 `app/README.md`）。
- `requirements.txt`：Python 依赖（含 face + CLIP）。
- `pyrightconfig.json`：编辑器静态分析配置（避免未装 venv 时满屏 missing-import）。

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

- `TIDY_CLIP_MODEL_ID`：CLIP 模型 id 或本地路径（默认 `jinaai/jina-clip-v2`）
- `TIDY_CLIP_TRUST_REMOTE_CODE`：是否允许 Transformers `trust_remote_code`（默认开启；Jina CLIP v2 需要）


