本目录是桌面主进程源码：负责窗口、进程编排（server/ai-service）、数据目录与更新提示。
输入：Electron 运行时 + 本机文件系统 + 子进程（node/python）；输出：可交互桌面窗口 + 后端/AI 子进程生命周期管理。
更新规则：进程/端口/数据目录/更新策略变更时，更新本 README + `desktop/README.md` + `docs/README.md`。

### 文件

- `main.cjs`：主进程入口（单实例窗口、区分开发/正式数据目录、记录实际启动路径、启动 sidecars、退出清理）。
- `ports.cjs`：端口选择/探测工具（优先固定端口，冲突则回退）。
- `sidecars.cjs`：启动/停止 Node server 与 ai-service（开发模式使用明确的本地运行时；正式包缺少随包运行时即失败）。
- `update.cjs`：提示式更新（manifest 检查 + 弹窗 + 打开下载链接）。
- `logging.cjs`：日志目录与落盘（desktop/server/ai 的 stdout/stderr）。
