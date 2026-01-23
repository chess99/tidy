---
input: CLIP 模型/向量检索概念 + 本仓库实现细节
output: 智能搜索与相似检索的原理/阈值/任务流/运维要点
pos: 文档：指导智能搜索（CLIP）功能维护与调参（变更需同步更新本文件与 docs/README.md）
---

## 0. 这篇文档讲什么

这篇文档解释 Tidy 的两类 CLIP 能力：
- **智能搜索（text→image）**：输入文字，返回最相关的图片
- **相似检索（image→image）**：选定图片，返回最相似的图片

并回答三个维护层面的关键问题：
- **score 是什么**（数值含义/范围）
- **minScore 怎么调**（阈值语义）
- **索引/增量怎么跑**（jobs 与索引文件）

## 1. 为什么用 CLIP

### 1.1 pHash 的定位（它解决什么）
pHash 适合“近重复检测”（压缩、尺寸变化、轻微噪声）。它把图片映射成 64-bit 指纹，用 **汉明距离**做度量：快、存储小、实现简单。

但 pHash：
- 不支持“文本搜图”
- 对裁剪/调色/滤镜/水印等编辑变化鲁棒性有限

### 1.2 CLIP 的定位（它解决什么）
CLIP（Contrastive Language-Image Pretraining）把 **图片**与**文本**映射到同一个向量空间，因此天然支持：
- **text→image（智能搜索）**：文本 embedding 与图片 embedding 的近邻检索
- **image→image（相似图片）**：图片 embedding 与图片 embedding 的近邻检索

代价：需要推理（生成 embedding）+ 向量存储 + ANN 索引（近邻检索）。

## 2. 分数（score）的数学含义：cosine similarity

本项目把 embedding 先做 **L2 normalize**，再用 **cosine similarity（余弦相似度）**作为分数：

归一化：

$$
\hat{x} = \frac{x}{\|x\|}, \quad \hat{y} = \frac{y}{\|y\|}
$$

分数（点积）：

$$
score = \hat{x} \cdot \hat{y}
$$

性质：
- **越大越相似**
- 理论范围 $[-1, 1]$，实际多数落在 $[0, 1]$

### 2.1 阈值（minScore）的含义
`minScore` 是最低相似度门槛：
- 越大 → 结果更少、更准
- 越小 → 结果更多、噪声更大

经验起步：**0.25 ~ 0.35**（最终要按你库的分布校准）。

> 注意：CLIP score 不是概率/百分比，它只是向量空间里的相对相似度量。

## 3. 系统数据流（本仓库实现）

### 3.1 ai-service：统一 AI 推理服务（只推理，不持久化）
目录：`ai-service/`

提供 CLIP 推理接口：
- `POST /clip/text-embed`
- `POST /clip/image-embed`

模型由 `TIDY_CLIP_MODEL_ID` 控制（默认 `jinaai/jina-clip-v2`）。

> 约束：server 侧 `CLIP_MODEL_ID` 需要与 ai-service 侧模型一致（否则 embedding/索引语义不一致）。

### 3.2 server：持久化 + 检索
目录：`server/`

- **持久化（SQLite）**
  - `clip_embeddings`：保存 embedding（BLOB）
  - `clip_index_meta`：保存索引元信息
- **索引（HNSW）**
  - 索引文件：`server/data/index/clip_hnsw.bin`
  - 代码：`server/src/services/clipIndex.js`

### 3.3 jobs：补算与重建
任务类型：
- `clip_enrich`：补算 embedding 并写入 `clip_embeddings`
- `clip_index`：从 `clip_embeddings` 重建 HNSW 索引

推荐流程：
1. 跑 `clip_enrich`（missing/all 视情况）
2. 跑 `clip_index`（rebuild）
3. 前端可用智能搜索与 CLIP 相似

> 重要：`POST /api/files`（`smartQuery`）与 `similarKind=clip` 不会在请求路径自动重建索引；如果索引未就绪，会返回 **409** 并提示先跑 `clip_index`。

## 4. API 形态

### 4.1 智能搜索（text→image）
- `POST /api/files`
  - body：`{ smartQuery, page, limit, smartTopK, smartMinScore, ...filters }`
  - 返回：按相似度排序的 files 列表（每条带 `score`），支持与其它筛选条件叠加
  - 失败：索引未就绪时返回 **409**（需要先跑 `clip_index`）
  - 调试：加请求头 `x-tidy-profile: 1` 或 query `?profile=1`，响应会附带 `profile`（分段耗时 + CPU/内存增量 + event loop 延迟），用于定位慢点；ai-service 的 `/clip/*` 同样支持该 profiling
  - 交互：前端对智能搜索采用“输入草稿 + 应用按钮/⌘(Ctrl)+Enter 手动应用”（输入框支持多行长文本），避免 IME 拼写阶段连发多个重请求（否则会导致 ai-service 推理并发争用与排队长尾）；同时前端 viewport 虚拟化可能并行拉多页，服务端对 `clipTextEmbed` 做缓存/并发去重/落盘以避免同 query 重复推理

### 4.2 相似检索（image→image）
- `GET /api/files?similarKind=clip&similarToFileId=...&similarTopK=...&similarMinScore=...`
  - 返回：按相似度排序的 files 列表（每条带 `score`）

## 5. 重要边界与注意事项

- **排序语义**：智能搜索/CLIP 相似是“按相似度排序”，不是按时间排序
  - 因此前端 date-index（月跳转）会被禁用/降级
- **一致性**：模型切换（维度/分布变化）必须清理旧向量并重建索引
- **性能**：1–20 万量级下，HNSW 查询通常毫秒级；主要耗时在 embedding 补算（推理）

## 6. 配置（env）

- `AI_SERVICE_URL`：server 调用 ai-service 的 baseURL（默认 `http://localhost:8002`）
- `CLIP_MODEL_ID`：server 侧期望的模型 id
- `TIDY_CLIP_MODEL_ID`：ai-service 侧 CLIP 模型 id 或本地路径
- `TIDY_CLIP_TEXT_EMBED_CACHE_MAX`：server 侧 `clipTextEmbed` 进程内缓存条目上限（默认 `200`）
- `TIDY_CLIP_TEXT_EMBED_CACHE_TTL_MS`：server 侧 `clipTextEmbed` 缓存 TTL（默认 `300000`，即 5 分钟）
- `TIDY_CLIP_TEXT_EMBED_DB_CACHE_MAX`：server 侧 `clipTextEmbed` SQLite 持久缓存条目上限（默认 `20000`；按 `model+normalize+text` 去重，跨重启生效）
- `TIDY_CLIP_CONCURRENCY`：ai-service 侧 CLIP 推理并发（默认 `1`；提高并发可能导致 CPU/MPS/CUDA 争用与长尾，调参需结合 profiling 中的 `clip.slot.waitMs` 观察排队）

---

智能搜索已与 `/api/files` 的筛选语义合并；过滤条件会在相似度排序结果上继续生效。


