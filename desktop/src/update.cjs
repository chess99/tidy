/**
 * input: manifest URL（可选）+ 网络（https）+ Electron dialog/shell
 * output: 提示式更新弹窗（打开下载链接；不做静默更新）
 * pos: 桌面更新策略（阶段 1）：被 `main.cjs` 调用（变更需同步更新本头注释与所属目录 README）
 */

const https = require('https');
const { dialog, shell } = require('electron');

function cmpSemver(a, b) {
  const pa = String(a || '').split('.').map((x) => Number(x));
  const pb = String(b || '').split('.').map((x) => Number(x));
  for (let i = 0; i < 3; i += 1) {
    const da = Number.isFinite(pa[i]) ? pa[i] : 0;
    const db = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function fetchJson(url, { timeoutMs = 2500 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const code = Number(res.statusCode || 0);
      if (code < 200 || code >= 300) {
        res.resume();
        reject(new Error(`http ${code}`));
        return;
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function checkForUpdatesHinted({
  currentVersion,
  manifestUrl,
  parentWindow = null,
} = {}) {
  const u = String(manifestUrl || '').trim();
  if (!u) return { checked: false };

  let manifest;
  try {
    manifest = await fetchJson(u);
  } catch (e) {
    return { checked: true, ok: false, error: String(e?.message || e) };
  }

  const latest = String(manifest?.version || '').trim();
  const downloadUrl = String(manifest?.downloadUrl || '').trim();
  if (!latest || !downloadUrl) return { checked: true, ok: false, error: 'invalid manifest' };

  const newer = cmpSemver(latest, currentVersion) > 0;
  if (!newer) return { checked: true, ok: true, update: false, latest };

  const notes = String(manifest?.notes || '').trim();
  const msg = [
    `发现新版本：${latest}`,
    '',
    notes ? `更新说明：\n${notes}` : '',
    '',
    '将打开下载页面；下载后请手动覆盖安装。',
  ]
    .filter(Boolean)
    .join('\n');

  const out = await dialog.showMessageBox(parentWindow, {
    type: 'info',
    buttons: ['下载更新', '稍后'],
    defaultId: 0,
    cancelId: 1,
    title: '发现更新',
    message: 'Tidy 有新版本可用',
    detail: msg,
  });

  if (out.response === 0) {
    await shell.openExternal(downloadUrl);
    return { checked: true, ok: true, update: true, latest, action: 'open-download' };
  }
  return { checked: true, ok: true, update: true, latest, action: 'later' };
}

module.exports = { checkForUpdatesHinted };


