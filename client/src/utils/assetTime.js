function finiteTime(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function captureTimeOf(asset) {
  return finiteTime(asset?.captured_at ?? asset?.asset_captured_at);
}

export function timelineTimeOf(asset) {
  return captureTimeOf(asset) ?? finiteTime(asset?.timeline_at ?? asset?.display_time);
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

export function formatTimelineDate(asset, locale = undefined) {
  const time = timelineTimeOf(asset);
  if (!time) return null;
  const localTime = captureLocalTimeOf(asset);
  return new Date(localTime ?? time).toLocaleDateString(locale, localTime ? { timeZone: 'UTC' } : undefined);
}

export function formatTimelineDateTime(asset, locale = undefined) {
  if (captureTimeOf(asset) != null) return formatCaptureDateTime(asset, locale);
  const time = timelineTimeOf(asset);
  if (time == null) return null;
  return new Date(time).toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
