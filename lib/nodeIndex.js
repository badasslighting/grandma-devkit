'use strict';

// Per-object extras from the bundled grandMA3 tree: verified command-line forms and creation commands,
// both keyed by the object's absolute Lua expression (Root()[9][3]), plus a flat list for searching.
const INDEX = require('../data/object-trees/ma3_index.json');
const TREE = require('../data/object-trees/ma3_tree.json');

const forms = (lua) => (INDEX[lua] ? INDEX[lua].kw : []);
const creates = (lua) => (INDEX[lua] ? INDEX[lua].create : []);

// Markdown lines listing the command-line forms (with manual links, or "undocumented") and the creation commands.
function nodeMarkdown(lua) {
  const out = [];
  const kw = forms(lua);
  if (kw.length) {
    out.push('**Command line**');
    for (const k of kw) out.push(`- \`${k.form}\` ${k.documented ? `([manual](${k.source}))` : '_undocumented_'}`);
  }
  const cr = creates(lua);
  if (cr.length) {
    out.push('**Create one**');
    for (const c of cr) for (const cmd of c.commands) out.push(`- \`${cmd}\``);
  }
  return out.join('\n');
}

// Every node of the bundled tree as {label, cls, lua, addr, forms}, for the search box.
let FLAT = null;
function flatNodes() {
  if (FLAT) return FLAT;
  FLAT = [];
  const walk = (nodes, trail) => {
    for (const n of nodes) {
      const name = n.n || n.c;
      FLAT.push({ label: name, cls: n.c, lua: n.l, addr: n.a || '', trail: trail.join('/'), forms: forms(n.l).map((k) => k.form), creates: creates(n.l).flatMap((c) => c.commands) });
      if (n.k) walk(n.k, trail.concat(name));
    }
  };
  walk(TREE, []);
  return FLAT;
}

// The nodes whose class, name, Lua path, address or command forms contain every word of `query`.
function searchNodes(query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return flatNodes().filter((n) => {
    const hay = `${n.label} ${n.cls} ${n.lua} ${n.addr} ${n.forms.join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

module.exports = { forms, creates, nodeMarkdown, flatNodes, searchNodes };
