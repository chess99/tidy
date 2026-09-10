const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ ok: true, service: 'tidy-server' });
});

module.exports = router;


