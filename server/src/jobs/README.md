本目录是后台任务系统：定义任务类型、执行器、状态存储与处理器注册。
输入：任务请求（来自 API/脚本）、配置与 DB；输出：任务执行结果、进度与可观测状态。
更新规则：任务类型/状态模型/处理器编排变化时，更新本 README + `server/src/README.md` + `docs/README.md`。

### 子目录

- `handlers/`：具体任务处理器集合（见 `handlers/README.md`）。

### 文件

- `constants.js`：任务类型/状态等常量定义。
- `store.js`：任务状态存储（创建、更新、查询）。
- `runner.js`：任务执行器（调度、并发/串行控制、生命周期）。
  - stale 判定阈值为小时级，避免误杀长推理任务（如首次加载/下载模型的 CLIP embedding 补算）。
  - 任务类型补充：`clip_enrich`（补算 CLIP embedding）、`clip_index`（重建 CLIP HNSW 索引）。


