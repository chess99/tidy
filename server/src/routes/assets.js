const express = require('express');
const { getDB } = require('../db');
const path = require('path');
const { getThumbnailPath } = require('../scanner/thumbnail');
const fs = require('fs-extra');

const router = express.Router();

// List assets
router.get('/', (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  // Filter by status (default: all except trash?)
  // For now return all
  const statusFilter = req.query.status;
  
  let query = 'SELECT * FROM assets';
  const params = [];

  if (statusFilter) {
    query += ' WHERE status = ?';
    params.push(statusFilter);
  }

  query += ' ORDER BY taken_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const assets = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM assets').get().count;

  // Parse metadata
  const results = assets.map(a => ({
    ...a,
    metadata: JSON.parse(a.metadata)
  }));

  res.json({
    data: results,
    pagination: { page, limit, total }
  });
});

// Get single asset details with files
router.get('/:hash', (req, res) => {
  const db = getDB();
  const { hash } = req.params;
  
  const asset = db.prepare('SELECT * FROM assets WHERE hash = ?').get(hash);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const files = db.prepare('SELECT * FROM files WHERE hash = ?').all(hash);

  res.json({
    ...asset,
    metadata: JSON.parse(asset.metadata),
    files
  });
});

// Update asset (e.g. trash it)
router.patch('/:hash', (req, res) => {
  const db = getDB();
  const { hash } = req.params;
  const { status } = req.body;

  if (!['inbox', 'sorted', 'trash', 'ignored'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const result = db.prepare('UPDATE assets SET status = ? WHERE hash = ?').run(status, hash);
  
  if (result.changes === 0) return res.status(404).json({ error: 'Asset not found' });

  res.json({ success: true, hash, status });
});

// Serve thumbnail
router.get('/:hash/thumb', async (req, res) => {
  const { hash } = req.params;
  const thumbPath = getThumbnailPath(hash);
  
  if (await fs.pathExists(thumbPath)) {
    res.sendFile(thumbPath);
  } else {
    res.status(404).send('Not found');
  }
});

module.exports = router;

