const { distance, keyOf } = require("./model");

const HOUR = 3600000;
const DAY = 24 * HOUR;
const date = (b) => new Date(b.time).toISOString().slice(0, 10);
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const isReference = (b) =>
  /screenshot|截屏|截图|wallpaper|壁纸|mmexport|\/wechat\/|\/微信\//i.test(
    `${b.name}/${b.originalFolder}/`,
  );
function namedFolder(b) {
  return b.originalFolder
    .split("/")
    .some(
      (p) =>
        /^\d{8}[\s\u4e00-\u9fff_-]/.test(p) || /^\d{4}-\d{2}-\d{2}\s/.test(p),
    );
}
function placeName(gps, rules) {
  if (!gps) return "地点未定";
  return (
    rules.places.find((p) => distance(gps, p) <= p.radiusKm)?.name ||
    `地点 ${gps.lat.toFixed(1)}, ${gps.lon.toFixed(1)}`
  );
}
function lowerBound(values, target) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function geography(bundles, rules) {
  const regions = [];
  const geo = bundles.filter(
    (b) => b.gps && Number.isFinite(b.time) && !isReference(b),
  );
  const evidence = new Map();
  for (const b of geo) {
    let region = regions.find((r) => distance(r.center, b.gps) < 45);
    if (!region) {
      region = { id: regions.length, center: b.gps, days: new Set() };
      regions.push(region);
    }
    region.days.add(Math.floor(b.time / DAY));
    evidence.set(b.id, { gps: b.gps, region, inferred: false });
  }
  for (const r of regions) r.days = [...r.days].sort((a, b) => a - b);
  const geoTimes = geo.map((b) => b.time);
  for (const b of bundles) {
    if (evidence.has(b.id) || !Number.isFinite(b.time)) continue;
    const i = lowerBound(geoTimes, b.time);
    const left = geo[i - 1];
    const right = geo[i];
    // Borrow position only when observations bracket the photo and agree. A single nearby point may be a different person's camera.
    if (
      left &&
      right &&
      b.time - left.time < 2 * HOUR &&
      right.time - b.time < 2 * HOUR &&
      distance(left.gps, right.gps) < 8
    ) {
      evidence.set(b.id, { ...evidence.get(left.id), inferred: true });
    }
  }
  const homesCache = new Map();
  const homesAt = (time) => {
    const day = Math.floor(time / DAY);
    if (!homesCache.has(day)) {
      const candidates = regions
        .map((r) => {
          const days = r.days.slice(
            lowerBound(r.days, day - 90),
            lowerBound(r.days, day + 91),
          );
          return { region: r, days };
        })
        .filter((r) => r.days.length >= 8 && r.days.at(-1) - r.days[0] >= 30);
      const max = Math.max(0, ...candidates.map((c) => c.days.length));
      homesCache.set(
        day,
        candidates
          .filter((c) => c.days.length >= max * 0.45)
          .map((c) => c.region),
      );
    }
    return homesCache.get(day);
  };
  for (const b of bundles) {
    const e = evidence.get(b.id);
    if (!e) continue;
    const homes = homesAt(b.time);
    const withinHome = homes.some((r) => distance(r.center, e.gps) < 80);
    const r = e.region;
    const day = Math.floor(b.time / DAY);
    const nearbyDays = r.days.slice(
      lowerBound(r.days, day - 45),
      lowerBound(r.days, day + 46),
    );
    const episodic =
      nearbyDays.length >= 2 &&
      nearbyDays.at(-1) - nearbyDays[0] <= rules.tripDays;
    e.travel = homes.length ? !withinHome : episodic;
    e.home = withinHome;
    e.residenceKnown = homes.length > 0;
    e.recurring = r.days.length >= 8 && r.days.at(-1) - r.days[0] >= 30;
  }
  return evidence;
}

function cluster(bundles, rules, previous = {}, themeMatches = {}) {
  bundles = bundles.map((b) => ({
    ...b,
    camera: String(b.camera || "")
      .replace(/\0/g, "")
      .trim(),
  }));
  const result = {};
  const pending = [];
  const validTime = (b) =>
    Number.isFinite(b.time) && Number.isFinite(new Date(b.time).getTime());
  const themeOf = (b) =>
    rules.themes.find(
      (t) =>
        b.tags.split("|").includes(t.name) || b.originalFolder.includes(t.name),
    )?.name || themeMatches[b.id];
  const put = (b, folder, kind, reason, review = true, eventRoot) => {
    result[b.id] = {
      folder,
      kind,
      reason,
      review,
      manual: false,
      ...(eventRoot ? { eventRoot } : {}),
    };
  };
  for (const b of bundles) {
    if (previous[b.id]?.manual) {
      result[b.id] = previous[b.id];
      continue;
    }
    if (rules.preserveNamed && namedFolder(b)) {
      put(
        b,
        b.originalFolder,
        "existing",
        "沿用已命名目录",
        false,
        b.originalFolder,
      );
      continue;
    }
    if (isReference(b)) {
      put(
        b,
        `资料/${/screenshot|截屏|截图/i.test(b.name + b.originalFolder) ? "截图" : "保存的图片"}`,
        "reference",
        "截图或应用保存的图片",
        false,
      );
      continue;
    }
    if (!validTime(b)) {
      put(b, "待确认/日期缺失", "unresolved", "缺少可信拍摄日期");
      continue;
    }
    pending.push(b);
  }
  pending.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const allDated = bundles
    .filter(validTime)
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const evidence = geography(allDated, rules);
  const trips = [];
  let current;
  const finishTrip = () => {
    if (current) trips.push(current);
    current = undefined;
  };
  for (const b of pending) {
    const e = evidence.get(b.id);
    if (e?.home) {
      finishTrip();
      continue;
    }
    if (
      current &&
      (b.time - current.lastEvidence > rules.tripGapHours * HOUR ||
        b.time - current.items[0].time > rules.tripDays * DAY)
    )
      finishTrip();
    if (e?.travel) {
      if (!current) current = { items: [], lastEvidence: b.time };
      current.items.push(b);
      current.lastEvidence = b.time;
    } else if (current && !e) current.items.push(b);
    else if (e) finishTrip();
  }
  finishTrip();
  const tripIds = new Set();
  for (const trip of trips) {
    const positioned = trip.items.filter((b) => evidence.get(b.id)?.travel);
    if (
      new Set(positioned.map(date)).size < 2 ||
      trip.items.length < rules.minPhotos
    )
      continue;
    const end = positioned.at(-1).time;
    const startTime = trip.items[0].time;
    const cameras = new Set(positioned.map((b) => b.camera).filter(Boolean));
    const leading = pending.filter(
      (b) =>
        b.time < startTime &&
        startTime - b.time <= 2 * HOUR &&
        !evidence.has(b.id) &&
        cameras.has(b.camera) &&
        !tripIds.has(b.id),
    );
    const items = [...leading, ...trip.items.filter((b) => b.time <= end)].sort(
      (a, b) => a.time - b.time || a.id.localeCompare(b.id),
    );
    const gps = {
      lat: median(positioned.map((b) => evidence.get(b.id).gps.lat)),
      lon: median(positioned.map((b) => evidence.get(b.id).gps.lon)),
    };
    const multi =
      new Set(positioned.map((b) => evidence.get(b.id).region.id)).size > 1;
    const startDate = date(items[0]);
    const endDate = date(items.at(-1));
    const residenceKnown = positioned.some(
      (b) => evidence.get(b.id).residenceKnown,
    );
    const label = multi
      ? "多地行程"
      : `${placeName(gps, rules)}${residenceKnown ? "旅行" : "多日记录"}`;
    const parent = `事件/${startDate.slice(0, 4)}/${startDate}—${endDate} ${label}`;
    for (const b of items) {
      tripIds.add(b.id);
      put(
        b,
        `${parent}/${date(b).slice(5)}`,
        "trip",
        residenceKnown
          ? "跨日外出记录，按行程连接；子目录保留每天的拍摄"
          : "短期连续多日记录，可能属于一次行程",
        true,
        parent,
      );
    }
  }

  const streams = [pending.filter((b) => !tripIds.has(b.id))];
  const sessions = [];
  for (const items of streams) {
    let session;
    for (const b of items) {
      const last = session?.at(-1);
      const e = evidence.get(b.id);
      const lastEvidence = last && evidence.get(last.id);
      const gap = last ? b.time - last.time : Infinity;
      const crossingNight =
        last &&
        date(last) !== date(b) &&
        new Date(last.time).getUTCHours() >= 16 &&
        new Date(b.time).getUTCHours() <= 13;
      const overnight =
        crossingNight && !e?.home && gap <= rules.overnightHours * HOUR;
      const sameCameraBreak =
        !e &&
        !lastEvidence &&
        b.camera &&
        b.camera === last?.camera &&
        gap <= Math.max(rules.gapHours, 12) * HOUR;
      const tooFar =
        e &&
        lastEvidence &&
        !e.inferred &&
        !lastEvidence.inferred &&
        distance(e.gps, lastEvidence.gps) > 25;
      const differentDayAtHome = last && date(last) !== date(b) && e?.home;
      if (
        !session ||
        (!overnight && !sameCameraBreak && gap > rules.gapHours * HOUR) ||
        tooFar ||
        differentDayAtHome ||
        b.time - session[0].time > 2 * DAY
      ) {
        session = [];
        sessions.push(session);
      }
      session.push(b);
    }
  }
  const usedFolders = new Set();
  for (const session of sessions) {
    const themes = new Map();
    for (const b of session) {
      const t = themeOf(b);
      if (t) themes.set(t, (themes.get(t) || 0) + 1);
    }
    const dominant = Math.max(0, ...themes.values());
    const isEvent =
      session.length >= rules.minPhotos && dominant / session.length < 0.7;
    if (isEvent) {
      const first = session[0];
      const start = date(first);
      const end = date(session.at(-1));
      const points = session
        .map((b) => evidence.get(b.id)?.gps)
        .filter(Boolean);
      const gps = points.length
        ? {
            lat: median(points.map((p) => p.lat)),
            lon: median(points.map((p) => p.lon)),
          }
        : undefined;
      const label = gps ? placeName(gps, rules) : "拍摄记录";
      let folder = `事件/${start.slice(0, 4)}/${start}${end !== start ? `—${end}` : ""} ${label} ${new Date(first.time).toISOString().slice(11, 16).replace(":", "")}`;
      if (usedFolders.has(folder)) folder += ` ${keyOf(first.id).slice(0, 5)}`;
      usedFolders.add(folder);
      const devices = new Set(session.map((b) => b.camera).filter(Boolean));
      for (const b of session)
        put(
          b,
          folder,
          "event",
          gps
            ? "同一区域内的连续拍摄片段"
            : devices.size > 1
              ? "多设备同时间拍摄，需确认是否同一活动"
              : "连续拍摄，地点未知",
          true,
          folder,
        );
      continue;
    }
    for (const b of session) {
      const theme = themeOf(b);
      const e = evidence.get(b.id);
      const period = date(b).slice(0, rules.dailyPeriod === "month" ? 7 : 4);
      if (theme) put(b, `主题/${theme}/${period}`, "theme", "主题匹配");
      else if (e?.home && e.recurring)
        put(
          b,
          `日常/${placeName(e.region.center, rules)}/${period}`,
          "daily",
          "长期反复出现的生活区域",
        );
      else
        put(
          b,
          `生活散片/${placeName(e?.gps, rules)}/${period}`,
          "life",
          "零散记录，保留时间与地点线索",
        );
    }
  }
  return result;
}

module.exports = { cluster, geography, namedFolder };
