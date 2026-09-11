/**
 * input: 媒体文件路径 + 可选同名 XMP 旁车
 * output: 可信媒体时间（含来源/时区/置信度）+ 图像与相机元数据
 * pos: 服务端扫描管线：统一通过 ExifTool 提取图片、视频与 RAW 元数据（变更需同步更新本头注释）
 */

const path = require('path');
const fs = require('fs-extra');
const { ExifDateTime, ExifTool } = require('exiftool-vendored');

const TIME_METADATA_VERSION = 1;
const TIME_TAGS = [
  { tag: 'SubSecDateTimeOriginal', confidence: 'high' },
  { tag: 'SubSecCreateDate', confidence: 'medium' },
  { tag: 'DateTimeOriginal', confidence: 'high' },
  { tag: 'CreationDate', confidence: 'medium' },
  { tag: 'CreateDate', confidence: 'medium' },
  { tag: 'MediaCreateDate', confidence: 'medium' },
  { tag: 'DateTimeCreated', confidence: 'medium' },
  { tag: 'GPSDateTime', confidence: 'high' },
  { tag: 'DateTimeUTC', confidence: 'high' },
  { tag: 'SonyDateTime2', confidence: 'medium' },
  { tag: 'SourceImageCreateTime', confidence: 'high' },
];

let reader = null;

function getReader() {
  if (reader) return reader;
  reader = new ExifTool({
    backfillTimezones: true,
    defaultVideosToUTC: true,
    inferTimezoneFromDatestamps: true,
    inferTimezoneFromTimeStamp: true,
    useMWG: true,
    taskTimeoutMillis: 120_000,
    readArgs: ['-api', 'largefilesupport=1'],
  });
  return reader;
}

function parseExifDateTime(value) {
  if (value instanceof ExifDateTime) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  return ExifDateTime.fromEXIF(value) || ExifDateTime.fromISO(value) || null;
}

function selectCaptureTime(tags, source = 'embedded') {
  for (const candidate of TIME_TAGS) {
    const dateTime = parseExifDateTime(tags?.[candidate.tag]);
    if (!dateTime?.isValid) continue;

    const capturedLocalMs = Date.UTC(
      dateTime.year,
      dateTime.month - 1,
      dateTime.day,
      dateTime.hour,
      dateTime.minute,
      dateTime.second,
      Number(dateTime.millisecond || 0)
    );
    if (!Number.isFinite(capturedLocalMs)) continue;

    const offsetMinutes = Number(dateTime.tzoffsetMinutes);
    const hasOffset = Number.isFinite(offsetMinutes);
    return {
      captured_at: hasOffset ? capturedLocalMs - (offsetMinutes * 60_000) : capturedLocalMs,
      captured_local_ms: capturedLocalMs,
      time_zone: dateTime.zoneName || dateTime.zone || null,
      time_source: source,
      time_tag: candidate.tag,
      time_confidence: source === 'sidecar' ? 'high' : candidate.confidence,
      time_zone_inferred: dateTime.inferredZone ? 1 : 0,
      time_raw: dateTime.rawValue || String(tags[candidate.tag]),
    };
  }
  return null;
}

async function findSidecar(filePath) {
  const parsed = path.parse(filePath);
  const candidates = [`${filePath}.xmp`, path.join(parsed.dir, `${parsed.name}.xmp`)];
  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) return candidate;
  }
  return null;
}

function asFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function extractMetadata(filePath) {
  const metadataReader = getReader();
  const sidecarPath = await findSidecar(filePath);
  const isVideo = /\.(?:3gp|avi|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/i.test(filePath);
  const [mediaTags, sidecarTags] = await Promise.all([
    metadataReader.read(filePath, isVideo ? { readArgs: ['-ee'] } : undefined),
    sidecarPath ? metadataReader.read(sidecarPath) : null,
  ]);

  const captureTime = (sidecarTags ? selectCaptureTime(sidecarTags, 'sidecar') : null)
    || selectCaptureTime(mediaTags, 'embedded');
  const tags = { ...mediaTags, ...(sidecarTags || {}) };

  return {
    width: asFiniteNumber(tags.ExifImageWidth ?? tags.ImageWidth),
    height: asFiniteNumber(tags.ExifImageHeight ?? tags.ImageHeight),
    camera_make: tags.Make ? String(tags.Make) : null,
    camera_model: tags.Model ? String(tags.Model) : null,
    lat: asFiniteNumber(tags.GPSLatitude),
    lon: asFiniteNumber(tags.GPSLongitude),
    sidecar_path: sidecarPath,
    captured_at: captureTime?.captured_at ?? null,
    captured_local_ms: captureTime?.captured_local_ms ?? null,
    time_zone: captureTime?.time_zone ?? null,
    time_source: captureTime?.time_source ?? null,
    time_tag: captureTime?.time_tag ?? null,
    time_confidence: captureTime?.time_confidence ?? null,
    time_zone_inferred: captureTime?.time_zone_inferred ?? 0,
    time_raw: captureTime?.time_raw ?? null,
  };
}

async function closeMetadataReader() {
  if (!reader) return;
  const activeReader = reader;
  reader = null;
  await activeReader.end();
}

module.exports = { TIME_METADATA_VERSION, TIME_TAGS, selectCaptureTime, extractMetadata, closeMetadataReader };
