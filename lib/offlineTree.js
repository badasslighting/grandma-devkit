'use strict';

// The bundled object trees (grandMA3 onPC 2.5.1, grandMA2 onPC 3.9), used to browse the object tree
// when no console bridge is running. One sample per class path, so pools list only the sampled items.
const TREES = { ma3: require('../data/object-trees/ma3_tree.json'), ma2: require('../data/object-trees/ma2_tree.json') };

// Children of the node reached by following `path` (a list of node indexes, `i` in the data) from the root.
function offlineChildren(target, path) {
  let level = TREES[target === 'ma2' ? 'ma2' : 'ma3'];
  for (const idx of path || []) {
    const node = level.find((n) => n.i === idx);
    if (!node) return [];
    level = node.k || [];
  }
  return level.map((n) => ({
    index: n.i,
    cls: n.c,
    name: n.n || n.c,
    addr: n.a || n.p || '',
    lua: n.l || '',
    count: (n.k || []).length,
  }));
}

module.exports = { offlineChildren };
