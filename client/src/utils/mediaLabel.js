export function fileNameFromPath(p) {
  if (!p) return '';
  const s = String(p);
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

export function extFromPath(p) {
  const base = fileNameFromPath(p);
  if (!base) return '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot);
}

export function topLabelFromExt(ext) {
  const raw = String(ext || '');
  const s = raw.startsWith('.') ? raw.slice(1) : raw;
  const up = s.trim().toUpperCase();
  return up ? up.slice(0, 8) : '';
}

export function topLabelFromMime(mime) {
  if (!mime) return 'FILE';
  const m = String(mime);
  if (m.startsWith('image/')) return 'IMG';
  if (m.startsWith('video/')) return 'VID';
  const parts = m.split('/');
  return (parts[1] || parts[0] || 'FILE').toUpperCase().slice(0, 8);
}

export function preferredTopLabel({ ext, path, mime }) {
  const extLabel = topLabelFromExt(ext || extFromPath(path));
  if (extLabel) return extLabel;
  return topLabelFromMime(mime) || 'FILE';
}


