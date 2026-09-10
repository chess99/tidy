本目录提供可复用的业务/视图 hooks，用于把复杂交互状态逻辑从组件中抽离。
输入：组件参数、Query/状态、事件流；输出：可复用的 state + handlers。
更新规则：hook 的输入/输出契约变化时，更新本 README + `client/src/README.md`。

### 文件

- `useFilesGridController.js`：文件/资产网格控制器（光标焦点、按当前响应式列数进行键盘导航、刷子选择；优先读 React Query 的列表页缓存，减少光标移动导致的多余 `/files` 请求）。
- `useResponsiveGridMetrics.js`：监听网格容器宽度，输出自适应列数、4:3 缩略图高度和虚拟行高。

