const crypto = require('crypto');
const fs = require('fs');

function computeHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5'); // MD5 is faster, collisions unlikely for this use case
    const stream = fs.createReadStream(filePath);

    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

module.exports = { computeHash };

