# Tidy Server

后端负责 HTTP API、后台任务、SQLite 数据以及文件系统和 AI 服务的编排。

### 文件与子目录

- `index.js`：后端进程入口（Express app、路由挂载、任务 runner、可选托管 `client/dist`；启动时做 CLIP 索引/智能搜索 warmup）。
- `src/`：后端核心源码。
- `scripts/`：运维与性能排查脚本；`migrate-clip-model.js` 可在开发服务热重载期间独立、断点续跑地迁移 CLIP 向量模型。
- `package.json`：后端依赖与脚本。
- `jest.config.js`：Jest 测试配置。
- `src/**/__tests__/`：单元测试（运行 `npm test`）。

工作目录实际变化时会自动排队 `workspace_reconcile`：只按新旧 `MANAGED_ROOT/TRASH_DIR` 重建资产状态和相册关系，不重新处理媒体或触发 AI 管线。

server 进程启动时会立即把遗留的 `running` 任务标记为 `interrupted`；这些任务属于已退出的旧进程，不能按近期 heartbeat 继续假装运行。
