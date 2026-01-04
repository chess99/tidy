本目录提供每个任务类型的具体处理逻辑，约定输入为 job payload，输出为进度/结果写回。
输入：job payload + DB/文件系统/服务层；输出：任务进度更新、派生作业、最终结果。
更新规则：新增/修改 handler 或其 payload/副作用变化时，更新本 README + `server/src/jobs/README.md`。

### 文件

- `_util.js`：handler 共享工具（进度上报、批处理辅助等）。
- `index.js`：handler 注册表（任务类型 -> 实现）。
- `discover.js`：发现/扫描类任务（库遍历、入库触发；重新发现已知 hash 时会清理 `assets.missing`）。
- `enrich.js`：补全/丰富元信息类任务（hash/metadata/thumb/pHash + 基于文件路径重建 `sorted/trash` 与 album 映射；缺失路径会删除 `files` 行，并按 `assets.status` 决定 `assets.missing`/删除 `assets`）。
- `thumbsRebuild.js`：缩略图重建任务。
- `facesScan.js`：人脸扫描任务（检测/嵌入/写库）。
- `facesReset.js`：人脸数据重置任务（清理/回收）。
- `facesRecluster.js`：人脸重新聚类任务（人物分组重算）。
- `clipEnrich.js`：CLIP embedding 补算任务（写入 `clip_embeddings`，用于智能搜索/找相似）。
- `clipIndex.js`：CLIP 索引重建任务（构建 HNSW 索引文件，用于 ANN 近邻检索）。

### 重要约定

- **任务并发**：`thumbsRebuild/facesScan/clipEnrich` 会读取 `config.tasks.concurrency` 对应字段作为内部并发（与 UI 的“正在处理”一致）。
- **skipped 语义**：SQL 会尽量前置过滤；仍可能因文件被删除/路径不可读/竞态等在 worker 内被记为 skipped（best-effort，避免额外 DB/IO 成本）。
- **CLIP 全量**：`clipEnrich(mode=all)` 会强制重算可用图片的 embedding（模型切换/校准后使用）。
- `sync.js`：同步/对账类任务。
- `placeholder.js`：占位/示例任务（开发期或空实现）。

