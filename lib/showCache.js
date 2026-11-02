'use strict';
const { unquote } = require('./objectTree');

// Names and numbers of the objects in the running show's default data pool, fetched through the
// LuaBridge so Cmd("...") strings can complete `Group 3` or `Sequence 12` with the real labels.
const SEP = ' ;; ';
const POOLS = [
  ['Group', 'Groups'],
  ['Sequence', 'Sequences'],
  ['Macro', 'Macros'],
  ['Plugin', 'Plugins'],
  ['Layout', 'Layouts'],
  ['World', 'Worlds'],
  ['Filter', 'Filters'],
  ['Timer', 'Timers'],
  ['Timecode', 'Timecodes'],
];
const CAP = 300; // per pool; the console does the walk on its UI thread
const PRESET_CAP = 200; // per preset pool

function showLua() {
  const adds = POOLS.map(([kind, pool]) => `add('${kind}', d.${pool}, '', ${CAP})`).join('\n');
  return [
    'local d = Root().ShowData.DataPools[1]',
    'if not d then return "" end',
    'local r = {}',
    'local function add(kind, pool, prefix, cap)',
    '  if not pool then return end',
    '  local n = 0',
    '  for _, c in ipairs(pool:Children()) do',
    '    n = n + 1',
    // a `Kind|<prefix>*|` record marks a pool cut off at the cap
    "    if n > cap then r[#r + 1] = kind .. '|' .. prefix .. '*|'; break end",
    "    r[#r + 1] = kind .. '|' .. prefix .. tostring(c.no) .. '|' .. tostring(c.name)",
    '  end',
    'end',
    adds,
    'if d.PresetPools then',
    `  for _, t in ipairs(d.PresetPools:Children()) do add('Preset', t, tostring(t.no) .. '.', ${PRESET_CAP}) end`,
    'end',
    `return table.concat(r, '${SEP}')`,
    '',
  ].join('\n');
}

// -> { Group: [{no, name}], ... }, with a non-enumerable `truncated` list of the kinds whose pool the walk cut off
// at its cap (a `Kind|*|` record, or a pool that reached the cap), so the shape stays { Kind: [...] }.
function parseShow(returns) {
  const text = unquote((returns && returns[0]) || '');
  const out = {};
  const cut = new Set();
  if (text) {
    for (const rec of text.split(SEP)) {
      const m = /^([A-Za-z]+)\|([^|]*)\|([\s\S]*)$/.exec(rec);
      if (!m) continue;
      if (m[2].endsWith('*')) cut.add(m[1]);
      else (out[m[1]] = out[m[1]] || []).push({ no: m[2], name: m[3] });
    }
  }
  Object.defineProperty(out, 'truncated', { value: [...cut], enumerable: false });
  return out;
}

// True when the cached list for a kind may be missing objects: marked cut off, or as long as the cap allows
// (a Preset pool type with PRESET_CAP entries). Show data built without parseShow is judged by the counts alone.
function isTruncated(show, kind) {
  if (!show) return true;
  if ((show.truncated || []).includes(kind)) return true;
  const list = show[kind] || [];
  if (list.length >= CAP) return true;
  if (kind !== 'Preset') return false;
  const perType = {};
  for (const o of list) {
    const type = String(o.no).split('.')[0];
    if ((perType[type] = (perType[type] || 0) + 1) >= PRESET_CAP) return true;
  }
  return false;
}

// Completion entries for the keyword just typed, e.g. text "Store Group " -> every group.
function showSuggestions(text, show) {
  if (!show) return [];
  const words = text.split(/\s+/);
  const prev = words.length > 1 ? words[words.length - 2].toLowerCase() : '';
  const kind = Object.keys(show).find((k) => k.toLowerCase() === prev);
  return kind ? show[kind].map((o) => ({ kind, no: o.no, name: o.name })) : [];
}

module.exports = { POOLS, CAP, PRESET_CAP, showLua, parseShow, isTruncated, showSuggestions };
