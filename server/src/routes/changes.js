const express = require('express');
const { getDB } = require('../db');

const router = express.Router();

function uniq(arr) {
  return [...new Set(arr)];
}

router.get('/stream', (req, res) => {
  const db = getDB();
  let cursor = parseInt(req.query.cursor) || 0;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Initial hello
  res.write(`event: ready\n`);
  res.write(`data: ${JSON.stringify({ cursor })}\n\n`);

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  const tick = () => {
    if (closed) return;

    try {
      const rows = db.prepare(`
        SELECT id, entity, entity_id, type, ts
        FROM changes
        WHERE id > ?
        ORDER BY id ASC
        LIMIT 500
      `).all(cursor);

      if (rows.length > 0) {
        cursor = rows[rows.length - 1].id;
        const files = [];
        const assets = [];

        for (const r of rows) {
          if (r.entity === 'file') files.push(parseInt(r.entity_id));
          if (r.entity === 'asset') assets.push(String(r.entity_id));
        }

        const payload = {
          cursor,
          files: uniq(files.filter(n => Number.isFinite(n))),
          assets: uniq(assets),
        };

        res.write(`event: changes\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } else {
        // keepalive comment
        res.write(`: keepalive ${Date.now()}\n\n`);
      }
    } catch (e) {
      // If table missing or query fails, still keep connection alive.
      res.write(`: error ${Date.now()}\n\n`);
    }

    setTimeout(tick, 1000);
  };

  tick();
});

module.exports = router;


