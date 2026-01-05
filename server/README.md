本目录是后端工程根目录：负责 HTTP API、后台任务、DB 与对文件系统/AI 的编排。
输入：客户端请求 + 文件系统 + SQLite + ai-service；输出：HTTP API + 任务执行副作用（DB/缩略图/索引/文件操作）。
更新规则：入口/打包/运行方式变化时，更新本 README + `docs/README.md`。

### 文件与子目录

- `index.js`：后端进程入口（Express app、路由挂载、任务 runner、可选托管 `client/dist`）。
- `src/`：后端核心源码（见 `src/README.md`）。
- `scripts/`：运维/性能排查脚本（见 `scripts/README.md`）。
- `package.json`：后端依赖与脚本。



