const express = require('express');
const { syncChanges } = require('../sync');
const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const report = await syncChanges();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

