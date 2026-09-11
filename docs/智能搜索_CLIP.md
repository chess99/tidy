## 0. 这篇文档讲什么

这篇文档解释 Tidy 的三种 CLIP 使用方式：
- **智能搜索（text→image）**：输入文字，返回最相关的图片
- **临时参考图搜索（image→image）**：额外提供一张不入库的参考图，返回最相似的图库图片
- **图库相似检索（image→image）**：选定图库内图片，返回最相似的图片

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

> 约束：server 与 ai-service 共用 `TIDY_CLIP_MODEL_ID`。健康检查会校验两端模型标识；不一致时阻止补算，避免混写向量空间。

### 3.2 server：持久化 + 检索
目录：`server/`

- **持久化（SQLite）**
  - `clip_embeddings`：保存 embedding（BLOB）
  - `clip_index_meta`：保存索引元信息
- **索引（HNSW）**
  - 索引文件：`DATA_DIR/index/clip_hnsw.bin`（V8 structured binary，避免高维大图库 JSON 序列化超过字符串上限）
  - 代码：`server/src/services/clipIndex.js`

### 3.3 jobs：补算与重建
任务类型：
- `clip_enrich`：补算 embedding 并写入 `clip_embeddings`
- `clip_index`：从 `clip_embeddings` 重建 HNSW 索引

推荐流程：
1. 跑 `clip_enrich`（missing/all 视情况）
2. 跑 `clip_index`（rebuild）
3. 前端可用智能搜索与 CLIP 相似

开发环境切换模型且预计补算时间较长时，使用独立迁移脚本，避免后端热重载中断任务：

```powershell
cd server
npm run clip:migrate -- --from-model "旧模型标识或绝对路径" --to-model "jinaai/jina-clip-v2" --db "数据库绝对路径"
```

脚本只选择缺少目标模型向量的资产，因此中断后可直接用同一命令续跑。所有目标向量生成后，它会重建目标模型索引、校验模型与维度，再删除明确指定的旧模型派生向量和文本缓存；图片原文件不会被修改。无法解码的单个图片会被记录为永久错误并跳过，网络或 AI 服务重启等瞬态错误会在原地重试。

> 重要：`POST /api/files`（`smartQuery` / `imageSearchId`）与 `similarKind=clip` 不会在请求路径自动重建索引；迁移期间返回可识别的 **409** 状态，前端显示等待提示并定期检查。补算结束后会自动排队重建索引。

## 4. API 形态

### 4.1 智能搜索（text→image）
- `POST /api/files`
  - body：`{ smartQuery, page, limit, smartTopK, smartMinScore, ...filters }`
  - 返回：按相似度排序的 files 列表（每条带 `score`），支持与其它筛选条件叠加
  - 失败：索引未就绪时返回 **409**（需要先跑 `clip_index`）
  - 调试：加请求头 `x-tidy-profile: 1` 或 query `?profile=1`，响应会附带 `profile`（分段耗时 + CPU/内存增量 + event loop 延迟），用于定位慢点；ai-service 的 `/clip/*` 同样支持该 profiling
  - 交互：前端先维护输入草稿，点击搜索或按 Enter 后才应用，避免 IME 拼写阶段连发多个重请求；前端 viewport 虚拟化可能并行拉多页，服务端对 `clipTextEmbed` 做缓存/并发去重/落盘以避免同 query 重复推理

### 4.2 临时参考图搜索（image→image，不入库）
- `POST /api/files/image-search`
  - 请求体：原始图片字节，`Content-Type` 为 `image/*` 或 `application/octet-stream`，最大 20 MB
  - 返回：`{ imageSearchId, expiresAt }`
  - 行为：图片字节直接交给 ai-service 生成 embedding；server 只在内存中保存 30 分钟的向量会话，不保存原图、不写 SQLite、不修改 HNSW 索引
- `POST /api/files`
  - body：`{ imageSearchId, page, limit, smartTopK, smartMinScore, ...filters }`
  - 返回：按相似度排序的 files 列表；翻页只复用短期会话，不会重复上传或推理参考图
  - 过期：会话不存在、服务重启或超过 TTL 时返回 **410**，前端提示重新选择参考图
- `DELETE /api/files/image-search/:id`
  - 用户清除或替换参考图时主动释放会话；服务端也会按 TTL 和容量自动淘汰

前端入口位于左上角「智能搜索 → 图片」，支持文件选择、拖放和从剪贴板粘贴。文字搜索、临时参考图搜索和图库相似检索互斥，但都可以继续叠加日期、文件类型、人物等普通筛选。

### 4.3 图库相似检索（image→image）
- `GET /api/files?similarKind=clip&similarToFileId=...&similarTopK=...&similarMinScore=...`
  - 返回：按相似度排序的 files 列表（每条带 `score`）

## 5. 重要边界与注意事项

- **排序语义**：文字搜索、以图搜图和 CLIP 相似都是“按相似度排序”，不是按时间排序
  - 因此前端 date-index（月跳转）会被禁用/降级
- **一致性**：模型切换（维度/分布变化）必须清理旧向量并重建索引
- **性能**：1–20 万量级下，HNSW 查询通常毫秒级；主要耗时在 embedding 补算（推理）

## 6. 配置（env）

- `AI_SERVICE_URL`：server 调用 ai-service 的 baseURL（默认 `http://localhost:8002`）
- `TIDY_CLIP_MODEL_ID`：server 与 ai-service 共用的模型 id 或本地绝对路径；未提供时固定使用 `jinaai/jina-clip-v2`，不会根据本机残留目录自动切换模型
- `TIDY_CLIP_TEXT_EMBED_CACHE_MAX`：server 侧 `clipTextEmbed` 进程内缓存条目上限（默认 `200`）
- `TIDY_CLIP_TEXT_EMBED_CACHE_TTL_MS`：server 侧 `clipTextEmbed` 缓存 TTL（默认 `300000`，即 5 分钟）
- `TIDY_CLIP_TEXT_EMBED_DB_CACHE_MAX`：server 侧 `clipTextEmbed` SQLite 持久缓存条目上限（默认 `20000`；按 `model+normalize+text` 去重，跨重启生效）
- `TIDY_IMAGE_SEARCH_TTL_MS`：临时参考图 embedding 会话 TTL（默认 `1800000`，即 30 分钟；最低 1 分钟）
- `TIDY_IMAGE_SEARCH_MAX_SESSIONS`：单个 server 进程最多保留的临时参考图会话数（默认 `20`，超出后淘汰最早会话）
- `TIDY_CLIP_CONCURRENCY`：ai-service 侧 CLIP 推理并发（默认 `1`；提高并发可能导致 CPU/MPS/CUDA 争用与长尾，调参需结合 profiling 中的 `clip.slot.waitMs` 观察排队）

---

文字搜索和以图搜图均已与 `/api/files` 的筛选语义合并；普通过滤条件会在相似度排序结果上继续生效。
