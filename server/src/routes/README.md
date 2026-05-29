本目录是 HTTP 路由层：把请求映射为领域动作，做最小的参数校验与返回组装。
输入：Express `req/res`、鉴权/配置；输出：稳定的 JSON 响应与错误语义。
更新规则：新增/修改/删除路由或返回结构时，更新本 README + `server/src/README.md` + `docs/README.md`。

### 文件

- `health.js`：健康检查（桌面壳启动等待后端 ready 用）。
- `assets.js`：资产相关 API（查询、预览、标记；回收站语义：仅保留最后一份副本到配置的回收站目录）。
- `files.js`：文件路径/文件实体相关 API（“全部文件”仅代表**现存物理实例**；缺失实例会从 `files` 删除；并排除 `assets.status='trash'`；支持相似(pHash/CLIP)与智能搜索（text→image，按相似度排序））。
- `albums.js`：相册相关 API（相册内展示字段优先使用 `assets.target_path`，避免依赖 `files` 行）。
- `faces.js`：人脸检测/聚类/人物相关 API。
- `tags.js`：标签相关 API。
- `organize.js`：整理/去重/移动等操作 API（默认保留额外副本；显式去重时移动到 `TRASH_DIR/.quarantine`）。
- `duplicates.js`：实用工具：重复项分组与应用（hash 完全重复 + pHash 相似重复）。
- `jobs.js`：后台任务控制与状态查询 API。
- `changes.js`：变更流/增量更新相关 API。
- `library.js`：库级信息（根目录、统计等）API。
- `config.js`：配置读取/写入 API（扫描根、类型、任务、**工作区路径**）。`PUT /config/workspace` 更新托管目录与回收站目录（界面可配置）。
