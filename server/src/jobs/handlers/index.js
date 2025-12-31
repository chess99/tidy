const { handleDiscover } = require('./discover');
const { handleEnrich } = require('./enrich');
const { handleThumbsRebuild } = require('./thumbsRebuild');
const { handleFacesScan } = require('./facesScan');
const { handleFacesReset } = require('./facesReset');
const { handleFacesRecluster } = require('./facesRecluster');
const { handleSync } = require('./sync');
const { handlePlaceholder } = require('./placeholder');

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
    case 'clip':
    case 'ocr':
      return handlePlaceholder;
    default:
      return null;
  }
}

module.exports = { getHandler };


