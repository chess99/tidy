/**
 * input: two file/content rows
 * output: whether they are safe to treat as the same content for destructive dedupe
 * pos: service layer guardrail for hash-based duplicate actions
 */

const { areFilesByteEqual } = require('./fileSafety');

async function canTreatAsSameContentForDestructiveDedupe(a, b) {
  if (!a || !b) return false;
  if (!a.hash || !b.hash || String(a.hash) !== String(b.hash)) return false;
  const algoA = String(a.hash_algo || 'md5').toLowerCase();
  const algoB = String(b.hash_algo || 'md5').toLowerCase();
  if (algoA !== algoB) return false;
  if (Number(a.size) !== Number(b.size)) return false;
  if (algoA === 'sha256') return true;
  if (!a.path || !b.path) return false;
  return await areFilesByteEqual(a.path, b.path);
}

module.exports = { canTreatAsSameContentForDestructiveDedupe };
