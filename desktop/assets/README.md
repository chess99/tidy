本目录是桌面应用图标生成产物目录：由脚本从 `client/public/icon.png` 自动生成。
输入：`client/public/icon.png`；输出：`icon.png`/`icon.icns`/`icon.ico` 等打包所需文件。
更新规则：图标生成策略变化时，更新本 README + `desktop/scripts/README.md` + `docs/图标设计.md`。

### 说明

- 本目录内容为**生成物**，默认不入库（由根 `.gitignore` 忽略）。
- 生成入口：`desktop/scripts/generate-icons.mjs`
- 桌面图标生成时会把源图居中缩到画布约 82%，保留透明安全边距，避免 Dock 中视觉尺寸偏大。

