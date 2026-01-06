本目录是桌面分发入口：用 Electron 作为壳，拉起本地 `server` 与 `ai-service`，并打开 UI。
输入：本机文件系统/用户配置/网络（可选：提示式更新与模型下载）；输出：一键可运行的桌面应用（Win/macOS）。
更新规则：进程编排/打包产物/数据目录规则变化时，更新本 README + `docs/README.md`。

### 文件

- `package.json`：桌面壳依赖与打包脚本（electron/electron-builder）。
- `src/main.cjs`：Electron 主进程入口（窗口 + sidecar 启停 + 更新提示）。
- `src/ports.cjs`：端口选择（优先固定端口，冲突时回退到空闲端口）。
- `src/sidecars.cjs`：拉起/关闭 Node server 与 ai-service（dev 模式用系统 node/python；分发模式用随包二进制）。
- `scripts/`：打包脚本入口（生成 `bundle/` 资源目录供 electron-builder 打包）（见 `scripts/README.md`）。



