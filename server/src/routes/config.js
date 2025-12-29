const express = require('express');
const { WORK_ROOT, MANAGED_ROOT, TRASH_DIR, DATA_DIR, DB_PATH, THUMB_DIR } = require('../config');
const {
  loadConfig,
  addScanRoot,
  setActiveScanRoot,
  getEffectiveScanRoot,
  validateScanRoot,
} = require('../configStore');

const router = express.Router();

router.get('/', async (req, res) => {
  const cfg = await loadConfig();
  res.json({
    scanRoots: cfg.scanRoots,
    activeScanRoot: cfg.activeScanRoot,
    effective: {
      scanRoot: getEffectiveScanRoot(cfg),
      WORK_ROOT,
      MANAGED_ROOT,
      TRASH_DIR,
      DATA_DIR,
      DB_PATH,
      THUMB_DIR,
    },
  });
});

router.post('/scan-root', async (req, res) => {
  const rootRaw = req.body?.root;
  const setActive = !!req.body?.setActive;
  try {
    // validate early for clearer error
    validateScanRoot(rootRaw);
    const cfg = await addScanRoot(rootRaw, { setActive });
    res.json({ scanRoots: cfg.scanRoots, activeScanRoot: cfg.activeScanRoot });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }
});

router.post('/active-scan-root', async (req, res) => {
  const rootRaw = req.body?.root;
  try {
    validateScanRoot(rootRaw);
    const cfg = await setActiveScanRoot(rootRaw);
    res.json({ scanRoots: cfg.scanRoots, activeScanRoot: cfg.activeScanRoot });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }
});

module.exports = router;


