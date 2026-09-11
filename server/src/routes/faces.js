const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const router = express.Router();
const { getDB } = require('../db');
const { extractEmbeddedPreview, RAW_EXTS } = require('../scanner/thumbnail');

function safeJsonParse(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

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
      const targetName = String(into.name || '').trim() || String(from.name || '').trim() || null;
      const targetAvatarFaceId = into.avatar_face_id || from.avatar_face_id || null;
      db.prepare(`
        UPDATE people
        SET name = ?, avatar_face_id = ?, updated_at = ?
        WHERE id = ?
      `).run(targetName, targetAvatarFaceId, Date.now(), intoId);

      db.prepare('DELETE FROM people WHERE id = ?').run(fromId);
      return { movedFaces: moved, fromId, intoId, name: targetName, avatarFaceId: targetAvatarFaceId };
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
    const rows = db.prepare(`
      SELECT
        p.*,
        COUNT(DISTINCT person_face.hash) AS face_count
      FROM people p
      LEFT JOIN faces person_face ON person_face.person_id = p.id
      GROUP BY p.id
      ORDER BY
        CASE WHEN NULLIF(TRIM(p.name), '') IS NULL THEN 1 ELSE 0 END,
        p.name COLLATE NOCASE,
        p.id
    `).all();

    const people = rows.map((person) => ({
      ...person,
      face_count: Number(person.face_count) || 0,
    }));

    res.json(people);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve a person's representative face as a small avatar with long-lived browser caching.
router.get('/people/:id/avatar', async (req, res) => {
  const personId = Number(req.params.id);
  if (!Number.isFinite(personId)) return res.status(400).json({ error: 'Invalid person id' });

  try {
    const db = getDB();
    const face = db.prepare(`
      SELECT f.id, f.hash, f.box, a.metadata
      FROM people p
      JOIN faces f ON f.id = p.avatar_face_id
      LEFT JOIN assets a ON a.hash = f.hash
      WHERE p.id = ?
      LIMIT 1
    `).get(personId);
    const box = safeJsonParse(face?.box);
    if (!face || !box) return res.status(404).send('Avatar not found');

    const candidates = db.prepare(`
      SELECT path, ext
      FROM files
      WHERE hash = ? AND COALESCE(missing, 0) = 0
      ORDER BY COALESCE(updated_at, discovered_at, scanned_at, 0) DESC, id DESC
      LIMIT 20
    `).all(face.hash);
    let file = null;
    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (candidate?.path && await fs.pathExists(candidate.path)) {
        file = candidate;
        break;
      }
    }
    if (!file) return res.status(404).send('Avatar source not found');

    const ext = String(file.ext || path.extname(file.path) || '').toLowerCase();
    let input = file.path;
    if (RAW_EXTS.has(ext)) {
      input = await extractEmbeddedPreview(file.path);
      if (!input) return res.status(415).send('RAW avatar preview not available');
    }

    const inputMetadata = await sharp(input).metadata();
    const assetMetadata = safeJsonParse(face.metadata);
    const sourceWidth = Number(assetMetadata?.width) || Number(inputMetadata.width);
    const sourceHeight = Number(assetMetadata?.height) || Number(inputMetadata.height);
    const inputWidth = Number(inputMetadata.width);
    const inputHeight = Number(inputMetadata.height);
    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width ?? box.w);
    const height = Number(box.height ?? box.h);
    if (![sourceWidth, sourceHeight, inputWidth, inputHeight, x, y, width, height].every(Number.isFinite)
      || sourceWidth <= 0 || sourceHeight <= 0 || inputWidth <= 0 || inputHeight <= 0 || width <= 0 || height <= 0) {
      return res.status(422).send('Invalid avatar crop');
    }

    const scaleX = inputWidth / sourceWidth;
    const scaleY = inputHeight / sourceHeight;
    const faceX = x * scaleX;
    const faceY = y * scaleY;
    const faceWidth = width * scaleX;
    const faceHeight = height * scaleY;
    const cropSize = Math.max(1, Math.min(Math.max(faceWidth, faceHeight) * 1.7, inputWidth, inputHeight));
    const left = Math.round(Math.max(0, Math.min(inputWidth - cropSize, faceX + faceWidth / 2 - cropSize / 2)));
    const top = Math.round(Math.max(0, Math.min(inputHeight - cropSize, faceY + faceHeight / 2 - cropSize / 2)));
    const squareSize = Math.max(1, Math.floor(Math.min(cropSize, inputWidth - left, inputHeight - top)));

    const avatar = await sharp(input)
      .extract({ left, top, width: squareSize, height: squareSize })
      .rotate()
      .resize(192, 192, { fit: 'cover' })
      .jpeg({ quality: 82, progressive: true })
      .toBuffer();

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('jpg');
    return res.send(avatar);
  } catch (err) {
    return res.status(500).send(String(err?.message || 'avatar_failed'));
  }
});

// Rename a person (preserves person_id across faces)
router.patch('/people/:id', (req, res) => {
  try {
    const db = getDB();
    const id = Number(req.params.id);
    const name = String(req.body?.name ?? '').trim();
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    if (!name) return res.status(400).json({ error: 'Name required' });

    const r = db.prepare('UPDATE people SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id);
    if (!r.changes) return res.status(404).json({ error: 'Person not found' });
    res.json({ success: true, id, name });
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

module.exports = router;
