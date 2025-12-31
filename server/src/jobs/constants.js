/**
 * input: 任务请求 + 配置/DB
 * output: 任务调度/存储/生命周期管理
 * pos: 服务端任务系统：编排后台作业（变更需同步更新本头注释与所属目录 README）
 */

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


