'use strict';
const { parseLine } = require('./helpParser');
const { unquote } = require('./objectTree');
const { FUNCTIONS } = require('./ma2Api');

// Rebuilding the API list from the running console, so no HelpLua dump has to be imported.
const REC = ' ;;; ';
const SPLIT = ' @@@@ ';

// grandMA3: GetApiDescriptor() and GetObjApiDescriptor() return {name, params, returns} rows in the same
// shape HelpLua prints, so each row becomes one `name(params): returns` line for the existing parser.
function ma3ApiLua() {
  return [
    'local function lines(d)',
    '  local r = {}',
    '  for _, f in ipairs(d) do r[#r + 1] = tostring(f[1]) .. "(" .. tostring(f[2]) .. "): " .. tostring(f[3]) end',
    `  return table.concat(r, "${REC}")`,
    'end',
    `return lines(GetApiDescriptor()) .. "${SPLIT}" .. lines(GetObjApiDescriptor())`,
    '',
  ].join('\n');
}

function parseMa3Api(returns) {
  const text = unquote((returns && returns[0]) || '');
  const [g, o = ''] = text.split(SPLIT);
  const toApi = (part) => part.split(REC).map((l) => parseLine(l)).filter(Boolean);
  return { global: toApi(g), object: toApi(o) };
}

// What changed between two API lists, by name and signature.
function diffApi(oldApi, newApi) {
  const out = { added: [], removed: [], changed: [] };
  for (const kind of ['global', 'object']) {
    const before = new Map((oldApi[kind] || []).map((f) => [f.name, f]));
    const after = new Map((newApi[kind] || []).map((f) => [f.name, f]));
    for (const [name, f] of after) {
      if (!before.has(name)) out.added.push(`${kind === 'object' ? ':' : ''}${name}`);
      else if (before.get(name).signature.replace(/\s+/g, '') !== f.signature.replace(/\s+/g, '')) out.changed.push(`${kind === 'object' ? ':' : ''}${name}`);
    }
    for (const name of before.keys()) if (!after.has(name)) out.removed.push(`${kind === 'object' ? ':' : ''}${name}`);
  }
  return out;
}

// grandMA2: walks the `gma` table and lists every function path and table path it finds.
function ma2WalkLua() {
  return [
    'local fns, tabs = {}, {}',
    'local function walk(t, p, d)',
    '  if d > 5 then return end',
    '  for k, v in pairs(t) do',
    '    local path = p .. "." .. tostring(k)',
    '    if type(v) == "table" then tabs[#tabs + 1] = path; walk(v, path, d + 1)',
    '    elseif type(v) == "function" then fns[#fns + 1] = path end',
    '  end',
    'end',
    // The bridge hands plugins a proxy that only holds its own echo/feedback wrappers; the real API sits behind __index.
    'local real, mt = gma, getmetatable(gma)',
    'if mt and type(mt.__index) == "table" then real = mt.__index end',
    'walk(real, "gma", 0)',
    'table.sort(fns); table.sort(tabs)',
    `return table.concat(fns, "${REC}") .. "${SPLIT}" .. table.concat(tabs, "${REC}")`,
    '',
  ].join('\n');
}

function parseMa2Walk(returns) {
  const text = unquote((returns && returns[0]) || '');
  const [f, t = ''] = text.split(SPLIT);
  const list = (s) => (s ? s.split(REC).filter(Boolean) : []);
  return { functions: list(f), tables: list(t) };
}

// The curated gma.* list against what the console really has: gaps in the list, and entries it lacks.
function ma2Gaps(walk, curated = FUNCTIONS) {
  const have = new Set(walk.functions);
  const mine = new Set(curated.map((f) => f.path));
  return {
    missing: walk.functions.filter((p) => !mine.has(p)),
    notOnConsole: curated.map((f) => f.path).filter((p) => !have.has(p)),
  };
}

module.exports = { ma3ApiLua, parseMa3Api, diffApi, ma2WalkLua, parseMa2Walk, ma2Gaps };
