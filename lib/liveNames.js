'use strict';
const { unquote } = require('./objectTree');

// Names the console knows that the API list does not: the `Enums` tables and the fixture attribute
// names. Fetched through the LuaBridge on demand and cached by the extension (they only change with
// the software version or the loaded fixture types).
const IDENT = /^[A-Za-z_]\w*$/;

function enumNamesLua() {
  return [
    'local r = {}',
    'for k, v in pairs(Enums) do',
    "  if type(k) == 'string' and type(v) == 'table' and k:match('^[%a_][%w_]*$') then r[#r + 1] = k end",
    'end',
    'table.sort(r)',
    "return table.concat(r, ',')",
    '',
  ].join('\n');
}

// `name=value` for each identifier-named member of one enum.
function enumMembersLua(name) {
  if (!IDENT.test(name || '')) throw new Error(`Not an enum name: ${name}`);
  return [
    `local t = Enums.${name}`,
    "if type(t) ~= 'table' then return '' end",
    'local r = {}',
    'for k, v in pairs(t) do',
    "  if type(k) == 'string' and k:match('^[%a_][%w_]*$') then r[#r + 1] = k .. '=' .. tostring(v) end",
    'end',
    'table.sort(r)',
    "return table.concat(r, ',')",
    '',
  ].join('\n');
}

function attributeNamesLua() {
  return [
    'local ok, a = pcall(function() return Root().ShowData.LivePatch.AttributeDefinitions.Attributes end)',
    "if not ok or not a then return '' end",
    'local r = {}',
    'for _, c in ipairs(a:Children()) do r[#r + 1] = tostring(c.name) end',
    "return table.concat(r, ',')",
    '',
  ].join('\n');
}

const list = (returns) => {
  const text = unquote((returns && returns[0]) || '');
  return text ? text.split(',') : [];
};
const parseNames = list;
const parseMembers = (returns) => list(returns).map((s) => {
  const i = s.indexOf('=');
  return { name: s.slice(0, i), value: s.slice(i + 1) };
});

// Is the code before the cursor naming an enum (`Enums.Ti`) or one of its members (`Enums.TimerMode.Co`)?
function enumContext(before) {
  const member = /\bEnums\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)?$/.exec(before);
  if (member) return { kind: 'members', name: member[1], partial: member[2] || '' };
  const names = /\bEnums\.([A-Za-z_]\w*)?$/.exec(before);
  return names ? { kind: 'enums', partial: names[1] || '' } : null;
}

// Is a string being typed where an attribute name belongs: `GetAttributeIndex("Di` or `Cmd("Attribute Di`?
function attributeContext(str) {
  if (!str) return false;
  if (/^(GetAttributeIndex|GetAttributeByUIChannel)$/.test(str.call)) return true;
  return str.inCmd && /\battribute\s+["']?\w*$/i.test(str.text);
}

module.exports = { enumNamesLua, enumMembersLua, attributeNamesLua, parseNames, parseMembers, enumContext, attributeContext };
