'use strict';
const { fileRefs, normalizeKind, KINDS } = require('./objectUsages');

// Show objects for completion when no console is connected: the numbers a project's own Lua and macro files already
// use (`Go+ Macro 12`, `Call Preset 2.5`, ranges up to 40 numbers) and the names it gives them (`Label Macro 12 "Intro"`;
// inside a Lua string the quotes arrive escaped, `\"Intro\"`).
// -> {Kind: [{no, name}]} sorted by number, the same shape the live show cache has, so showSuggestions reads it as is.
const MAX_RANGE = 40;
const LABEL = new RegExp(String.raw`\bLabel\s+(${KINDS.join('|')})s?\s+(\d+(?:\.\d+)?)\s+\\?"([^"\\\n]*)\\?"`, 'gi');

const order = (a, b) => {
  const x = String(a.no).split('.').map(Number);
  const y = String(b.no).split('.').map(Number);
  return x[0] - y[0] || (x[1] || 0) - (y[1] || 0);
};

function workspaceShow(files) {
  const found = new Map(); // `Kind|no` -> name
  const add = (kind, no, name) => {
    const k = `${kind}|${no}`;
    if (!found.has(k) || (name && !found.get(k))) found.set(k, name || '');
  };
  for (const f of files) {
    for (const r of fileRefs(f.text, f.file, f.target)) {
      if (r.range && !String(r.range.from).includes('.')) {
        const a = Number(r.range.from);
        const b = Number(r.range.to);
        if (Math.abs(b - a) < MAX_RANGE) for (let n = Math.min(a, b); n <= Math.max(a, b); n++) add(r.kind, String(n), '');
      } else if (!r.range) add(r.kind, r.no, '');
    }
    for (const m of f.text.matchAll(LABEL)) {
      const kind = normalizeKind(m[1]);
      if (kind) add(kind, String(m[2]).split('.').map((p) => String(+p)).join('.'), m[3]);
    }
  }
  const show = {};
  for (const [k, name] of found) {
    const [kind, no] = k.split('|');
    (show[kind] = show[kind] || []).push({ no, name });
  }
  for (const kind of Object.keys(show)) show[kind].sort(order);
  return show;
}

module.exports = { workspaceShow };
