export function displayPersonName(person) {
  return person.name?.trim() || `人物 ${person.id}`;
}

export function sortPeople(people) {
  return [...people].sort((a, b) => {
    const aNamed = !!a.name?.trim();
    const bNamed = !!b.name?.trim();
    if (aNamed !== bNamed) return aNamed ? -1 : 1;
    if (aNamed) return displayPersonName(a).localeCompare(displayPersonName(b), 'zh-CN', { numeric: true });
    const photoCountDifference = Number(b.face_count || 0) - Number(a.face_count || 0);
    return photoCountDifference || a.id - b.id;
  });
}

export function filterPeople(people, query) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase('zh-CN');
  if (!normalizedQuery) return people;
  return people.filter((person) => (
    displayPersonName(person).toLocaleLowerCase('zh-CN').includes(normalizedQuery)
    || String(person.id).includes(normalizedQuery)
  ));
}

export function normalizePersonName(name) {
  return String(name || '').trim().toLocaleLowerCase('zh-CN');
}
