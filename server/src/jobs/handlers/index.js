/**
 * input: job payload + DB/文件系统/服务层
 * output: 任务执行副作用 + 进度/结果写回
 * pos: 服务端任务处理器：实现具体 job 类型（变更需同步更新本头注释与所属目录 README）
 */

const { handleDiscover } = require('./discover');
const { handleEnrich } = require('./enrich');
const { handleThumbsRebuild } = require('./thumbsRebuild');
const { handleFacesScan } = require('./facesScan');
const { handleFacesReset } = require('./facesReset');
const { handleFacesRecluster } = require('./facesRecluster');
const { handleSync } = require('./sync');
const { handlePlaceholder } = require('./placeholder');
const { handleClipEnrich } = require('./clipEnrich');
const { handleClipIndex } = require('./clipIndex');

function getHandler(type) {
  switch (String(type)) {
    case 'discover':
      return handleDiscover;
    case 'enrich':
      return handleEnrich;
    case 'thumbs_rebuild':
      return handleThumbsRebuild;
    case 'faces_scan':
      return handleFacesScan;
    case 'faces_reset':
      return handleFacesReset;
    case 'faces_recluster':
      return handleFacesRecluster;
    case 'sync':
      return handleSync;
    case 'clip_enrich':
      return handleClipEnrich;
    case 'clip_index':
      return handleClipIndex;
    case 'ocr':
      return handlePlaceholder;
    default:
      return null;
  }
}

module.exports = { getHandler };


