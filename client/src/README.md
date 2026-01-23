本目录是前端应用源码（React/Vite），负责 UI 交互与状态编排。
输入：浏览器环境 + `server` 提供的 HTTP API；输出：可操作的界面与用户动作。
更新规则：本目录结构/文件/职责变化时，更新本 README + `docs/README.md`。

### 文件与子目录

- `main.jsx`：Vite 入口；挂载 React 应用与全局 Provider。
- `App.jsx`：应用根组件；页面布局与视图编排（主界面 Files/Albums + 系统管理入口）。
- `api/`：后端 API 调用封装（见 `api/README.md`）。
- `components/`：页面/功能组件与 UI 组件集合（见 `components/README.md`）。
- `hooks/`：可复用 hooks（见 `hooks/README.md`）。
- `utils/`：纯函数工具与显示/布局辅助（见 `utils/README.md`）。
- `lib/`：第三方风格的通用工具封装（见 `lib/README.md`）。
- `index.css`：全局样式入口（通常包含 Tailwind 基础层）。
- `App.css`：App 层级样式（仅用于 App 级别的少量补充）。
- `assets/`：前端静态资源（示例/图标等）。

> 说明：Files 页的“智能搜索（CLIP）”与“相似(pHash/CLIP)”属于同一套列表展示链路（`FilesFilters` 先维护输入草稿，勾勾/Enter 应用后写入 query 状态 → `FilesGrid` 通过 `POST /api/files` 拉取并渲染），避免输入过程中频繁触发重的推理请求。

> 说明：缺失内容不会出现在 Files（全部文件）里；相册/回收站等资产视图会通过 `assets.missing` 置灰提示“语义保留但无实例”。


