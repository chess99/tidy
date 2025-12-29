const express = require('express');
const scanner = require('../scanner');
const { WORK_ROOT } = require('../config');
const { loadConfig, getEffectiveScanRoot, validateScanRoot } = require('../configStore');
const router = express.Router();

router.post('/', async (req, res) => {
  // Choose scan root:
  // 1) request body root (explicit per-request)
  // 2) persisted activeScanRoot (config.json)
  // 3) WORK_ROOT (env / default)
  let scanPath = WORK_ROOT;
  try {
    const reqRoot = req.body?.root;
    if (reqRoot) {
      scanPath = validateScanRoot(reqRoot);
    } else {
      const cfg = await loadConfig();
      scanPath = getEffectiveScanRoot(cfg);
    }
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }

  if (scanner.isScanning) {
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  // Run in background
  scanner.scanDirectory(scanPath).catch(err => console.error(err));
  
  res.json({ message: 'Scan started', path: scanPath });
});

router.get('/status', (req, res) => {
  res.json({
    isScanning: scanner.isScanning,
    stats: scanner.stats
  });
});

// New endpoint to open system dialog (simulated for now as browser can't trigger system dialog directly via backend easily without native modules like electron or specialized calls, but we can accept input)
// Actually, standard web apps can't trigger server-side file pickers easily. 
// We will skip implementing a native OS picker for now unless we use Electron.
// But we can implement a simple directory auto-complete or listing later.

module.exports = router;
