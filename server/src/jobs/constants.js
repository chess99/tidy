const JOB_TYPES = [
  'discover',
  'enrich',
  'thumbs_rebuild',
  'faces_scan',
  'faces_reset',
  'faces_recluster',
  'sync',
  'clip',
  'ocr',
];

const JOB_MODES = ['all', 'missing'];

const JOB_STATUSES = ['queued', 'running', 'finished', 'failed', 'cancelled', 'interrupted'];

function isValidJobType(t) {
  return JOB_TYPES.includes(String(t || ''));
}

function isValidJobMode(m) {
  return JOB_MODES.includes(String(m || ''));
}

module.exports = {
  JOB_TYPES,
  JOB_MODES,
  JOB_STATUSES,
  isValidJobType,
  isValidJobMode,
};


