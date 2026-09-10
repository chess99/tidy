const crypto = require('crypto');
const fs = require('fs');

function computeHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve({ hash: hash.digest('hex'), hash_algo: 'sha256' }));
  });
}

module.exports = { computeHash };
