# Tidy 文档

Tidy 是一个**本地文件整理/去重工具**：扫描固定工作目录，把“内容（hash）”与“物理文件（path）”分离管理；所有整理/删除/标注都以内容为主键，避免“删了又复活”的问题，并支持落盘移动与崩溃恢复。

## 快速入口

- [`docs/决策记录.md`](决策记录.md)：**为什么这么设计**（定位、边界、取舍、一致性策略）。
- [`docs/设计文档.md`](设计文档.md)：**系统怎么工作**（架构、数据模型、工作流、API、配置）。
- [`docs/开发指南.md`](开发指南.md)：**怎么跑起来/怎么开发**（本地启动、可选能力初始化）。
- [`docs/人脸系统.md`](人脸系统.md)：**人脸系统说明**（入库/聚类/筛选/脚本/接口/face-service 后续接入）。
- [`docs/系统管理UI.md`](系统管理UI.md)：**系统管理界面**（配置与任务队列一屏完成，immich 风格）。
- **实用工具**：主界面右上角扳手入口（包含“检查重复项”：hash + pHash 相似度分组处理）。
- [`docs/ROADMAP_TODOS.md`](ROADMAP_TODOS.md)：**接下来做什么**（明确 TODO、潜在方向、技术债与风险）。

## 分形自指文档（强约束）

- **源码目录入口**：
  - `client/src/README.md`：前端入口与组件分层索引（逐层下钻）。
  - `server/src/README.md`：后端入口（routes/db/jobs/scanner/services 分层索引）。
  - `face-service/app/README.md`：人脸服务入口。
- **文件头注释**：每个源码文件开头必须有 3 行 `input/output/pos`（pos 行包含“变更需同步更新头注释与所属目录 README”）。
- **自动校验**：
  - `npm run doc:check`：检查所有源码目录 README 与文件头注释是否齐全。
  - `npm run doc:add-headers`：为缺失头注释的源码文件补齐 3 行头注释（首次初始化/批量修复用）。

## 术语表（快速对齐沟通）

- **asset（内容资产）**：以 `hash` 为主键的一份“内容”，去重后的实体（所有整理/删除/标注都应该绑在 asset 上）。
- **file（物理文件）**：磁盘上的一个路径实例 `path`，它可能与其它路径指向同一份 asset（重复副本）。
- **album（文件夹/归档）**：托管目录 `_Tidy/<name>` 下的一个真实文件夹；成员关系用 `album_assets(album_id, hash)` 记录。
- **managed root（托管目录）**：工具管理的归档根目录（默认 `<WORK_ROOT>\\_Tidy`），**会被扫描**；其中文件被视为“已整理（sorted）”的事实来源（用于 DB 丢失/损坏时重建状态）。
- **trash（工具回收站）**：工具回收站目录（默认 `<MANAGED_ROOT>\\_Trash`），**会被扫描**；其中文件代表“已删除（trash）”内容的**最后留底**（用于恢复/对账）。
- **file_ops（操作日志）**：落盘 `move/trash/delete` 的操作记录（`pending/done/error`），用于崩溃恢复与对账。
- **sync（对账/恢复）**：`POST /sync`，用于重放 pending ops、处理遗留 trash 标记，确保 DB 与文件系统一致。
- **pHash（感知哈希）**：图片相似度特征（存于 `files.phash`），用于“检查重复项”里的相似重复检测。
