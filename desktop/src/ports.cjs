const net = require('net');

function isPortFreeOnHost(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (error) => {
      if (error?.code === 'EAFNOSUPPORT' || error?.code === 'EADDRNOTAVAIL') return resolve(true);
      resolve(false);
    });
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

function isPortListening(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;
    const finish = (listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function isPortFree(
  port,
  hosts = ['::', '0.0.0.0'],
  connectHosts = ['127.0.0.1', '::1']
) {
  for (const host of connectHosts) {
    if (await isPortListening(port, host)) return false;
  }
  for (const host of hosts) {
    if (!(await isPortFreeOnHost(port, host))) return false;
  }
  return true;
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

async function pickPort({ preferred, hosts = ['::', '0.0.0.0'], connectHosts = ['127.0.0.1', '::1'] } = {}) {
  const pref = Number(preferred);
  if (Number.isFinite(pref) && pref > 0) {
    const ok = await isPortFree(pref, hosts, connectHosts);
    if (ok) return pref;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await getRandomFreePort(hosts[0]);
    if (port && await isPortFree(port, hosts, connectHosts)) return port;
  }
  throw new Error('failed to allocate free port');
}

module.exports = { isPortFree, pickPort };
