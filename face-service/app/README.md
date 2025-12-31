本目录是 Python 人脸服务的应用入口（FastAPI + InsightFace），为主服务提供检测与 embedding 计算。
输入：base64 编码的图片；输出：人脸框、关键点（可选）、embedding 向量与置信度。
更新规则：API 路由/返回结构/模型参数变化时，更新本 README + `docs/README.md`。

### 文件

- `main.py`：FastAPI 应用与 `/health`、`/detect+embed` 实现。


