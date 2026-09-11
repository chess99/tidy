# Tidy Desktop

桌面分发层使用 Electron 拉起本地 `server` 与 `ai-service`，并加载前端界面。

### 文件

- `package.json`：桌面壳依赖与打包脚本（electron/electron-builder）。
- `src/main.cjs`：Electron 主进程入口（单实例窗口 + sidecar 启停 + 更新提示；后端和真实 UI 就绪后才显示窗口；开发模式直接使用仓库 `data/`）。
- `src/ports.cjs`：端口选择（server 同时检查 IPv4/IPv6 占用；冲突时回退到空闲端口）。
- `src/sidecars.cjs`：拉起/关闭 Node server 与 ai-service（开发模式显式使用项目/系统运行时；正式包只允许随包二进制，缺失即报错）。
- `scripts/`：打包脚本入口，生成 `bundle/`，并排除开发数据库、`.env`、测试与缓存。
