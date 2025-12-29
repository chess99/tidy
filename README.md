# Tidy

Tidy 是一个**本地照片/视频整理与去重工具**：以内容哈希（`hash`）作为核心主键，把“内容资产（asset）”与“物理文件路径（file）”解耦管理，从而实现稳定去重、可恢复的一致性落盘操作。

## 功能概览

- **扫描入库**：递归扫描目录，提取元信息，计算内容 hash，生成缩略图（best-effort）。
- **内容去重**：同一份内容可对应多个物理路径；整理时可“保留一份，其余入工具 Trash”。
- **可恢复一致性**：通过操作日志与对账机制，处理中断/崩溃后的恢复。
- **大库浏览**：前端虚拟列表 + 增量更新，能浏览大量文件。

## 架构

- **Server**：Node.js + Express + SQLite + Sharp
- **Client**：React + Vite + TailwindCSS + TanStack Query

## 文档

- `docs/README.md`（入口）
