本目录提供每个任务类型的具体处理逻辑，约定输入为 job payload，输出为进度/结果写回。
输入：job payload + DB/文件系统/服务层；输出：任务进度更新、派生作业、最终结果。
更新规则：新增/修改 handler 或其 payload/副作用变化时，更新本 README + `server/src/jobs/README.md`。

### 文件

- `_util.js`：handler 共享工具（进度上报、批处理辅助等）。
- `index.js`：handler 注册表（任务类型 -> 实现）。
- `discover.js`：发现/扫描类任务（库遍历、入库触发；包含 `MANAGED_ROOT/TRASH_DIR` 用于恢复）。
- `enrich.js`：补全/丰富元信息类任务（hash/metadata/thumb + 基于文件路径重建 `sorted/trash` 与 album 映射）。
- `thumbsRebuild.js`：缩略图重建任务。
- `facesScan.js`：人脸扫描任务（检测/嵌入/写库）。
- `facesReset.js`：人脸数据重置任务（清理/回收）。
- `facesRecluster.js`：人脸重新聚类任务（人物分组重算）。
- `sync.js`：同步/对账类任务。
- `placeholder.js`：占位/示例任务（开发期或空实现）。


