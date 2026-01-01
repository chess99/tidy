本目录是领域服务层：把跨路由/跨任务可复用的高层业务动作收敛为纯服务接口。
输入：DB/文件系统/配置；输出：可复用的领域操作（清理、聚类、批处理等）。
更新规则：服务 API 或副作用变化时，更新本 README + `server/src/README.md` + `docs/README.md`。

### 文件

- `clearByRoot.js`：按库根目录清理/回收相关数据与派生文件。
- `aiClient.js`：AI 服务客户端（调用 `ai-service` 的 CLIP 推理接口）。
- `clipIndex.js`：CLIP 向量索引（HNSW）构建/加载/查询（智能搜索/相似检索）。
- `faceClustering.js`：人脸聚类算法/流程封装。
- `reclusterPeople.js`：人物重聚类的高层编排（可能组合 DB + clustering + job）。


