'use strict';

// Addr() can collide between different handles. A captured absolute Lua path identifies
// an object within a snapshot; numeric command addresses are only optional shortcuts.
function groupCapture(rows) {
  const byLua = new Map();
  for (const row of rows) {
    if (byLua.has(row.lua_address)) throw new Error(`Duplicate Lua path: ${row.lua_address}`);
    byLua.set(row.lua_address, row);
  }
  const incoming = new Map();
  const childLua = (row, child) => `${row.lua_address}[${child.index}]`;
  for (const row of rows) for (const child of row.children) {
    if (!child.link) incoming.set(childLua(row, child), row.lua_address);
  }
  const memo = new Map();
  function key(row) {
    if (memo.has(row.lua_address)) return memo.get(row.lua_address);
    const parent = byLua.get(incoming.get(row.lua_address));
    const segment = row.class + (['Presets', 'Patch'].includes(row.class) ? `:${row.native_index}` : '');
    const result = `${parent ? key(parent) : ''}/${segment}`;
    memo.set(row.lua_address, result);
    return result;
  }
  const grouped = new Map();
  for (const row of rows) {
    const nodeKey = key(row);
    if (!grouped.has(nodeKey)) grouped.set(nodeKey, { key: nodeKey, class: row.class, samples: [], properties: new Map(), children: new Set() });
    const group = grouped.get(nodeKey);
    group.samples.push(row);
    for (const p of row.properties) group.properties.set(`${p.name}|${p.type}|${p.info?.EnumCollection}`, p);
    for (const child of row.children) {
      const next = byLua.get(childLua(row, child));
      if (next && !child.link) group.children.add(key(next));
    }
  }
  return { byLua, incoming, childLua, key, grouped };
}

module.exports = { groupCapture };
