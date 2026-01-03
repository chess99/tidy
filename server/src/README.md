本目录是后端核心源码（Express + SQLite），提供资产/文件/人脸等能力的 HTTP API 与后台任务。
输入：文件系统、SQLite、计算模型/算法、客户端请求；输出：HTTP API、任务队列执行、副作用（缩略图/DB/文件操作）。
更新规则：路由/DB schema/任务形状变化时，更新本 README + `docs/README.md`。

### 子目录

- `routes/`：HTTP 路由层（见 `routes/README.md`）。
- `db/`：数据库访问与 schema（见 `db/README.md`）。
- `jobs/`：后台任务系统（见 `jobs/README.md`）。
- `scanner/`：扫描/哈希/元信息/缩略图/人脸扫描等管线（见 `scanner/README.md`）。
- `services/`：领域服务（高层业务动作的复用实现）（见 `services/README.md`）。
- `sync/`：同步/变更流相关能力（见 `sync/README.md`）。
- `utils/`：通用工具（见 `utils/README.md`）。

### 文件

- `config.js`：配置读取与默认值（运行时参数入口）。
- `configStore.js`：配置持久化（读写/变更通知；任务并发仅支持 enrich/thumbs/faces/clip；thumbs 默认并发为 4）。


