const express = require('express');
const { getDB } = require('../db');
const { validateRootOrThrow } = require('../configStore');
const { clearByRoot } = require('../services/clearByRoot');

const router = express.Router();

router.post('/clear', async (req, res) => {
  const rootRaw = req.body?.root;
  const dryRun = !!req.body?.dryRun;

  let root;
  try {
    root = validateRootOrThrow(rootRaw);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }

  const db = getDB();
  try {
    const report = clearByRoot(db, { root, dryRun });
    return res.json(report);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

module.exports = router;


