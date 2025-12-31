本目录是前端“功能/页面组件”集合，负责把 API 数据与 UI 组件拼装成具体体验。
输入：React props、TanStack Query/状态、API 数据；输出：页面/面板级 UI 与交互回调。
更新规则：组件职责或目录结构变化时，更新本 README + `client/src/README.md` + `docs/README.md`。

### 子目录

- `ui/`：基础 UI 原语组件（见 `ui/README.md`）。

### 组件文件

- `AlbumsView.jsx`：相册视图（列表/选择/导航等）。
- `AlbumAssetsGrid.jsx`：相册内资产网格视图与虚拟化渲染编排。
- `FilesGrid.jsx`：文件/资产浏览网格（虚拟化 + 选择）。
- `FilesFilters.jsx`：文件筛选条件与过滤 UI。
- `AssetViewer.jsx`：单资产查看（图片/视频）与操作入口。
- `AssetThumbCard.jsx`：网格缩略卡片（预览、选择态、标记等）。
- `ThumbPlaceholder.jsx`：缩略图占位与加载态表现。
- `SelectedDrawer.jsx`：已选资产抽屉（批量操作入口）。
- `JobsStatusSidebar.jsx`：后台任务状态侧栏（进度/日志/操作）。
- `TasksView.jsx`：任务管理页面（触发扫描/重建等）。
- `SettingsView.jsx`：设置页面（配置项编辑/保存）。
- `MinimalScanStatus.jsx`：扫描状态的轻量提示组件。
- `AssetFacesPanel.jsx`：资产的人脸识别/聚类面板（人物、分组、操作）。
- `VirtualGrid.jsx`：通用虚拟网格基础实现（高性能大列表渲染）。


