const { generateAssignments, DEFAULT_RULES } = require("../model");

const DAY = 86400000;
const start = Date.UTC(2025, 1, 1);
const home = { lat: 40, lon: 116.4 };
const away = { lat: 33.2, lon: 103.9 };
function photo(id, time, gps, camera = "camera") {
  return {
    id: String(id),
    time,
    gps,
    camera,
    name: `${id}.jpg`,
    originalFolder: "DCIM",
    tags: "",
  };
}
function residence() {
  return Array.from({ length: 24 }, (_, i) =>
    photo(`home-${i}`, start + (i - 12) * 5 * DAY, home),
  );
}
function trip(days = 10) {
  return Array.from({ length: days * 12 }, (_, i) =>
    photo(
      `trip-${i}`,
      start + Math.floor(i / 12) * DAY + 9 * 3600000 + (i % 12) * 40 * 60000,
      away,
    ),
  );
}
function groupRoots(items, assignments) {
  return new Set(
    items.map((b) => assignments[b.id].eventRoot || assignments[b.id].folder),
  );
}
test("ten-day travel has one parent and daily children, even without a known residence", () => {
  const items = trip();
  const result = generateAssignments(items, DEFAULT_RULES);
  expect(groupRoots(items, result).size).toBe(1);
  expect(new Set(Object.values(result).map((a) => a.folder)).size).toBe(10);
  expect(
    Object.values(result).every((a) => a.kind === "trip" && a.review),
  ).toBe(true);
});
test("leaving and returning home bound a trip; daily home photos are not absorbed by wide trip limits", () => {
  const travelling = trip(10);
  const after = photo("return", start + 10 * DAY, home);
  const items = [...residence(), ...travelling, after].sort(
    (a, b) => a.time - b.time,
  );
  const result = generateAssignments(items, DEFAULT_RULES);
  // The residence observation on day zero is before departure; later home observations signal returns.
  expect(result[after.id].kind).not.toBe("trip");
  expect(result[travelling[0].id].eventRoot).not.toBe(
    result[after.id].eventRoot,
  );
});
test("a two-day pause inside a trip is allowed, but a home event two days later stays separate", () => {
  const travelling = trip(4).filter(
    (b) => ![1, 2].includes(Math.floor((b.time - start) / DAY)),
  );
  const homes = residence().filter(
    (b) => b.time < start || b.time > start + 10 * DAY,
  );
  const work = Array.from({ length: 12 }, (_, i) =>
    photo(`work-${i}`, start + 6 * DAY + i * 60000, home),
  );
  const park = Array.from({ length: 12 }, (_, i) =>
    photo(`park-${i}`, start + 8 * DAY + i * 60000, home),
  );
  const result = generateAssignments(
    [...homes, ...travelling, ...work, ...park].sort((a, b) => a.time - b.time),
    DEFAULT_RULES,
  );
  expect(groupRoots(travelling, result).size).toBe(1);
  expect(result[work[0].id].eventRoot).not.toBe(result[park[0].id].eventRoot);
  expect(result[work[0].id].kind).toBe("event");
});
test("invalid timestamps remain unresolved rather than crashing generation", () => {
  const b = photo("invalid", 1e100);
  expect(generateAssignments([b], DEFAULT_RULES)[b.id].kind).toBe("unresolved");
});
test("manual assignments override algorithm suggestions", () => {
  const items = trip();
  const fixed = { folder: "事件/另一活动", manual: true, review: false };
  expect(
    generateAssignments(items, DEFAULT_RULES, { [items[0].id]: fixed })[
      items[0].id
    ],
  ).toEqual(fixed);
});
test("two simultaneous locations over 100 km apart are not merged merely by timestamps", () => {
  const items = Array.from({ length: 12 }, (_, i) =>
    photo(`a-${i}`, start + i * 60000, home),
  );
  items.push(
    ...Array.from({ length: 12 }, (_, i) =>
      photo(`b-${i}`, start + 20 * 60000 + i * 60000, away),
    ),
  );
  const result = generateAssignments(items, { ...DEFAULT_RULES, tripDays: 21 });
  expect(result["a-0"].eventRoot).not.toBe(result["b-0"].eventRoot);
});
