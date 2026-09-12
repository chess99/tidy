export function reviewShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
      event.target?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return null;
  if (event.key === 'ArrowLeft' && !event.shiftKey) return 'previous';
  if (event.key === 'ArrowRight' && !event.shiftKey) return 'next';
  if (event.repeat) return null;
  if (event.key === '?' || (event.shiftKey && event.key === '/')) return 'help';
  if (event.key === 'Enter' && event.shiftKey) return 'apply';
  if (event.shiftKey) return null;
  if (/^[1-9]$/.test(event.key)) return Number(event.key) - 1;
  if (event.key.toLowerCase() === 'r') return 'recommend';
  if (event.key.toLowerCase() === 'a') return 'keep';
  if (event.key === ' ' && !event.target?.closest?.('button, a, [role="button"]')) return 'compare';
  return null;
}

export function applyReviewDelta(data, delta) {
  if (!data) return data;
  const removed = new Set(delta.removedGroupIds || []);
  const replacements = delta.updatedGroups || [];
  const replacementIds = new Set(replacements.map((g) => g.id));
  return { ...data, groups: [...data.groups.filter((g) => !removed.has(g.id) && !replacementIds.has(g.id)), ...replacements] };
}

export function nextReviewId(groups, currentId, delta) {
  const removed = new Set(delta.removedGroupIds || []);
  const index = groups.findIndex((g) => g.id === currentId);
  if (!removed.has(currentId)) return currentId;
  return groups.slice(index + 1).find((g) => !removed.has(g.id))?.id ||
    delta.updatedGroups?.[0]?.id || groups.slice(0, index).reverse().find((g) => !removed.has(g.id))?.id || null;
}

export function previewUrl(item, apiUrl, large = false) {
  return apiUrl(`/assets/${item.hash}/preview?max=${large ? 2048 : 1280}&q=85`);
}

export function formatBytes(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  let size = Number(value), unit = 0;
  while (size >= 1024 && unit < 3) { size /= 1024; unit++; }
  return `${size.toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

export function shortFolder(path) {
  const normalized = String(path || '').replace(/\\/g, '/');
  return normalized.replace(/^.*?\/photos\//i, '').replace(/\/[^/]*$/, '');
}
