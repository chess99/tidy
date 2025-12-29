const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const scanner = require('../scanner');

// Trigger face scan
router.post('/scan', (req, res) => {
  if (scanner.isScanning) {
    return res.status(409).json({ error: 'Scan in progress' });
  }
  // Run in background
  scanner.scanFaces().catch(console.error);
  res.json({ success: true, message: 'Face scan started' });
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

