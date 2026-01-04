本目录实现“变更同步/对账”相关能力，用于增量更新前端与保证状态一致性。
输入：DB 变更记录/文件系统状态；输出：增量变更流、同步结果与对账信息。
更新规则：同步协议或对外暴露的变更形状变化时，更新本 README + `server/src/README.md` + `docs/README.md`。

### 文件

- `index.js`：同步/变更流的入口实现（重放 `file_ops(move/trash/delete)`；成功落盘时会清理 `assets.missing`；trash 会保留最后一份副本用于回收站展示）。


