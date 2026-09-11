/**
 * input: IPv4/IPv6 listeners and preferred desktop ports
 * output: collision-safe port availability decisions
 * pos: prevents desktop sidecars from reusing ports occupied on another address family
 */

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');

const { isPortFree, pickPort } = require('./ports.cjs');

function listen(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('detects a preferred port occupied on IPv4', async () => {
  const server = await listen('127.0.0.1');
  try {
    const port = server.address().port;
    assert.equal(await isPortFree(port), false);
    assert.notEqual(await pickPort({ preferred: port }), port);
  } finally {
    await close(server);
  }
});

test('detects a preferred port occupied on the IPv6 wildcard used by the server', async (context) => {
  let server;
  try {
    server = await listen('::');
  } catch (error) {
    if (error?.code === 'EAFNOSUPPORT' || error?.code === 'EADDRNOTAVAIL') return context.skip('IPv6 unavailable');
    throw error;
  }
  try {
    const port = server.address().port;
    assert.equal(await isPortFree(port), false);
    assert.notEqual(await pickPort({ preferred: port }), port);
  } finally {
    await close(server);
  }
});
