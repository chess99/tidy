本目录封装 SQLite 的 schema 与访问入口，保证数据层边界清晰。
输入：SQL 连接/迁移需求；输出：结构化 schema 与 DB 访问句柄/查询工具。
更新规则：schema 或 DB 访问方式变化时，更新本 README + `server/src/README.md` + `docs/README.md`。

### 文件

- `schema.js`：数据库表结构与初始化 DDL（`assets.missing` 表示“语义保留但磁盘无实例”；含 `file_ops(move/trash/delete)`）。
- `index.js`：数据库连接与迁移入口（自动补齐新增列与索引，如 `assets.missing`；含不可 ALTER 的 CHECK 约束重建迁移）。

