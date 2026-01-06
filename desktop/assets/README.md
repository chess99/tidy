本目录是桌面应用图标生成产物目录：由脚本从 `client/public/icon.svg` 自动生成。
输入：`client/public/icon.svg`；输出：`icon.png`/`icon.icns`/`icon.ico` 等打包所需文件。
更新规则：图标生成策略变化时，更新本 README + `desktop/scripts/README.md` + `docs/图标设计.md`。

### 说明

- 本目录内容为**生成物**，默认不入库（由根 `.gitignore` 忽略）。
- 生成入口：`desktop/scripts/generate-icons.mjs`


