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

// New endpoint to open system dialog (simulated for now as browser can't trigger system dialog directly via backend easily without native modules like electron or specialized calls, but we can accept input)
// Actually, standard web apps can't trigger server-side file pickers easily. 
// We will skip implementing a native OS picker for now unless we use Electron.
// But we can implement a simple directory auto-complete or listing later.

module.exports = router;
