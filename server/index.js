require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDB } = require('./src/db');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize DB
initDB();

// Routes
const scanRoutes = require('./src/routes/scan');
const assetRoutes = require('./src/routes/assets');
const syncRoutes = require('./src/routes/sync');

app.use('/api/scan', scanRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/sync', syncRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

