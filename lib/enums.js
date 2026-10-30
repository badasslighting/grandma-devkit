'use strict';
const DATA = require('../data/props.json');

// Offline `Enums.*` names and members for grandMA3, from the enum tables bundled in data/props.json
// (grandMA3 onPC 2.5.1.0). The live console wins whenever it answers (lib/liveNames.js); this is the
// fallback when the bridge is not running or ma3.liveCompletion is off.
//
// The bundle records each enum as the spellings a property accepts, so it is narrowed to what can be
// written as `Enums.Name.Member`: identifier names that are not Lua keywords, one member per value (the
// first spelling that is an identifier, which skips the numeric alias), and the `Enums` collection itself
// is left out because it is a property enum, not a member of the global table.
const IDENT = /^[A-Za-z_]\w*$/;
const LUA_KEYWORDS = new Set('and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' '));
const usable = (s) => IDENT.test(s) && !LUA_KEYWORDS.has(s);

let TABLE = null;
// name -> [{name, value}] sorted by member name, like the live query.
function table() {
  if (TABLE) return TABLE;
  TABLE = new Map();
  for (const [name, rows] of Object.entries(DATA.ma3.enums)) {
    if (name === 'Enums' || !usable(name)) continue;
    const members = [];
    for (const [value, spellings] of rows) {
      const m = spellings.find(usable);
      if (m) members.push({ name: m, value });
    }
    if (members.length) TABLE.set(name, members.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
  }
  return TABLE;
}

const staticEnumNames = () => [...table().keys()].sort();
const staticEnumMembers = (name) => table().get(name) || [];

// Live answers win; an empty live answer (bridge off, liveCompletion off, unknown enum) falls back to the bundle.
const enumNames = (live) => (live && live.length ? live : staticEnumNames());
const enumMembers = (name, live) => (live && live.length ? live : staticEnumMembers(name));

// The `Enums.Name` or `Enums.Name.Member` token under column `col` of a line, for hover.
function enumAt(line, col) {
  for (const m of line.matchAll(/\bEnums\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/g)) {
    const end = m.index + m[0].length;
    if (col < m.index + 'Enums.'.length || col > end) continue;
    const memberStart = m[2] === undefined ? -1 : end - m[2].length;
    if (m[2] !== undefined && col >= memberStart) return { name: m[1], member: m[2], start: memberStart, end };
    return { name: m[1], member: '', start: m.index + 'Enums.'.length, end: m.index + 'Enums.'.length + m[1].length };
  }
  return null;
}

// Markdown for an enum or one of its members from the bundle, or null when it is not a known name.
function enumHoverMarkdown(name, member, cap = 40) {
  const members = staticEnumMembers(name);
  if (!members.length) return null;
  if (member) {
    const hit = members.find((m) => m.name === member);
    return hit ? `**Enums.${name}.${member}** = ${hit.value}\n\n_grandMA3 2.5.1 enum, bundled._` : null;
  }
  const shown = members.slice(0, cap).map((m) => `${m.name} (${m.value})`);
  const more = members.length > cap ? `, and ${members.length - cap} more` : '';
  return `**Enums.${name}**, ${members.length} member${members.length === 1 ? '' : 's'}\n\n${shown.join(', ')}${more}\n\n_grandMA3 2.5.1 enum, bundled._`;
}

module.exports = { staticEnumNames, staticEnumMembers, enumNames, enumMembers, enumAt, enumHoverMarkdown };
