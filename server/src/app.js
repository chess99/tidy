/**
 * input: Express dependencies + route modules
 * output: configured Express app without starting listeners or background jobs
 * pos: server app factory used by production entrypoint and route integration tests
 */

const express = require('express');
const cors = require('cors');

function createApp({ includeConfig = true } = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use('/api/health', require('./routes/health'));
  app.use('/api/jobs', require('./routes/jobs'));
  if (includeConfig) app.use('/api/config', require('./routes/config'));
  app.use('/api/library', require('./routes/library'));
  app.use('/api/assets', require('./routes/assets'));
  app.use('/api/files', require('./routes/files'));
  app.use('/api/changes', require('./routes/changes'));
  app.use('/api/albums', require('./routes/albums'));
  app.use('/api/organize', require('./routes/organize'));
  app.use('/api/tags', require('./routes/tags'));
  app.use('/api/faces', require('./routes/faces'));
  app.use('/api/duplicates', require('./routes/duplicates'));
  app.use('/api/system', require('./routes/system'));

  return app;
}

module.exports = { createApp };
