'use strict';
const { MA2_SYSTEM_VARS, keyOf } = require('./variables');

// The variable bank: what the files being worked on use, ranked, the stock variables each console has, and the
// user's own list of variables to keep at hand (favorites). Pure data code; the view and commands live in varFeatures.js.

const NAME = /^[A-Za-z_]\w*$/;

// Every variable the scanned files mention, most used first.
// entries: [{file, scan: {target, occ}}] -> [{name, target, key, uses, sets, total, files, scopes, value}]
//  uses = reads ($name in a command, GetVar, getvar), sets = definitions and removals, files = how many files hold it.
function usageStats(entries, target) {
  const map = new Map();
  for (const e of entries) {
    const t = e.scan.target;
    if (!t || (target && t !== target)) continue;
    for (const o of e.scan.occ) {
      if (o.kind === 'qref') continue;
      const key = `${t}:${keyOf(o.name, t)}`;
      let s = map.get(key);
      if (!s) map.set(key, (s = { name: o.name, target: t, key, uses: 0, sets: 0, files: new Set(), scopes: new Set(), spellings: new Map(), value: undefined }));
      if (o.kind === 'ref' || o.kind === 'get') s.uses++;
      else s.sets++;
      s.files.add(e.file);
      s.spellings.set(o.name, (s.spellings.get(o.name) || 0) + 1);
      if (o.kind === 'def' && (o.scope === 'user' || o.scope === 'global')) s.scopes.add(o.scope);
      if (o.kind === 'def' && o.valueText) {
        const v = String(o.valueText).trim().replace(/^\\?"|\\?"$/g, '');
        if (v) s.value = v;
      }
    }
  }
  return [...map.values()]
    .map((s) => ({
      name: [...s.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0], // the spelling used most
      target: s.target,
      key: s.key,
      uses: s.uses,
      sets: s.sets,
      total: s.uses + s.sets,
      files: s.files.size,
      scopes: [...s.scopes],
      value: s.value,
    }))
    .sort((a, b) => b.total - a.total || b.files - a.files || a.name.localeCompare(b.name));
}

// What each console has built in. grandMA2 lists 26 through ListVar on onPC 3.9.61.1; grandMA3 has none that a
// command line or GetVar resolves (18 names checked).
function stockVars(target) {
  if (target !== 'ma2') return [];
  return Object.entries(MA2_SYSTEM_VARS).map(([name, doc]) => ({ name, doc, target: 'ma2', scope: 'system' }));
}

// ---- favorites: [{name, target, scope, value, note}] -------------------------------------------------------------

function normalizeFavorite(f) {
  const name = String((f && f.name) || '').replace(/^\$/, '').trim();
  if (!NAME.test(name)) throw new Error(`"${name}" is not a variable name (letters, digits and _, not starting with a digit).`);
  const target = f.target === 'ma3' ? 'ma3' : 'ma2';
  const scope = f.scope === 'user' ? 'user' : 'global';
  const value = f.value === undefined || f.value === null ? '' : String(f.value);
  return { name, target, scope, value, note: String(f.note || '').trim() };
}
const sameFavorite = (a, b) => a.target === b.target && a.scope === b.scope && keyOf(a.name, a.target) === keyOf(b.name, b.target);

// The list with `fav` added, or updated when the same console, scope and name is already there.
function addFavorite(list, fav) {
  const f = normalizeFavorite(fav);
  const out = list.filter((x) => !sameFavorite(x, f));
  out.push(f);
  return out.sort((a, b) => a.target.localeCompare(b.target) || a.name.localeCompare(b.name));
}
const removeFavorite = (list, fav) => list.filter((x) => !sameFavorite(x, normalizeFavorite(fav)));
const isFavorite = (list, name, target) => list.some((x) => x.target === target && keyOf(x.name, target) === keyOf(name, target));

const FORMAT = 'grandma-devkit-variables';
function exportFavorites(list) {
  return `${JSON.stringify({ format: FORMAT, version: 1, variables: list }, null, 2)}\n`;
}
// -> {list, skipped: [string]}; entries that are not valid variables are skipped with the reason.
function importFavorites(text, existing = []) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not a JSON file: ${e.message}`);
  }
  if (!data || data.format !== FORMAT || !Array.isArray(data.variables)) throw new Error('This is not a grandMA Devkit variable list.');
  let list = existing.slice();
  const skipped = [];
  for (const v of data.variables) {
    try {
      list = addFavorite(list, v);
    } catch (e) {
      skipped.push(e.message);
    }
  }
  return { list, skipped };
}

// How a ranked variable reads in a list: `12 uses, 3 sets, 4 files`.
const describeUsage = (s) => `${s.uses} use${s.uses === 1 ? '' : 's'}, ${s.sets} set${s.sets === 1 ? '' : 's'}, ${s.files} file${s.files === 1 ? '' : 's'}`;

module.exports = { usageStats, stockVars, normalizeFavorite, addFavorite, removeFavorite, isFavorite, exportFavorites, importFavorites, describeUsage, FORMAT };
