本目录是桌面打包脚本入口：用于把 Node/server/client/ai-service 收集成 electron-builder 可打包的 resources。
输入：本机 Node 二进制 + `server/`(含 node_modules) + `client/dist` + `ai-service` 可执行文件；输出：`desktop/bundle/` 资源目录。
更新规则：资源布局/打包策略变化时，更新本 README + `desktop/README.md` + `docs/桌面分发.md`。

### 文件

- `prepare-resources.mjs`：生成 `desktop/bundle/`（供 electron-builder `extraResources` 使用）。
- `generate-icons.mjs`：从 `client/public/icon.png` 生成 `desktop/assets/icon.icns`/`icon.ico`/`icon.png`（供 electron-builder 使用）。


