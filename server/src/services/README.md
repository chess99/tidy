本目录是领域服务层：把跨路由/跨任务可复用的高层业务动作收敛为纯服务接口。
输入：DB/文件系统/配置；输出：可复用的领域操作（清理、聚类、批处理等）。
更新规则：服务 API 或副作用变化时，更新本 README + `server/src/README.md` + `docs/README.md`。

### 文件

- `clearByRoot.js`：按库根目录清理/回收相关数据与派生文件。
- `missingPolicy.js`：缺失治理策略复用（删除缺失 `files`；按 `assets.status` 决定 `assets.missing`/删除 `assets`；供任务与修复脚本共用）。
- `aiClient.js`：AI 服务客户端（调用 `ai-service` 的人脸检测与 CLIP 推理接口；`clipTextEmbed` 带进程内缓存 + 并发去重 + SQLite 持久缓存；临时参考图可直接以内存字节推理，不需要落盘；支持可选 `profile` 埋点）。
- `imageSearchSessions.js`：以图搜图的短期内存会话；只保存参考图 embedding 以支持结果翻页，不写数据库、图片文件或 CLIP 索引，并在超时或容量淘汰后失效。
- `clipIndex.js`：CLIP 向量索引（HNSW）构建/加载/查询（智能搜索/相似检索；索引未就绪会返回 409，需先跑 `clip_index` 任务；支持可选 `profile` 埋点）。
- `faceClustering.js`：人脸聚类算法/流程封装。
- `reclusterPeople.js`：人物重聚类的高层编排（可能组合 DB + clustering + job）。

