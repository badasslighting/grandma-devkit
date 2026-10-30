'use strict';
const { maskCode } = require('./mask');
const API = require('../data/api.json');

// Which console a plugin is written for: 'ma2' or 'ma3'. Pure: every input is passed in.
//
// Signals, strongest first. The first one that says anything decides, so a weaker signal can never
// overrule a stronger one:
//   1. the `ma3.target` setting ('ma2' or 'ma3'; 'auto' means "look at the rest")
//   2. the plugin manifest: a grandMA2 one (<MA ...>) or a grandMA3 one (<GMA3 ...>)
//   3. the folder: the nearest directory of `filePath` whose name carries a console hint, such as
//      grandMA2 / gma2 / MA2 or grandMA3 / gma3 / MA3 (a whole word, case-insensitive: "ma2-ctc" counts,
//      "gma2x" does not). A directory naming both ("ma2-to-ma3") says nothing and the search goes on outward.
//   4. API names in the code (comments and strings ignored). `gma.*` is the grandMA2 API. grandMA3 has
//      global functions such as Printf( and Cmd(. Names that exist on both sides count for neither: a
//      global that is also an object method (ToAddr, Export, ...), or one the file defines itself.
//      Object methods (:Get(, :Count(, ...) are not counted at all, they are too common in plain Lua.
//      Each distinct name counts once; the larger side wins and a tie goes to grandMA2, because
//      before the extra signals existed any `gma.` call made a file grandMA2.
//   5. otherwise grandMA3.
// `manifestXml` is the text of the plugin's manifest when the caller has found one; `filePath` is the
// path of the Lua file when it has one.

const MA3_GLOBALS = (() => {
  const objects = new Set(API.object.map((f) => f.name));
  return new Set(API.global.map((f) => f.name).filter((n) => !objects.has(n)));
})();

function fromManifest(xml) {
  if (!xml) return null;
  if (/<GMA3\b/.test(xml)) return 'ma3';
  if (/<MA\b/.test(xml)) return 'ma2';
  return null;
}

const HINT = /(?:^|[^a-z0-9])(grandma2|gma2|ma2|grandma3|gma3|ma3)(?![a-z0-9])/gi;

function fromFolder(filePath) {
  if (!filePath) return null;
  const dirs = String(filePath).split(/[\\/]+/).slice(0, -1);
  for (let i = dirs.length - 1; i >= 0; i--) {
    const found = new Set();
    for (const m of dirs[i].matchAll(HINT)) found.add(m[1].endsWith('2') ? 'ma2' : 'ma3');
    if (found.size === 1) return [...found][0];
  }
  return null;
}

function fromApiNames(luaText) {
  const code = maskCode(luaText || '');
  const ma2 = new Set();
  for (const m of code.matchAll(/(?<![\w.:])gma\s*\.\s*([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)/g)) ma2.add(m[1].replace(/\s+/g, ''));
  const defined = new Set();
  for (const m of code.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(|\b([A-Za-z_]\w*)\s*=\s*function\b/g)) defined.add(m[1] || m[2]);
  const ma3 = new Set();
  for (const m of code.matchAll(/(?<![\w.:])([A-Za-z_]\w*)\s*\(/g)) {
    if (MA3_GLOBALS.has(m[1]) && !defined.has(m[1])) ma3.add(m[1]);
  }
  if (!ma2.size && !ma3.size) return null;
  return ma2.size >= ma3.size ? 'ma2' : 'ma3';
}

function detectTarget(luaText, setting = 'auto', manifestXml = '', filePath = '') {
  if (setting === 'ma2' || setting === 'ma3') return setting;
  return fromManifest(manifestXml) || fromFolder(filePath) || fromApiNames(luaText) || 'ma3';
}

module.exports = { detectTarget, fromManifest, fromFolder, fromApiNames };
