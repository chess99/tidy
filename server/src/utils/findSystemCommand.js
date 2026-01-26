/**
 * input: 命令名称
 * output: 系统命令路径或 null
 * pos: 工具函数：查找系统 PATH 中的命令（变更需同步更新本头注释与所属目录 README）
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const cache = new Map();

/**
 * 查找系统安装的命令路径
 * @param {string} cmd - 命令名称（如 'ffmpeg', 'ffprobe'）
 * @returns {Promise<string|null>} 命令路径，如果未找到则返回 null
 */
async function findSystemCommand(cmd) {
  if (cache.has(cmd)) {
    return cache.get(cmd);
  }

  try {
    // 使用 which (Unix) 或 where (Windows) 查找命令
    const findCmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(findCmd, [cmd], {
      windowsHide: true,
      timeout: 2000,
    });
    const path = String(stdout || '').trim().split('\n')[0];
    if (path && path.length > 0) {
      cache.set(cmd, path);
      return path;
    }
  } catch {
    // 命令未找到
  }

  cache.set(cmd, null);
  return null;
}

module.exports = { findSystemCommand };
