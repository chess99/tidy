const Database = require('better-sqlite3');
const path = require('path');
const { DB_PATH } = require('../src/config');

console.log('Opening DB at:', DB_PATH);
const db = new Database(DB_PATH);

// Reconstruct logic from server/src/routes/files.js
const filter = 'media';
const hasDup = 1; // true
const limit = 50;
const offset = 100; // page 3

let where = '';
let whereParams = [];

if (filter === 'media') {
  where = `
    WHERE (
      COALESCE(a.mime_type, f.mime_guess) LIKE 'image/%'
      OR COALESCE(a.mime_type, f.mime_guess) LIKE 'video/%'
    )
  `;
}

const timeExpr = `COALESCE(a.taken_at, f.mtime_ms, f.discovered_at, f.scanned_at)`;

if (!where) where = 'WHERE 1=1';

const dupHashesQuery = `SELECT hash FROM files WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*) > 1`;

if (hasDup === 1) {
   where += ` AND f.hash IN (${dupHashesQuery})`;
} else if (hasDup === 0) {
   where += ` AND (f.hash IS NULL OR f.hash NOT IN (${dupHashesQuery}))`;
}

// Construct the query
const query = `
  SELECT
    f.*
  FROM files f
  LEFT JOIN assets a ON a.hash = f.hash
  ${where}
  ORDER BY ${timeExpr} DESC
  LIMIT ? OFFSET ?
`;

console.log('Query:', query);

try {
  const start = Date.now();
  const stmt = db.prepare(query);
  const rows = stmt.all(...whereParams, limit, offset);
  const end = Date.now();
  console.log(`Query execution time: ${end - start}ms`);
  console.log(`Rows returned: ${rows.length}`);

  // Explain Query Plan
  const explain = db.prepare('EXPLAIN QUERY PLAN ' + query).all(...whereParams, limit, offset);
  console.log('Query Plan:', JSON.stringify(explain, null, 2));

} catch (err) {
  console.error('Error executing query:', err);
}
