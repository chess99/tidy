# watcher

输入：扫描目录配置、文件系统事件、根目录能力探测。
输出：安全的文件监听状态，以及必要时的 fallback discover 任务。

## 策略

`TIDY_WATCHER_MODE` 支持：

- `auto`：默认。固定本地磁盘启用实时监听；UNC、映射网络盘、可移动盘、不可访问目录降级为 fallback discover。
- `off`：关闭 watcher 和 fallback discover。`TIDY_DISABLE_WATCHER=1` 等价于 `off`。
- `on`：对可访问目录强制尝试 watcher。网络盘仍可能由 chokidar 或系统层报错；日常使用更建议保持 `auto`。

## 网络盘

Windows 映射盘，例如 `Z:\` 指向 `\\192.168.0.104\Disk1`，不适合默认递归 watcher。SMB 目录监听可能返回 `UNKNOWN` 或 `The system cannot open the file`。

Tidy 在 `auto` 模式下不会对这类根目录调用 `chokidar.watch()`，而是定期创建 `discover missing` 任务，让现有扫描器继续作为图库状态的单一来源。

## Fallback Discover

fallback 不是底层文件轮询，而是保守复用现有扫描任务：

```js
{ type: 'discover', mode: 'missing', params: { auto: true, reason: 'watcher_fallback' } }
```

默认间隔为 60 分钟，可通过 `TIDY_WATCHER_FALLBACK_INTERVAL_MS` 调整，最小值为 60 秒。
