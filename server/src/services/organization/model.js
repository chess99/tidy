const path = require("path");
const crypto = require("crypto");

const DEFAULT_RULES = {
  gapHours: 8,
  tripDays: 21,
  overnightHours: 18,
  tripGapHours: 72,
  minPhotos: 8,
  dailyPeriod: "year",
  preserveNamed: true,
  themes: [],
  places: [],
};
const RAW = /\.(dng|cr2|cr3|nef|arw|raf|rw2|orf|pef)$/i;
const MEDIA =
  /\.(jpe?g|png|webp|gif|heic|heif|tiff?|dng|cr2|cr3|nef|arw|raf|rw2|orf|pef|mp4|mov|avi|m4v|mkv|3gp)$/i;
const keyOf = (value) =>
  crypto.createHash("sha256").update(value).digest("hex").slice(0, 20);
function folderPath(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 220)
    throw new Error("请输入有效的相对目录（不超过 220 个字符）");
  const parts = value.replaceAll("\\", "/").split("/");
  if (
    parts.some(
      (p) =>
        !p ||
        p !== p.trim() ||
        /[<>:"|?*\x00-\x1f]/.test(p) ||
        /[. ]$/.test(p) ||
        /^(\.|\.\.|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    )
  )
    throw new Error("目录名称包含无效字符或保留名称");
  return parts.join("/");
}
const segment = (value) =>
  String(value || "")
    .replace(/[\\/<>:"|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 65) || "未命名";
function rulesOf(input = {}) {
  const rules = { ...DEFAULT_RULES, ...input };
  for (const [name, min, max] of [
    ["gapHours", 1, 48],
    ["tripDays", 1, 21],
    ["overnightHours", 8, 24],
    ["tripGapHours", 12, 120],
    ["minPhotos", 2, 100],
  ]) {
    if (
      !Number.isFinite(Number(rules[name])) ||
      rules[name] < min ||
      rules[name] > max
    )
      throw new Error("整理规则超出有效范围");
    rules[name] = Number(rules[name]);
  }
  if (
    !["year", "month"].includes(rules.dailyPeriod) ||
    typeof rules.preserveNamed !== "boolean"
  )
    throw new Error("整理规则无效");
  if (
    !Array.isArray(rules.themes) ||
    rules.themes.length > 8 ||
    !Array.isArray(rules.places) ||
    rules.places.length > 30
  )
    throw new Error("主题或地点过多");
  rules.themes = rules.themes
    .map((t) => ({
      name: segment(t.name),
      query: String(t.query || t.name || "")
        .trim()
        .slice(0, 100),
    }))
    .filter((t) => t.query);
  rules.places = rules.places.map((p) => {
    if (
      ![p.lat, p.lon, p.radiusKm].every(Number.isFinite) ||
      Math.abs(p.lat) > 90 ||
      Math.abs(p.lon) > 180 ||
      p.radiusKm <= 0 ||
      p.radiusKm > 200
    )
      throw new Error("地点坐标或半径无效");
    return {
      name: segment(p.name),
      lat: p.lat,
      lon: p.lon,
      radiusKm: p.radiusKm,
    };
  });
  return rules;
}
function distance(a, b) {
  const rad = Math.PI / 180;
  const x =
    Math.sin(((a.lat - b.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((a.lon - b.lon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, x)));
}
function coordinate(meta) {
  const lat = meta?.lat;
  const lon = meta?.lon;
  return Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    (lat !== 0 || lon !== 0)
    ? { lat, lon }
    : undefined;
}
function makeBundles(rows, root) {
  const buckets = new Map();
  for (const row of rows) {
    if (!MEDIA.test(row.path)) continue;
    const relative = path.relative(root, row.path).split(path.sep).join("/");
    const stem = relative.replace(/\.[^.]+$/, "").toLowerCase();
    if (!buckets.has(stem)) buckets.set(stem, []);
    buckets.get(stem).push({ ...row, relative });
  }
  return [...buckets.values()]
    .map((files) => {
      files.sort(
        (a, b) =>
          Number(RAW.test(a.path)) - Number(RAW.test(b.path)) || a.id - b.id,
      );
      const primary = files[0];
      let metadata = {};
      try {
        metadata = JSON.parse(primary.metadata || "{}");
      } catch {
        /* Missing metadata remains visible as a review item. */
      }
      return {
        id: keyOf(
          files
            .map((f) => f.id)
            .sort((a, b) => a - b)
            .join(","),
        ),
        name: path.basename(primary.path),
        hash: primary.hash,
        fileIds: files.map((f) => f.id),
        files: files.map((f) => ({
          id: f.id,
          path: f.path,
          relative: f.relative,
          hash: f.hash,
          size: f.size,
        })),
        time: primary.captured_local_ms ?? primary.captured_at ?? undefined,
        gps: coordinate(metadata),
        tags: primary.tags || "",
        originalFolder: path.posix.dirname(primary.relative),
        camera: String(primary.camera_model || "")
          .replace(/\0/g, "")
          .trim(),
      };
    })
    .sort(
      (a, b) =>
        (a.time ?? Infinity) - (b.time ?? Infinity) || a.id.localeCompare(b.id),
    );
}
function generateAssignments(
  bundles,
  rawRules,
  previous = {},
  themeMatches = {},
) {
  return require("./clustering").cluster(
    bundles,
    rulesOf(rawRules),
    previous,
    themeMatches,
  );
}

module.exports = {
  DEFAULT_RULES,
  folderPath,
  rulesOf,
  distance,
  makeBundles,
  generateAssignments,
  keyOf,
};
