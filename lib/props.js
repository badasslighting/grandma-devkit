'use strict';
const DATA = require('../data/props.json');
const { unquote } = require('./objectTree');

// Property names, types and enum values for the console object tree, captured from grandMA3 onPC 2.5.1
// and grandMA2 onPC 3.9. Used offline for completion and hover; the live bridge narrows it to one class.
const MA3 = DATA.ma3;
const MA2 = DATA.ma2;
const toProp = ([name, type, ro, en]) => ({ name, type, readOnly: !!ro, enumName: en || '' });
const COMMON = MA3.common.map(toProp);
const COMMON_NAMES = new Set(COMMON.map((p) => p.name));
const SPLIT = ' @@ ';

function ma3Props(cls) {
  const own = (MA3.classes[cls] || []).map(toProp);
  const seen = new Set(own.map((p) => p.name));
  return own.concat(COMMON.filter((p) => !seen.has(p.name)));
}

let UNION = null;
// Every property name in the tree: name -> {name, type, readOnly, enumName, classes}.
function ma3Union() {
  if (UNION) return UNION;
  UNION = new Map();
  const total = Object.keys(MA3.classes).length;
  for (const p of COMMON) UNION.set(p.name, { ...p, classes: total });
  for (const props of Object.values(MA3.classes)) {
    for (const row of props) {
      const hit = UNION.get(row[0]);
      if (!hit) UNION.set(row[0], { ...toProp(row), classes: 1 });
      else if (!COMMON_NAMES.has(row[0])) hit.classes++;
    }
  }
  return UNION;
}

// [{value, name}] for one enum collection, as the console names it in PropertyInfo().EnumCollection.
// A value with several accepted spellings (0 is false, off, 0 and No) gives one entry per spelling.
function enumValues(enumName) {
  const out = [];
  for (const [value, names] of MA3.enums[enumName] || []) for (const name of names) out.push({ value, name });
  return out;
}

function ma2Props(cls) {
  return (MA2.classes[cls] || []).map(([name, type, values]) => ({ name, type, values }));
}

// Markdown table of one property list, for hovers and tooltips.
function propsMarkdown(cls, props, cap = 60) {
  const rows = props.slice(0, cap).map((p) => `| ${p.name} | ${p.type}${p.readOnly ? ' (read-only)' : ''} | ${p.enumName || (p.values && p.values.join(', ')) || ''} |`);
  const more = props.length > cap ? `\n\n_${props.length - cap} more not shown._` : '';
  return `**${cls}**, ${props.length} propert${props.length === 1 ? 'y' : 'ies'}\n\n| Property | Type | Values |\n|---|---|---|\n${rows.join('\n')}${more}`;
}

const SETTERS = '(?:Set|SetChildren|SetChildrenRecursive)';
const ACCESSORS = '(?:Get|Set|SetChildren|SetChildrenRecursive)';
const RECV = '(?:Root\\(\\)((?:\\.[A-Za-z_]\\w*|\\[\\d+\\]|\\["[^"\\n]*"\\])*):)?';

function segmentsOf(chain) {
  if (chain === undefined) return null;
  return [...chain.matchAll(/\.([A-Za-z_]\w*)|\[(\d+)\]|\["([^"\n]*)"\]/g)].map((s) => (s[2] !== undefined ? Number(s[2]) : s[1] !== undefined ? s[1] : s[3]));
}

// Is a property name being typed: `obj:Get("Na`, `Set(h, "Na`? -> {kind: 'name', partial, segments}
// Is a property's value being typed: `obj:Set("Lock", "Y`? -> {kind: 'value', prop, partial, segments}
// segments is the literal Root() path of the receiver, or null when the receiver is anything else.
function propContext(before) {
  const value = new RegExp(`${RECV}\\b${SETTERS}\\(\\s*(?:[^"'(),]+,\\s*)?(["'])(\\w+)\\2\\s*,\\s*(["'])([^"']*)$`).exec(before);
  if (value) return { kind: 'value', prop: value[3], partial: value[5], segments: segmentsOf(value[1]) };
  const name = new RegExp(`${RECV}\\b${ACCESSORS}\\(\\s*(?:[^"'(),]+,\\s*)?(["'])(\\w*)$`).exec(before);
  if (name) return { kind: 'name', partial: name[3], segments: segmentsOf(name[1]) };
  return null;
}

// The property name under column `col` in `Get("Name")` / `Set("Name", ...)`, or null.
function propAt(line, col) {
  const re = new RegExp(`\\b${ACCESSORS}\\(\\s*(?:[^"'(),]+,\\s*)?(["'])(\\w+)\\1`, 'g');
  let m;
  while ((m = re.exec(line))) {
    const start = m.index + m[0].lastIndexOf(m[2]);
    const end = start + m[2].length;
    if (col >= start && col <= end) return { name: m[2], start, end };
  }
  return null;
}

// Candidates for a property name: the class's own when known, else every name in the tree.
function nameCandidates(cls) {
  if (cls && MA3.classes[cls]) return ma3Props(cls).map((p) => ({ ...p, classes: 1 }));
  return [...ma3Union().values()];
}

// Enum values to offer for `prop`: from the class when known, else from every enum the name maps to.
function valueCandidates(prop, cls) {
  const names = new Set();
  if (cls && MA3.classes[cls]) {
    const p = ma3Props(cls).find((x) => x.name === prop);
    if (p && p.enumName) names.add(p.enumName);
  } else {
    for (const props of [MA3.common, ...Object.values(MA3.classes)]) for (const p of props) if (p[0] === prop && p[3]) names.add(p[3]);
  }
  const out = [];
  const seen = new Set();
  for (const n of names) {
    for (const v of enumValues(n)) {
      if (!seen.has(v.name)) {
        seen.add(v.name);
        out.push({ ...v, enumName: n });
      }
    }
  }
  return out;
}

// Class of the object a literal Root() path reaches, asked of the console.
function pathClassLua(segs) {
  const parts = segs.map((s) => {
    if (typeof s === 'number') return String(s);
    if (!/^[\w ]+$/.test(s)) throw new Error(`Unsupported path segment: ${s}`);
    return `"${s}"`;
  });
  return ['local o = Root()', `for _, s in ipairs({${parts.join(', ')}}) do o = o[s]; if o == nil then return "" end end`, 'return tostring(o:GetClass())', ''].join('\n');
}
const parseClass = (returns) => unquote((returns && returns[0]) || '');

// name, type, read-only flag, enum collection and current value of every property of the object at `path`.
function propValuesLua(path) {
  const idx = path.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return [
    'local o = Root()',
    `for _, i in ipairs({${idx.join(', ')}}) do o = o[i]; if o == nil then return "" end end`,
    'local r = {}',
    'for i = 0, o:PropertyCount() - 1 do',
    '  local n = o:PropertyName(i)',
    '  local info = o:PropertyInfo(i) or {}',
    '  local ok, v = pcall(function() return o:Get(n, Enums.Roles.Display) end)',
    "  r[#r + 1] = table.concat({n, tostring(o:PropertyType(i)), tostring(info.ReadOnly and 1 or 0), tostring(info.EnumCollection or ''), ok and tostring(v) or ''}, '\\t')",
    'end',
    `return tostring(o:GetClass()) .. "${SPLIT}" .. table.concat(r, "\\n")`,
    '',
  ].join('\n');
}

function parsePropValues(returns) {
  const text = unquote((returns && returns[0]) || '');
  const [cls = '', body = ''] = text.split(SPLIT);
  const props = body
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name, type, ro, enumName, value = ''] = l.split('\t');
      return { name, type, readOnly: ro === '1', enumName, value };
    });
  return { cls, props };
}

module.exports = { ma3Props, ma3Union, ma2Props, enumValues, propsMarkdown, propContext, propAt, nameCandidates, valueCandidates, pathClassLua, parseClass, propValuesLua, parsePropValues };
