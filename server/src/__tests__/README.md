本目录是服务端单元测试。
输入：测试用例 + 被测试模块；输出：测试结果与覆盖率报告。
更新规则：新增/修改测试时，更新本 README。

### 运行测试

```bash
cd server
npm test              # 运行所有测试
npm test -- --watch   # 监听模式
npm test -- --coverage # 生成覆盖率报告
```

### 测试文件

- `enrich.test.js`：测试 `enrich.js` 中的路径解析逻辑（`parseAlbumNameFromManagedPath`、`isUnder`）。
- `workspace.test.js`：测试 workspace 默认值（确保默认目录名无下划线前缀）。
- `configStore-workspace.test.js`：测试 workspace 路径规范化逻辑。

### 约定

- 测试文件命名：`*.test.js`
- 测试目录：`__tests__/` 或与源文件同级
- 覆盖率报告：`server/coverage/`（已加入 .gitignore）
