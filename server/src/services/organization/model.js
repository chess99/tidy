const path = require("path");
const crypto = require("crypto");

const DEFAULT_RULES = {
  gapHours: 8,
  tripDays: 3,
  minPhotos: 8,
  dailyPeriod: "year",
  preserveNamed: true,
  themes: [],
  places: [],
};
const DAY = 86400000;
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
        camera: primary.camera_model || "",
      };
    })
    .sort(
      (a, b) =>
        (a.time ?? Infinity) - (b.time ?? Infinity) || a.id.localeCompare(b.id),
    );
}
function placeOf(bundle, rules) {
  if (!bundle.gps) return "";
  const named = rules.places.find((p) => distance(bundle.gps, p) <= p.radiusKm);
  return (
    named?.name ||
    `地点 ${bundle.gps.lat.toFixed(1)}, ${bundle.gps.lon.toFixed(1)}`
  );
}
function generateAssignments(
  bundles,
  rawRules,
  previous = {},
  themeMatches = {},
) {
  const rules = rulesOf(rawRules);
  const result = {};
  const pending = [];
  const period = (b) =>
    new Date(b.time)
      .toISOString()
      .slice(0, rules.dailyPeriod === "month" ? 7 : 4);
  const put = (b, folder, reason, review = false, kind = "event") => {
    result[b.id] = { folder, reason, review, kind, manual: false };
  };
  for (const b of bundles) {
    if (previous[b.id]?.manual) {
      result[b.id] = previous[b.id];
      continue;
    }
    if (
      rules.preserveNamed &&
      b.originalFolder
        .split("/")
        .some(
          (p) =>
            /^\d{8}[\s\u4e00-\u9fff_-]/.test(p) ||
            /^\d{4}-\d{2}-\d{2}\s/.test(p),
        )
    ) {
      put(b, b.originalFolder, "沿用已命名目录", false, "existing");
      continue;
    }
    if (
      /screenshot|截屏|截图|wallpaper|壁纸|mmexport|\/wechat\/|\/微信\//i.test(
        b.name + "/" + b.originalFolder,
      )
    ) {
      put(
        b,
        `资料/${/screenshot|截屏|截图/i.test(b.name + b.originalFolder) ? "截图" : "保存的图片"}`,
        "来自截图或应用导出",
        false,
        "reference",
      );
      continue;
    }
    if (!b.time || !Number.isFinite(b.time)) {
      put(b, "待确认/日期缺失", "缺少可信拍摄日期", true, "unresolved");
      continue;
    }
    pending.push(b);
  }
  // A bounded session prevents temporal chaining from swallowing months of daily photos.
  const sessions = [];
  for (const b of pending) {
    const current = sessions.at(-1);
    const last = current?.at(-1);
    const gap = last ? b.time - last.time : Infinity;
    const jump = b.gps && last?.gps ? distance(b.gps, last.gps) : 0;
    if (
      !current ||
      gap > rules.gapHours * 3600000 ||
      b.time - current[0].time > rules.tripDays * DAY ||
      (jump > 100 && gap < 1800000)
    )
      sessions.push([b]);
    else current.push(b);
  }
  const placeDays = new Map();
  for (const b of pending) {
    const location = placeOf(b, rules);
    if (!location) continue;
    if (!placeDays.has(location)) placeDays.set(location, new Set());
    placeDays.get(location).add(new Date(b.time).toISOString().slice(0, 10));
  }
  for (const session of sessions) {
    const first = session[0];
    const date = new Date(first.time).toISOString().slice(0, 10);
    const end = new Date(session.at(-1).time).toISOString().slice(0, 10);
    const place = session.map((b) => placeOf(b, rules)).find(Boolean);
    const themeCounts = new Map();
    for (const b of session) {
      const theme =
        rules.themes.find(
          (t) =>
            b.tags.split("|").includes(t.name) ||
            b.originalFolder.includes(t.name),
        )?.name || themeMatches[b.id];
      if (theme) themeCounts.set(theme, (themeCounts.get(theme) || 0) + 1);
    }
    const dominant = [...themeCounts].sort((a, b) => b[1] - a[1])[0];
    const isEvent =
      session.length >= rules.minPhotos &&
      (!dominant || dominant[1] / session.length < 0.7);
    if (isEvent) {
      const suffix = new Date(first.time)
        .toISOString()
        .slice(11, 16)
        .replace(":", "");
      const folder = `事件/${date.slice(0, 4)}/${date}${end !== date ? `—${end}` : ""} ${place || "拍摄记录"} ${suffix}`;
      for (const b of session)
        put(
          b,
          folder,
          b.gps ? "连续拍摄，结合时间与位置" : "连续拍摄，地点缺失",
          !b.gps || !place,
          "event",
        );
      continue;
    }
    for (const b of session) {
      const theme =
        rules.themes.find(
          (t) =>
            b.tags.split("|").includes(t.name) ||
            b.originalFolder.includes(t.name),
        )?.name || themeMatches[b.id];
      const location = placeOf(b, rules);
      if (theme)
        put(
          b,
          `主题/${segment(theme)}/${period(b)}`,
          "主题匹配",
          true,
          "theme",
        );
      else if (location && placeDays.get(location)?.size >= 5)
        put(
          b,
          `日常/${location}/${period(b)}`,
          "多日反复出现在同一区域",
          true,
          "daily",
        );
      else
        put(
          b,
          `生活散片/${location || "地点未定"}/${period(b)}`,
          location ? "零散拍摄记录" : "缺少地点",
          !location,
          "life",
        );
    }
  }
  return result;
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
