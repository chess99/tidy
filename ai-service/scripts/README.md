本目录是 ai-service 的打包/发布脚本入口：用于生成桌面分发所需的本地可执行文件。
输入：Python 解释器 + 依赖环境（requirements）+ PyInstaller；输出：平台可执行文件（供 Electron sidecar 拉起）。
更新规则：入口参数/产物布局变化时，更新本 README + `ai-service/README.md` + `docs/桌面分发.md`。

### 文件

- `build-ai-service.sh`：macOS/Linux 打包脚本（PyInstaller onedir）。
- `build-ai-service.bat`：Windows 打包脚本（PyInstaller onedir）。


