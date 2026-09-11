const Database = require('better-sqlite3');
const schema = require('../../../db/schema');
const { TIME_METADATA_VERSION, updateExistingAssetMetadata } = require('../enrich');

describe('enrich asset time refresh', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(schema);
  });

  afterEach(() => db.close());

  test('replaces an automatic capture time with unknown instead of freezing a stale value', () => {
    db.prepare(`
      INSERT INTO assets (hash, captured_at, captured_local_ms, time_source, time_locked)
      VALUES ('asset', 1, 1, 'embedded', 0)
    `).run();

    updateExistingAssetMetadata(db, {
      hash: 'asset',
      metadata: null,
      stat: { size: 10 },
      mimeType: 'image/png',
      ts: 100,
    });

    expect(db.prepare(`
      SELECT captured_at, captured_local_ms, time_source, time_scanned_at, time_metadata_version
      FROM assets WHERE hash = 'asset'
    `).get()).toEqual({
      captured_at: null,
      captured_local_ms: null,
      time_source: null,
      time_scanned_at: 100,
      time_metadata_version: TIME_METADATA_VERSION,
    });
  });

  test('does not overwrite a manually locked time during metadata refresh', () => {
    db.prepare(`
      INSERT INTO assets (
        hash, captured_at, captured_local_ms, time_zone, time_source, time_confidence, time_locked
      ) VALUES ('asset', 10, 20, 'Asia/Shanghai', 'manual', 'high', 1)
    `).run();

    updateExistingAssetMetadata(db, {
      hash: 'asset',
      metadata: {
        captured_at: 1000,
        captured_local_ms: 2000,
        time_zone: 'UTC',
        time_source: 'embedded',
        time_tag: 'CreateDate',
        time_confidence: 'medium',
      },
      stat: { size: 10 },
      mimeType: 'video/mp4',
      ts: 100,
    });

    expect(db.prepare(`
      SELECT captured_at, captured_local_ms, time_zone, time_source, time_confidence, time_locked
      FROM assets WHERE hash = 'asset'
    `).get()).toEqual({
      captured_at: 10,
      captured_local_ms: 20,
      time_zone: 'Asia/Shanghai',
      time_source: 'manual',
      time_confidence: 'high',
      time_locked: 1,
    });
  });

  test('does not let a duplicate without metadata erase a stronger result from the same scan version', () => {
    db.prepare(`INSERT INTO assets (hash, time_locked, time_metadata_version) VALUES ('asset', 0, 0)`).run();
    updateExistingAssetMetadata(db, {
      hash: 'asset',
      metadata: {
        captured_at: 1000,
        captured_local_ms: 1000,
        time_source: 'sidecar',
        time_confidence: 'high',
      },
      stat: { size: 10 },
      mimeType: 'image/jpeg',
      ts: 100,
    });
    updateExistingAssetMetadata(db, {
      hash: 'asset',
      metadata: null,
      stat: { size: 10 },
      mimeType: 'image/jpeg',
      ts: 101,
    });

    expect(db.prepare('SELECT captured_at, time_source FROM assets WHERE hash = ?').get('asset'))
      .toEqual({ captured_at: 1000, time_source: 'sidecar' });
  });
});
