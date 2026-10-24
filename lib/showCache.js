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
    '    if n > cap then break end',
    "    r[#r + 1] = kind .. '|' .. prefix .. tostring(c.no) .. '|' .. tostring(c.name)",
    '  end',
    'end',
    adds,
    'if d.PresetPools then',
    "  for _, t in ipairs(d.PresetPools:Children()) do add('Preset', t, tostring(t.no) .. '.', 200) end",
    'end',
    `return table.concat(r, '${SEP}')`,
    '',
  ].join('\n');
}

// -> { Group: [{no, name}], ... }
function parseShow(returns) {
  const text = unquote((returns && returns[0]) || '');
  const out = {};
  if (!text) return out;
  for (const rec of text.split(SEP)) {
    const m = /^([A-Za-z]+)\|([^|]*)\|([\s\S]*)$/.exec(rec);
    if (m) (out[m[1]] = out[m[1]] || []).push({ no: m[2], name: m[3] });
  }
  return out;
}

// Completion entries for the keyword just typed, e.g. text "Store Group " -> every group.
function showSuggestions(text, show) {
  if (!show) return [];
  const words = text.split(/\s+/);
  const prev = words.length > 1 ? words[words.length - 2].toLowerCase() : '';
  const kind = Object.keys(show).find((k) => k.toLowerCase() === prev);
  return kind ? show[kind].map((o) => ({ kind, no: o.no, name: o.name })) : [];
}

module.exports = { POOLS, showLua, parseShow, showSuggestions };
