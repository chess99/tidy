本目录封装前端对后端的网络访问，把 HTTP 细节收敛在一处。
输入：后端 API baseURL、鉴权/配置；输出：可复用的请求方法与统一错误处理。
更新规则：API 形状或调用方式变化时，更新本 README + `client/src/README.md` + `docs/README.md`。

### 文件

- `client.js`：HTTP 客户端封装（baseURL、headers、错误处理等）。
  - 含：`duplicates` 工具接口封装（groups/apply）。
  - 含：`files` 相似筛选参数（`similarKind/similarToFileId/similarThreshold`，用于详情面板“找相似(pHash)”）。
  - 含：智能搜索（`POST /search`）与统一列表 fetch（`getFilesUnified`：smartQuery 时走智能搜索，否则走 `/files`）。


