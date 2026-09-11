# Tidy Client

Tidy 的前端应用，使用 React、Vite、Tailwind CSS 和 TanStack Query，通过 `/api` 与本地 server 通信。

## 开发

```bash
npm install
npm run dev
```

常用验证命令：

```bash
npm run lint
npm run build
```

应用入口位于 `src/main.jsx`，根视图与全局交互编排位于 `src/App.jsx`。页面级组件集中在 `src/components/`，API 边界集中在 `src/api/`，复杂交互状态优先收敛到 `src/hooks/`。

系统管理的任务列表包含“工作目录对账”，用于在整理目录或回收站路径变化后查看轻量状态重建进度。
