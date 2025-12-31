const express = require('express');
const { WORK_ROOT, MANAGED_ROOT, TRASH_DIR, DATA_DIR, DB_PATH, THUMB_DIR } = require('../config');
const { getDB } = require('../db');
const {
  loadConfig,
  addScanRoot,
  setScanRoots,
  setScanRootEnabled,
  removeScanRoot,
  setScanType,
  setScanOptions,
  setTaskSettings,
  validateRootOrThrow,
} = require('../configStore');

// Reuse the existing clear-by-root logic directly (no legacy compat, but avoid duplicating SQL).
const { clearByRoot } = require('../services/clearByRoot');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const cfg = await loadConfig();
    res.json({
      scan: cfg.scan,
      scanRoots: cfg.scanRoots,
      scanType: cfg.scanType,
      tasks: cfg.tasks,
      workspace: { WORK_ROOT, MANAGED_ROOT, TRASH_DIR, DATA_DIR, DB_PATH, THUMB_DIR },
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Add scan root (enabled=true)
router.post('/scan-root', async (req, res) => {
  try {
    const root = validateRootOrThrow(req.body?.root);
    const cfg = await addScanRoot(root);
    res.json({ scanRoots: cfg.scanRoots });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }
});

// Replace full scanRoots list
router.post('/scan-roots', async (req, res) => {
  try {
    const scanRoots = Array.isArray(req.body?.scanRoots) ? req.body.scanRoots : [];
    const next = await setScanRoots(scanRoots);
    res.json({ scanRoots: next.scanRoots });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }
});

// Toggle enabled
router.patch('/scan-root', async (req, res) => {
  try {
    const root = validateRootOrThrow(req.body?.root);
    const enabled = !!req.body?.enabled;
    const cfg = await setScanRootEnabled(root, enabled);
    res.json({ scanRoots: cfg.scanRoots });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }
});

// Remove scan root; optionally clear DB records for that directory.
router.delete('/scan-root', async (req, res) => {
  try {
    const root = validateRootOrThrow(req.body?.root);
    const clearDb = !!req.body?.clearDb;
    let clearReport = null;

    if (clearDb) {
      const db = getDB();
      clearReport = clearByRoot(db, { root, dryRun: false });
    }

    const cfg = await removeScanRoot(root);
    res.json({ scanRoots: cfg.scanRoots, clearReport });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }
});

// Update scan type (global)
router.put('/scan-type', async (req, res) => {
  try {
    const scanType = req.body || {};
    const cfg = await setScanType(scanType);
    res.json({ scanType: cfg.scanType });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }
});

// Update scan options (excludeGlobs, minFileSizeBytes)
router.put('/scan-options', async (req, res) => {
  try {
    const scan = req.body || {};
    const cfg = await setScanOptions(scan);
    res.json({ scan: cfg.scan });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }
});

// Update task settings (concurrency, autoTrigger)
router.put('/tasks', async (req, res) => {
  try {
    const tasks = req.body || {};
    const cfg = await setTaskSettings(tasks);
    res.json({ tasks: cfg.tasks });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }
});

module.exports = router;


