export function updateItemSelection(previous, fileId, { additive = false } = {}) {
  if (!additive) return new Set([fileId]);

  const next = new Set(previous);
  if (next.has(fileId)) next.delete(fileId);
  else next.add(fileId);
  return next;
}

export function updateRangeSelection(previous, fileIds, { additive = false } = {}) {
  const next = additive ? new Set(previous) : new Set();
  for (const fileId of fileIds) next.add(fileId);
  return next;
}
