本目录是前端“功能/页面组件”集合，负责把 API 数据与 UI 组件拼装成具体体验。
输入：React props、TanStack Query/状态、API 数据；输出：页面/面板级 UI 与交互回调。
更新规则：组件职责或目录结构变化时，更新本 README + `client/src/README.md` + `docs/README.md`。

### 子目录

- `ui/`：基础 UI 原语组件（见 `ui/README.md`）。

### 组件文件

- `AlbumsView.jsx`：相册视图（列表/选择/导航等）。
- `AlbumAssetsGrid.jsx`：相册内资产网格视图与虚拟化渲染编排。
- `FilesGrid.jsx`：文件/资产浏览网格（虚拟化 + 选择）。
- `FilesFilters.jsx`：文件筛选条件与过滤 UI（含“相似(pHash/CLIP)”与“智能搜索(CLIP)”）。
- `TrashView.jsx`：回收站视图（`assets.status='trash'` 列表 + 点击查看）。
- `DuplicatesToolView.jsx`：实用工具：检查重复项（hash/pHash 分组 + 逐组保留/删除副本）。
- `AssetViewer.jsx`：单资产查看（图片/视频）与操作入口。
- `AssetThumbCard.jsx`：网格缩略卡片（预览、选择态、标记等）。
- `ThumbPlaceholder.jsx`：缩略图占位与加载态表现。
- `SelectedDrawer.jsx`：已选资产抽屉（批量操作入口）。
- `SystemAdminView.jsx`：系统管理入口（左：配置；右：任务队列，immich 风格）。
- `TasksView.jsx`：任务队列面板（immich 风格：显示并发“正在处理”与剩余“准备处理”，并展示标准化进度/错误）。
- `SettingsView.jsx`：配置面板（扫描目录/类型/排除规则/任务并发等）。
- `MinimalScanStatus.jsx`：扫描/任务状态的轻量提示组件（失败时展示 `last_error` 并提供“刷新”）。
- `AssetFacesPanel.jsx`：资产的人脸识别/聚类面板（人物、分组、操作）。
- `VirtualGrid.jsx`：通用虚拟网格基础实现（高性能大列表渲染）。

