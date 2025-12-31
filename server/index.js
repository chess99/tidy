require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDB } = require('./src/db');
const path = require('path');
const { WORK_ROOT, MANAGED_ROOT, TRASH_DIR, DATA_DIR, DB_PATH, THUMB_DIR, PREVIEW_DIR, POSTER_DIR } = require('./src/config');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize DB
initDB();

// Start background job runner (DB-backed task queue).
const { startJobRunner } = require('./src/jobs/runner');
startJobRunner({ pollIntervalMs: 500 });

// Log effective config (helps cross-platform setup).
console.log('[config] WORK_ROOT  =', WORK_ROOT);
console.log('[config] MANAGED_ROOT=', MANAGED_ROOT);
console.log('[config] TRASH_DIR  =', TRASH_DIR);
console.log('[config] DATA_DIR   =', DATA_DIR);
console.log('[config] DB_PATH    =', DB_PATH);
console.log('[config] THUMB_DIR  =', THUMB_DIR);
console.log('[config] PREVIEW_DIR=', PREVIEW_DIR);
console.log('[config] POSTER_DIR =', POSTER_DIR);

// Routes
const jobsRoutes = require('./src/routes/jobs');
const assetRoutes = require('./src/routes/assets');
const fileRoutes = require('./src/routes/files');
const changeRoutes = require('./src/routes/changes');
const albumRoutes = require('./src/routes/albums');
const organizeRoutes = require('./src/routes/organize');
const tagRoutes = require('./src/routes/tags');
const configRoutes = require('./src/routes/config');
const libraryRoutes = require('./src/routes/library');
const faceRoutes = require('./src/routes/faces');
const duplicatesRoutes = require('./src/routes/duplicates');

app.use('/api/jobs', jobsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/changes', changeRoutes);
app.use('/api/albums', albumRoutes);
app.use('/api/organize', organizeRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/faces', faceRoutes);
app.use('/api/duplicates', duplicatesRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

