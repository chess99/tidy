# Tidy 文档

Tidy 是一个**本地文件整理/去重工具**：扫描固定工作目录，把“内容（hash）”与“物理文件（path）”分离管理；所有整理/删除/标注都以内容为主键，避免“删了又复活”的问题，并支持落盘移动与崩溃恢复。

## 快速入口

- [`docs/决策记录.md`](决策记录.md)：**为什么这么设计**（定位、边界、取舍、一致性策略）。
- [`docs/设计文档.md`](设计文档.md)：**系统怎么工作**（架构、数据模型、工作流、API、配置）。
- [`docs/ROADMAP_TODOS.md`](ROADMAP_TODOS.md)：**接下来做什么**（明确 TODO、潜在方向、技术债与风险）。

## 术语表（快速对齐沟通）

- **asset（内容资产）**：以 `hash` 为主键的一份“内容”，去重后的实体（所有整理/删除/标注都应该绑在 asset 上）。
- **file（物理文件）**：磁盘上的一个路径实例 `path`，它可能与其它路径指向同一份 asset（重复副本）。
- **album（文件夹/归档）**：托管目录 `_Tidy/<name>` 下的一个真实文件夹；成员关系用 `album_assets(album_id, hash)` 记录。
- **managed root（托管目录）**：工具管理的归档根目录（默认 `<WORK_ROOT>\\_Tidy`），扫描时必须跳过。
- **trash（工具回收站）**：工具内部专用 Trash（默认 `<MANAGED_ROOT>\\_Trash`），用于去重与批量删除的落盘目标。
- **file_ops（操作日志）**：落盘 move/trash 的操作记录（`pending/done/error`），用于崩溃恢复与对账。
- **sync（对账/恢复）**：`POST /sync`，用于重放 pending ops、处理遗留 trash 标记，确保 DB 与文件系统一致。
