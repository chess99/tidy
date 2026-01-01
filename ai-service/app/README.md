本目录是 Python AI 服务的应用入口（FastAPI）：为主服务提供人脸与 CLIP（智能搜索）推理能力。
输入：图片（base64 或本地路径）/文本；输出：人脸框与 embedding；CLIP 图像/文本 embedding。
更新规则：API 路由/返回结构/模型参数变化时，更新本 README + `docs/README.md`。

### 文件

- `main.py`：FastAPI 应用与 `/health`、`/detect+embed`、`/clip/*` 实现。


