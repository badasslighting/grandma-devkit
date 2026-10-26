'use strict';

// Browsing the console's object tree through the LuaBridge. Objects are addressed by their index path
// from Root() (e.g. [14, 14] is ShowData.DataPools); Addr() gives the same path as "14.14".
const PAGE = 500;
const SEP = ' ;; ';

// Lua that lists up to PAGE children of the object at `path`, starting at child `from`.
// Returns "total=<n>" followed by `index|childCount|addr|class|name` records, joined with SEP.
function listLua(path, from = 1, page = PAGE) {
  const idx = path.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
  return [
    'local h = Root()',
    `for _, i in ipairs({${idx.join(', ')}}) do h = h[i]; if not h then return 'total=0' end end`,
    'local n = h:Count()',
    "local r = {'total=' .. n}",
    `for i = ${Math.max(1, Number(from) | 0)}, math.min(n, ${Math.max(1, Number(from) | 0) + page - 1}) do`,
    '  local c = h[i]',
    "  if c then r[#r + 1] = i .. '|' .. c:Count() .. '|' .. c:Addr() .. '|' .. tostring(c:GetClass()) .. '|' .. tostring(c.name) end",
    'end',
    `return table.concat(r, '${SEP}')`,
    '',
  ].join('\n');
}

// A bridge return value is a Lua %q-quoted string; undo the quoting.
function unquote(q) {
  const s = String(q);
  if (s[0] !== '"' || s[s.length - 1] !== '"') return s;
  return s
    .slice(1, -1)
    .replace(/\\\n/g, '\n')
    .replace(/\\(["\\])/g, '$1');
}

function parseList(returns) {
  const text = unquote((returns && returns[0]) || '');
  const parts = text.split(SEP);
  const total = Number((/^total=(\d+)$/.exec(parts[0]) || [])[1]) || 0;
  const items = [];
  for (const rec of parts.slice(1)) {
    const m = /^(\d+)\|(\d+)\|([^|]*)\|([^|]*)\|([\s\S]*)$/.exec(rec);
    if (m) items.push({ index: Number(m[1]), count: Number(m[2]), addr: m[3], cls: m[4], name: m[5] });
  }
  return { total, items };
}

module.exports = { PAGE, listLua, parseList, unquote };
