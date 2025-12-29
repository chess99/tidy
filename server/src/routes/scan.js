const express = require('express');
const scanner = require('../scanner');
const { loadConfig, getEnabledRoots, validateRootOrThrow } = require('../configStore');
const router = express.Router();

router.post('/', async (req, res) => {
  // Demo optimal design:
  // - default: scan all enabled roots sequentially
  // - optional: request body `{ root }` to scan a single directory ad-hoc
  let roots = [];
  try {
    const reqRoot = req.body?.root;
    if (reqRoot) {
      roots = [validateRootOrThrow(reqRoot)];
    } else {
      const cfg = await loadConfig();
      roots = getEnabledRoots(cfg);
    }
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }

  if (!roots.length) {
    return res.status(400).json({ error: 'No enabled scan roots. Add a scan root and enable it first.' });
  }

  if (scanner.isScanning) {
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  // Track queue progress on the scanner instance (best-effort, in-memory).
  scanner.currentRoot = null;
  scanner.queueTotal = roots.length;
  scanner.queueDone = 0;

  // Run in background (sequential, to avoid thrashing IO/CPU and simplify progress UI).
  (async () => {
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      scanner.currentRoot = r;
      // eslint-disable-next-line no-await-in-loop
      await scanner.scanDirectory(r);
      scanner.queueDone = i + 1;
    }
  })().catch((err) => {
    console.error(err);
  }).finally(() => {
    scanner.currentRoot = null;
  });

  res.json({ message: 'Scan started', roots });
});

router.get('/status', (req, res) => {
  res.json({
    isScanning: scanner.isScanning,
    stats: scanner.stats,
    currentRoot: scanner.currentRoot || null,
    queueTotal: Number.isFinite(scanner.queueTotal) ? scanner.queueTotal : null,
    queueDone: Number.isFinite(scanner.queueDone) ? scanner.queueDone : null,
  });
});

// New endpoint to open system dialog (simulated for now as browser can't trigger system dialog directly via backend easily without native modules like electron or specialized calls, but we can accept input)
// Actually, standard web apps can't trigger server-side file pickers easily. 
// We will skip implementing a native OS picker for now unless we use Electron.
// But we can implement a simple directory auto-complete or listing later.

module.exports = router;
