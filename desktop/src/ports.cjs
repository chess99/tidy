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


