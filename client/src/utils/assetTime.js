function finiteTime(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function captureTimeOf(asset) {
  return finiteTime(asset?.captured_at ?? asset?.asset_captured_at);
}

export function timelineTimeOf(asset) {
  return captureTimeOf(asset) ?? finiteTime(asset?.timeline_at ?? asset?.display_time);
}

export function isTrustedCaptureTime(asset) {
  return captureTimeOf(asset) != null;
}

function captureLocalTimeOf(asset) {
  return finiteTime(asset?.captured_local_ms ?? asset?.asset_captured_local_ms);
}

export function formatCaptureDateTime(asset, locale = undefined) {
  const time = captureTimeOf(asset);
  if (!time) return null;
  const localTime = captureLocalTimeOf(asset);
  return new Date(localTime ?? time).toLocaleString(locale, {
    ...(localTime ? { timeZone: 'UTC' } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeSourceLabel(asset) {
  const source = asset?.time_source ?? asset?.asset_time_source;
  const tag = asset?.time_tag ?? asset?.asset_time_tag;
  if (source === 'manual') return '人工设置';
  if (source === 'manual_unknown') return '人工标记为未知';
  if (source === 'sidecar') return tag ? `XMP · ${tag}` : 'XMP 旁车';
  if (source === 'embedded') return tag ? `媒体元数据 · ${tag}` : '媒体元数据';
  return '文件系统时间（仅用于排序）';
}

export function formatTimelineDate(asset, locale = undefined) {
  const time = timelineTimeOf(asset);
  if (!time) return null;
  const localTime = captureLocalTimeOf(asset);
  const text = new Date(localTime ?? time).toLocaleDateString(locale, localTime ? { timeZone: 'UTC' } : undefined);
  return isTrustedCaptureTime(asset) ? text : `文件 ${text}`;
}
