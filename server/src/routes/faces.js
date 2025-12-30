const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const scanner = require('../scanner');
const { reclusterPeople } = require('../services/reclusterPeople');

// Trigger face scan
router.post('/scan', (req, res) => {
  if (scanner.isScanning) {
    return res.status(409).json({ error: 'Scan in progress' });
  }
  // Run in background
  scanner.scanFaces().catch(console.error);
  res.json({ success: true, message: 'Face scan started' });
});

// Reset face scan marker so images are eligible for scanning again
router.post('/reset-scan-marker', (req, res) => {
  try {
    const db = getDB();
    const clearFaces = !!req.body?.clearFaces;
    const clearPeople = !!req.body?.clearPeople;
    const now = Date.now();

    const tx = db.transaction(() => {
      const r = db.prepare('UPDATE assets SET face_scanned_at = NULL').run();
      if (clearFaces) db.prepare('DELETE FROM faces').run();
      if (clearPeople) db.prepare('DELETE FROM people').run();
      // best-effort bump assets.updated_at so UI cache busting can notice changes later if needed
      db.prepare('UPDATE assets SET updated_at = COALESCE(updated_at, ?)').run(now);
      return { assetsReset: r.changes, clearFaces, clearPeople };
    });

    res.json({ success: true, ...tx() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recluster all faces into people (DBSCAN cosine distance)
router.post('/recluster', (req, res) => {
  try {
    const db = getDB();
    const eps = req.body?.eps != null ? Number(req.body.eps) : undefined;
    const minSamples = req.body?.minSamples != null ? Number(req.body.minSamples) : undefined;

    const result = reclusterPeople(db, { eps, minSamples });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Merge one person into another: moves all faces from :id -> intoPersonId, deletes source person
router.post('/people/:id/merge', (req, res) => {
  try {
    const db = getDB();
    const fromId = Number(req.params.id);
    const intoId = Number(req.body?.intoPersonId);
    if (!Number.isFinite(fromId) || !Number.isFinite(intoId)) return res.status(400).json({ error: 'Invalid ids' });
    if (fromId === intoId) return res.status(400).json({ error: 'Cannot merge into itself' });

    const tx = db.transaction(() => {
      const into = db.prepare('SELECT * FROM people WHERE id = ?').get(intoId);
      const from = db.prepare('SELECT * FROM people WHERE id = ?').get(fromId);
      if (!into || !from) throw new Error('Person not found');

      const moved = db.prepare('UPDATE faces SET person_id = ? WHERE person_id = ?').run(intoId, fromId).changes;

      // If target has no avatar, inherit from source
      if (!into.avatar_face_id && from.avatar_face_id) {
        db.prepare('UPDATE people SET avatar_face_id = ?, updated_at = ? WHERE id = ?').run(from.avatar_face_id, Date.now(), intoId);
      }

      db.prepare('DELETE FROM people WHERE id = ?').run(fromId);
      return { movedFaces: moved, fromId, intoId };
    });

    res.json({ success: true, result: tx() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Split selected faces into a new person
router.post('/people/:id/split', (req, res) => {
  try {
    const db = getDB();
    const fromId = Number(req.params.id);
    const faceIds = Array.isArray(req.body?.faceIds) ? req.body.faceIds.map(Number).filter(Number.isFinite) : [];
    if (!Number.isFinite(fromId)) return res.status(400).json({ error: 'Invalid from id' });
    if (faceIds.length === 0) return res.status(400).json({ error: 'faceIds required' });

    const tx = db.transaction(() => {
      const from = db.prepare('SELECT * FROM people WHERE id = ?').get(fromId);
      if (!from) throw new Error('Person not found');

      const now = Date.now();
      const info = db.prepare('INSERT INTO people (name, avatar_face_id, created_at, updated_at) VALUES (NULL, NULL, ?, ?)').run(now, now);
      const newId = info.lastInsertRowid;

      const stmt = db.prepare('UPDATE faces SET person_id = ? WHERE id = ? AND person_id = ?');
      let moved = 0;
      for (const fid of faceIds) moved += stmt.run(newId, fid, fromId).changes;

      // Set avatar of new person to the first moved face
      const avatar = db.prepare('SELECT id FROM faces WHERE person_id = ? ORDER BY score DESC, id ASC LIMIT 1').get(newId);
      if (avatar?.id) db.prepare('UPDATE people SET avatar_face_id = ?, updated_at = ? WHERE id = ?').run(avatar.id, now, newId);

      // Ensure source still has avatar (if its avatar moved away)
      const fromAvatar = db.prepare('SELECT avatar_face_id FROM people WHERE id = ?').get(fromId)?.avatar_face_id;
      if (fromAvatar) {
        const exists = db.prepare('SELECT 1 AS ok FROM faces WHERE id = ? AND person_id = ?').get(fromAvatar, fromId);
        if (!exists) {
          const repl = db.prepare('SELECT id FROM faces WHERE person_id = ? ORDER BY score DESC, id ASC LIMIT 1').get(fromId);
          db.prepare('UPDATE people SET avatar_face_id = ?, updated_at = ? WHERE id = ?').run(repl?.id || null, now, fromId);
        }
      }

      return { newPersonId: newId, movedFaces: moved, fromId };
    });

    res.json({ success: true, result: tx() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get faces for a specific asset
router.get('/asset/:hash', (req, res) => {
  try {
    const db = getDB();
    const faces = db.prepare(`
      SELECT f.*, p.name as person_name 
      FROM faces f
      LEFT JOIN people p ON f.person_id = p.id
      WHERE f.hash = ?
    `).all(req.params.hash);
    
    res.json(faces.map(f => ({
      ...f,
      descriptor: null, // Don't send huge descriptor array to client
      box: JSON.parse(f.box)
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all people
router.get('/people', (req, res) => {
  try {
    const db = getDB();
    const people = db.prepare('SELECT * FROM people ORDER BY name').all();
    res.json(people);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new person
router.post('/people', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    
    const db = getDB();
    const now = Date.now();
    const info = db.prepare('INSERT INTO people (name, created_at, updated_at) VALUES (?, ?, ?)').run(name, now, now);
    res.json({ id: info.lastInsertRowid, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a face (assign person)
router.put('/:id', (req, res) => {
  try {
    const { person_id } = req.body; // person_id can be null to unassign
    const faceId = req.params.id;
    const db = getDB();
    
    db.prepare('UPDATE faces SET person_id = ? WHERE id = ?').run(person_id, faceId);
    
    // Auto-set avatar if not set
    if (person_id) {
      const person = db.prepare('SELECT * FROM people WHERE id = ?').get(person_id);
      if (person && !person.avatar_face_id) {
        db.prepare('UPDATE people SET avatar_face_id = ? WHERE id = ?').run(faceId, person_id);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create person from a specific face
router.post('/create-from-face', (req, res) => {
  try {
    const { face_id, name } = req.body;
    const db = getDB();
    
    const face = db.prepare('SELECT * FROM faces WHERE id = ?').get(face_id);
    if (!face) return res.status(404).json({ error: 'Face not found' });

    const now = Date.now();
    const info = db.prepare('INSERT INTO people (name, avatar_face_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, face_id, now, now);
    const personId = info.lastInsertRowid;
    
    db.prepare('UPDATE faces SET person_id = ? WHERE id = ?').run(personId, face_id);
    
    res.json({ id: personId, name, avatar_face_id: face_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

