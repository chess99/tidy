export function makeTree(draft) {
  const root = {
    path: "",
    name: "全部目录",
    children: new Map(),
    items: [],
    count: 0,
    review: 0,
  };
  if (!draft) return root;
  for (const bundle of draft.bundles) {
    const assignment = draft.assignments[bundle.id];
    if (!assignment) continue;
    let node = root;
    node.count++;
    if (assignment.review) node.review++;
    for (const part of assignment.folder.split("/")) {
      const full = node.path ? `${node.path}/${part}` : part;
      if (!node.children.has(part))
        node.children.set(part, {
          path: full,
          name: part,
          children: new Map(),
          items: [],
          count: 0,
          review: 0,
        });
      node = node.children.get(part);
      node.count++;
      if (assignment.review) node.review++;
    }
    node.items.push(bundle);
  }
  return root;
}
export function findNode(tree, path) {
  if (!path) return tree;
  let node = tree;
  for (const part of path.split("/")) {
    node = node.children.get(part);
    if (!node) return tree;
  }
  return node;
}
export function flattenItems(node) {
  return [...node.items, ...[...node.children.values()].flatMap(flattenItems)];
}
export function treeRows(node, collapsed = new Set(), depth = 0) {
  return [...node.children.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
    .flatMap((child) => [
      { ...child, depth },
      ...(!collapsed.has(child.path)
        ? treeRows(child, collapsed, depth + 1)
        : []),
    ]);
}
