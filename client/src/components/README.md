本目录是前端“功能/页面组件”集合，负责把 API 数据与 UI 组件拼装成具体体验。
输入：React props、TanStack Query/状态、API 数据；输出：页面/面板级 UI 与交互回调。
更新规则：组件职责或目录结构变化时，更新本 README + `client/src/README.md` + `docs/README.md`。

### 子目录

- `ui/`：基础 UI 原语组件（见 `ui/README.md`）。

### 组件文件

- `AlbumsView.jsx`：相册视图（列表/选择/导航等）。
- `AlbumAssetsGrid.jsx`：相册内资产网格视图与响应式虚拟化渲染编排（基于 `assets.missing` 置灰缺失项）。
- `FilesGrid.jsx`：文件/资产浏览网格（响应式列数 + 虚拟化 + 选择；CLIP 索引迁移期间显示可恢复提示并定期检查，避免把正常迁移渲染成搜索失败）。
- `FilesFilters.jsx`：文件筛选与左上角智能搜索入口。日期筛选的开始与结束日期可独立设置、清空和回显；人物筛选通过带头像的选择弹层完成多选；智能搜索可在文字描述和临时参考图之间切换，参考图支持选择、拖放、粘贴及预览，上传后不进入图库，清除或替换时释放短期搜索会话。文字搜索仍采用输入草稿后手动应用，避免输入期间反复触发推理。
- `PeopleFilterDialog.jsx`：人物筛选弹层（头像平铺、姓名或 ID 搜索、多选草稿与已选人物回显）。
- `TrashView.jsx`：回收站视图（响应式虚拟网格 + 点击查看；若 `assets.missing=1` 则置灰提示缺失）。
- `DuplicatesToolView.jsx`：实用工具：检查重复项（hash/pHash 分组 + 逐组保留/删除副本）。
- `AssetViewer.jsx`：单资产查看（图片/视频）与操作入口；“在文件夹中显示”统一由后端执行一次系统定位。
- `AssetDetail.jsx`：固定宽度的详情侧栏；宽屏常驻并显示空态，窄屏选中时覆盖显示，选择和清空详情都不会触发媒体网格重排。
- `AssetThumbCard.jsx`：网格缩略卡片（4:3 完整画面预览、中性补边、两行文件信息、选择态、标记等）。
- `ThumbPlaceholder.jsx`：缩略图占位与加载态表现。
- `SelectedDrawer.jsx`：已选资产抽屉（批量操作入口）。
- `SystemAdminView.jsx`：系统管理入口（左：配置；右：任务队列，immich 风格）。
- `SettingsViewSimple.jsx`：核心配置页；配置读取失败时显示原始错误，禁止伪装为空白首次使用状态。
- `TasksView.jsx`：任务队列面板（immich 风格：显示并发“正在处理”与剩余“准备处理”，并展示标准化进度/错误）。
- `SettingsView.jsx`：配置面板（扫描目录/类型/排除规则/任务并发等）。
- `MinimalScanStatus.jsx`：Header 内的任务状态 chip（运行/等待/失败聚合展示，点击 popover 查看进度与进入任务队列）。
- `AssetFacesPanel.jsx`：资产的人脸识别/聚类面板（人物、分组、操作）。
- `VirtualGrid.jsx`：通用虚拟网格基础实现（高性能大列表渲染）。
