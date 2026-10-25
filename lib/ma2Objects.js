'use strict';
const { unquote } = require('./objectTree');

// grandMA2's object tree and show contents through gma.show.getobj, as seen on onPC 3.9.61:
// - `Root 1` ... `Root 14` are the top-level objects (with gaps); `Root n.m` is child number m of Root n.
// - child(handle, i) counts from 0 and is nil for an empty slot; amount() counts the slots, empty ones too.
// - number() is the pool number (1-based, sometimes blank); label() is nil unless the object has one.
const SEP = ' ;; ';
const PAGE = 500;

// Lua listing children of the object at `path` ([] = the roots, [3] = Root 3, [3, 1] = its second child...).
// Returns "total=<n>" and then `index|amount|number|class|name` records joined with SEP.
function ma2TreeLua(path, cap = PAGE) {
  const idx = path.map(Number).filter((n) => Number.isInteger(n) && n >= 0);
  if (path.length && idx.length !== path.length) throw new Error('A tree path is a list of whole numbers.');
  const rec = "tostring(i) .. '|' .. tostring(o.amount(c)) .. '|' .. tostring(o.number(c) or '') .. '|' .. tostring(o.class(c)) .. '|' .. tostring(o.name(c)):gsub('[|]', '/')";
  if (!idx.length) {
    return [
      'local o = gma.show.getobj',
      "local r = {'total=0'}",
      'for i = 1, 30 do',
      "  local c = o.handle('Root ' .. i)",
      `  if c then r[#r + 1] = ${rec} end`,
      'end',
      "r[1] = 'total=' .. (#r - 1)",
      `return table.concat(r, '${SEP}')`,
      '',
    ].join('\n');
  }
  const [root, ...rest] = idx;
  return [
    'local o = gma.show.getobj',
    `local h = o.handle('Root ${root}')`,
    `if not h then return 'total=0' end`,
    `for _, i in ipairs({${rest.join(', ')}}) do h = o.child(h, i); if not h then return 'total=0' end end`,
    'local n = o.amount(h)',
    "local r = {'total=' .. n}",
    `for i = 0, math.min(n, ${cap}) - 1 do`,
    '  local c = o.child(h, i)',
    `  if c then r[#r + 1] = ${rec} end`,
    'end',
    `return table.concat(r, '${SEP}')`,
    '',
  ].join('\n');
}

function parseMa2Tree(returns) {
  const parts = unquote((returns && returns[0]) || '').split(SEP);
  const total = Number((/^total=(\d+)$/.exec(parts[0]) || [])[1]) || 0;
  const items = [];
  for (const rec of parts.slice(1)) {
    const m = /^(\d+)\|(\d+)\|([^|]*)\|([^|]*)\|([\s\S]*)$/.exec(rec);
    if (m) items.push({ index: Number(m[1]), amount: Number(m[2]), number: m[3], cls: m[4].replace(/^CMD_/, ''), name: m[5] });
  }
  return { total, items };
}

// `Root 3.2.1` from the numbers along a path, or null when a number is blank.
function ma2Address(numbers) {
  return numbers.length && numbers.every((n) => /^\d+$/.test(String(n))) ? `Root ${numbers.join('.')}` : null;
}

const KINDS = [
  ['Group', 'Groups'],
  ['Sequence', 'Sequences'],
  ['Macro', 'Macros'],
  ['Layout', 'Layouts'],
  ['Plugin', 'Plugins'],
  ['Effect', 'Effects'],
];
const SHOW_CAP = 300;

// Pool numbers and labels per kind, in the same `Kind|no|name` records the grandMA3 show cache uses.
// A pool is found from any object in it (`Group 1`...`Group 30` -> parent) or, for a pool with nothing
// at those numbers, as the root object called by the plural name.
function ma2ShowLua() {
  const kinds = KINDS.map(([k, p]) => `{'${k}', '${p}'}`).join(', ');
  return [
    'local o = gma.show.getobj',
    'local r = {}',
    'local function poolFor(kind, plural)',
    '  for n = 1, 30 do local h = o.handle(kind .. " " .. n); if h then return o.parent(h) end end',
    '  for n = 1, 30 do',
    '    local h = o.handle("Root " .. n)',
    '    if h and o.name(h) == plural then',
    // The macros root holds its pool one level down ("Macros" > "Global"); the others hold slots directly.
    '      local c = o.child(h, 0)',
    '      if c and tostring(o.class(c)):match("POOL$") then return c end',
    '      return h',
    '    end',
    '  end',
    'end',
    `for _, k in ipairs({${kinds}}) do`,
    '  local pool = poolFor(k[1], k[2])',
    '  if pool then',
    `    for i = 0, math.min(o.amount(pool), ${SHOW_CAP}) - 1 do`,
    '      local c = o.child(pool, i)',
    '      local no = c and tonumber(o.number(c))',
    "      if no then r[#r + 1] = k[1] .. '|' .. no .. '|' .. tostring(o.label(c) or o.name(c)) end",
    '    end',
    '  end',
    'end',
    `return table.concat(r, '${SEP}')`,
    '',
  ].join('\n');
}

module.exports = { ma2TreeLua, parseMa2Tree, ma2Address, ma2ShowLua, KINDS, PAGE };
