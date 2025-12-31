本目录是“库扫描管线”：从文件系统读取 -> 计算 hash/元信息 -> 生成缩略图/提取人脸等。
输入：文件路径/目录、媒体文件字节、配置；输出：结构化元信息、缩略图/预览、人脸候选与 DB 写入。
更新规则：扫描流程/产物/性能策略变化时，更新本 README + `server/src/README.md` + `docs/README.md`。

### 文件

- `hasher.js`：内容哈希计算（去重核心主键）。
- `metadata.js`：图片/视频基础元信息抽取。
- `videoMetadata.js`：视频专用元信息抽取（时长/尺寸/编码等）。
- `thumbnail.js`：缩略图/预览生成。
- `face.js`：人脸扫描相关（检测、embedding、落库编排）。


