// 测试 RAW 缩略图生成
// node scripts/test-raw-thumbs.js --root Z:\Photos --exts dng,cr2,nef,arw --perExt 30

/* eslint-disable no-console */
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const crypto = require('crypto');
const sharp = require('sharp');

const { generateThumbnail, RAW_EXTS } = require('../src/scanner/thumbnail');

function parseArgs(argv) {
  const args = { root: 'Z:\\Photos', perExt: 20, exts: 'dng,cr2,nef,arw', includeManaged: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = argv[++i];
    else if (a === '--perExt') args.perExt = Number(argv[++i] || 20);
    else if (a === '--exts') args.exts = String(argv[++i] || '');
    else if (a === '--includeManaged') args.includeManaged = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

async function walkFindByExt(root, wantExts, perExt, includeManaged) {
  const found = new Map(); // ext -> [paths]
  for (const e of wantExts) found.set(e, []);

  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    if (!includeManaged) {
      const base = path.basename(dir).toLowerCase();
      if (base === 'Tidy') continue;
    }
    let entries;
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // avoid huge hidden dirs
        if (ent.name.startsWith('.')) continue;
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;

      const ext = path.extname(ent.name).toLowerCase();
      if (!found.has(ext)) continue;
      const arr = found.get(ext);
      if (arr.length < perExt) arr.push(full);

      // stop early if satisfied all
      let done = true;
      for (const e of wantExts) {
        if ((found.get(e) || []).length < perExt) {
          done = false;
          break;
        }
      }
      if (done) return found;
    }
  }
  return found;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/test-raw-thumbs.js [--root Z:\\Photos] [--exts dng,cr2,nef,arw] [--perExt 20] [--includeManaged]');
    process.exit(0);
  }

  const root = path.resolve(String(args.root || ''));
  if (!root) throw new Error('missing --root');
  const perExt = Number.isFinite(args.perExt) && args.perExt > 0 ? Math.floor(args.perExt) : 20;

  const wantExts = String(args.exts || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s.startsWith('.') ? s : `.${s}`));

  if (!wantExts.length) throw new Error('No exts specified (use --exts dng,cr2,nef,arw)');

  console.log(`Searching for RAW samples under: ${root}`);
  console.log(`Extensions: ${wantExts.join(', ')}`);
  console.log(`Max candidates per ext: ${perExt}`);
  console.log(`Include managed Tidy: ${args.includeManaged ? 'yes' : 'no'}`);

  const found = await walkFindByExt(root, wantExts, perExt, args.includeManaged);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-rawthumbs-'));
  console.log(`Using temp thumb dir: ${tmpDir}`);

  const failures = [];
  for (const ext of wantExts) {
    const candidates = found.get(ext) || [];
    if (!candidates.length) {
      failures.push({ ext, error: 'no candidates found under root' });
      console.error(`FAIL ${ext}: no candidates found under root`);
      continue;
    }

    let ok = false;
    for (const p of candidates) {
      const id = crypto.randomBytes(8).toString('hex');
      const hash = `test-${ext.slice(1)}-${id}`;
      try {
        // eslint-disable-next-line no-await-in-loop
        const outPath = await generateThumbnail(p, hash, { ext, thumbDir: tmpDir });
        if (!outPath) throw new Error('generateThumbnail returned null');
        // eslint-disable-next-line no-await-in-loop
        const st = await fs.stat(outPath);
        if (!st.size) throw new Error('thumb file is empty');
        // eslint-disable-next-line no-await-in-loop
        await sharp(outPath).metadata();
        console.log(`OK  ${ext} -> ${path.basename(outPath)} (from ${p})`);
        ok = true;
        break;
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        console.error(`..  ${ext} candidate failed: ${p} :: ${msg}`);
      }
    }

    if (!ok) {
      failures.push({ ext, error: 'all candidates failed' });
      console.error(`FAIL ${ext}: all candidates failed`);
    }
  }

  if (failures.length) {
    console.error('\nFailures:');
    for (const f of failures) console.error(`- ${f.ext}: ${f.error}`);
    process.exit(1);
  }

  console.log('\nAll RAW thumbnail smoke tests passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


