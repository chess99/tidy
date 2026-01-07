本目录提供可复用的业务/视图 hooks，用于把复杂交互状态逻辑从组件中抽离。
输入：组件参数、Query/状态、事件流；输出：可复用的 state + handlers。
更新规则：hook 的输入/输出契约变化时，更新本 README + `client/src/README.md`。

### 文件

- `useFilesGridController.js`：文件/资产网格控制器（光标焦点、键盘导航、刷子选择；筛选变更时尽量保持 cursor 对齐，避免点击/选中等纯交互触发多余的列表拉取）。


