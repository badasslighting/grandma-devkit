'use strict';
const { unquote } = require('./objectTree');

// Completion after a literal object path such as `Root().ShowData.DataPools[1].`: the console is asked
// for the children and properties of the object that path reaches. Only chains that start at Root() are
// followed, because anything else would need the extension to run the user's code.
const NAME = /^[A-Za-z_]\w*$/;
const SPLIT = ' @@ ';

// -> {segments, partial} when the text before the cursor ends in `Root()<chain>.<partial>`.
function pathContext(before) {
  const m = /\bRoot\(\)((?:\.[A-Za-z_]\w*|\[\d+\]|\["[^"\n]*"\])*)\.([A-Za-z_]\w*)?$/.exec(before);
  if (!m) return null;
  const segments = [...m[1].matchAll(/\.([A-Za-z_]\w*)|\[(\d+)\]|\["([^"\n]*)"\]/g)].map((s) => (s[2] !== undefined ? Number(s[2]) : s[1] !== undefined ? s[1] : s[3]));
  return { segments, partial: m[2] || '' };
}

// Lua that walks the segments from Root() and lists that object's children and property names.
function childrenLua(segments, cap = 2000) {
  const parts = segments.map((s) => {
    if (typeof s === 'number') return String(s);
    if (!/^[\w ]+$/.test(s)) throw new Error(`Unsupported path segment: ${s}`);
    return `"${s}"`;
  });
  return [
    'local o = Root()',
    `for _, s in ipairs({${parts.join(', ')}}) do o = o[s]; if o == nil then return "" end end`,
    'local kids, props = {}, {}',
    `for i = 1, math.min(o:Count(), ${cap}) do local c = o[i]; if c then kids[#kids + 1] = tostring(c.name) end end`,
    'for i = 0, o:PropertyCount() - 1 do props[#props + 1] = tostring(o:PropertyName(i)) end',
    `return table.concat(kids, ",") .. "${SPLIT}" .. table.concat(props, ",")`,
    '',
  ].join('\n');
}

// Only names usable as `.Name` are offered; a child called "Default Pool" would need ["..."] syntax.
function parseChildren(returns) {
  const text = unquote((returns && returns[0]) || '');
  const [k = '', p = ''] = text.split(SPLIT);
  const list = (s) => [...new Set(s.split(',').filter((n) => NAME.test(n)))];
  return { children: list(k), properties: list(p) };
}

module.exports = { pathContext, childrenLua, parseChildren };
