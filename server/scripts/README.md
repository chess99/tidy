本目录是后端的“运维/调试脚本”集合，用于排查 DB/扫描/人脸/CLIP 等问题。
输入：本地 `server`/DB/ai-service 与脚本参数；输出：一次性诊断/修复/报告结果。
更新规则：目录内脚本新增/删除/职责变化时，更新本 README + `server/src/README.md` + `docs/README.md`。

### 脚本

- `profile-search.js`：请求 `/api/search?profile=1` 并打印 server/ai-service profiling 关键步骤摘要（定位排队/推理长尾）。
- `profile-clip-text-embed.js`：并发请求 `/clip/text-embed?profile=1` 并汇总 `totalMs/waitMs`（验证 ai-service 并发/排队）。
- `debug-perf.js`：DB 查询/执行计划的性能诊断样例（用于定位 files 列表查询慢点）。
- `repair-db.js`：修复/校验 DB 的结构与一致性（按脚本内说明执行）。
- `report-db-exts.js`：统计 DB 中的扩展名分布，辅助配置扫描类型与过滤。
- `verify-path-case.js`：检查路径大小写一致性，避免跨平台/大小写敏感文件系统问题。
- `analyze-ignored.js`：分析扫描忽略规则命中情况，辅助排查“为何没入库”。
- `setup-models.js`：初始化/准备 server 侧模型资源（如需要）。
- `scan-faces.js`：批量扫描人脸（写入 faces 相关表/输出诊断）。
- `scan-one-face.js`：对单个目标做 face 扫描定位问题。
- `clear-faces.js`：清理 faces 数据（用于重跑/重建）。
- `cluster-calibrate.js`：人脸聚类阈值/参数校准辅助脚本。
- `recluster-people.js`：触发/执行人物重聚类。
- `test-raw-thumbs.js`：缩略图生成链路诊断（IO/编码/路径问题）。


