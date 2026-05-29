/**
 * input: 文件路径/媒体字节 + 配置
 * output: hash/元信息/缩略图/人脸等派生产物
 * pos: 服务端扫描管线：从文件系统提取结构化信息（变更需同步更新本头注释与所属目录 README）
 */

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
