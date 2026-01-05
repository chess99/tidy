/**
 * input: 操作系统端口占用状态（net）
 * output: 选择可用端口（优先期望端口，冲突则回退到随机空闲端口）
 * pos: 桌面主进程工具：供 `main.cjs`/`sidecars.cjs` 使用（变更需同步更新本头注释与所属目录 README）
 */

const net = require('net');

function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

function getRandomFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      srv.close(() => resolve(port));
    });
  });
}

async function pickPort({ preferred, host = '127.0.0.1' } = {}) {
  const pref = Number(preferred);
  if (Number.isFinite(pref) && pref > 0) {
    const ok = await isPortFree(pref, host);
    if (ok) return pref;
  }
  const p = await getRandomFreePort(host);
  if (!p) throw new Error('failed to allocate free port');
  return p;
}

module.exports = { isPortFree, pickPort };


