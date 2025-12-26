const express = require('express');
const scanner = require('../scanner');
const router = express.Router();

router.post('/', async (req, res) => {
  const { path: scanPath } = req.body;
  
  if (!scanPath) {
    return res.status(400).json({ error: 'Path is required' });
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

module.exports = router;

