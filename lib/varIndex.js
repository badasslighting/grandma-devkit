'use strict';
const { commandStrings, checkCommand } = require('./conditions');
const { scanCommand, scanLua, flattenCommand, keyOf } = require('./variables');
const { commandSegments, toRaw, encodeFor } = require('./macroFiles');

// One file's variable occurrences, found the way its type reads commands:
//  - Lua: the variable API calls and the `$name` words in Cmd()/gma.cmd() strings;
//  - macro files (.gma2macro, .gma3macro, exported XML): every macro line.
// -> {kind: 'lua'|'text'|'xml', target, occ, issues}. Occurrence offsets are absolute in the file; `issues` are the
// command-line findings of conditions.js for macro lines (a Lua file gets those from the lint rules instead).
function scanFile(text, fileName, languageId, targetHint) {
  const macro = commandSegments(text, fileName);
  if (macro.kind) {
    const occ = [];
    const issues = [];
    for (const seg of macro.segments) {
      const scan = scanCommand(seg.text, macro.target);
      for (const o of flattenCommand(scan, 0, 'macro', seg.start)) {
        const raw = toRaw(seg, o.start, o.len);
        const out = { ...o, start: raw.start, len: raw.len, segment: seg };
        if (o.valueStart !== undefined) out.valueStart = toRaw(seg, o.valueStart, 0).start;
        occ.push(out);
      }
      for (const f of checkCommand(seg.text, macro.target)) {
        const raw = toRaw(seg, f.offset, f.len);
        issues.push({ ...f, offset: raw.start, len: raw.len });
      }
    }
    return { kind: macro.kind, target: macro.target, occ: occ.sort((a, b) => a.start - b.start), issues };
  }
  if (languageId === 'lua' || /\.lua$/i.test(String(fileName))) {
    return { kind: 'lua', target: targetHint, occ: scanLua(text, targetHint, commandStrings), issues: [] };
  }
  return { kind: null, target: null, occ: [], issues: [] };
}

// Every definition in a set of scanned files, per console: Map(key -> [{name, scope, file}]).
function buildKnown(entries, target) {
  const known = new Map();
  for (const e of entries) {
    if (e.scan.target !== target && e.scan.kind !== 'lua') continue;
    if (e.scan.kind === 'lua' && e.scan.target !== target) continue;
    for (const o of e.scan.occ) {
      if (o.kind !== 'def' || o.scope === 'plugin' || o.scope === 'addon') continue;
      const k = keyOf(o.name, target);
      if (!known.has(k)) known.set(k, []);
      known.get(k).push({ name: o.name, scope: o.scope, file: e.file });
    }
  }
  return known;
}

// Occurrences of a variable across files: [{file, scan, occ}] -> flat [{file, occ}].
function findAll(entries, name, target) {
  const k = keyOf(name, target);
  const out = [];
  for (const e of entries) {
    if (e.scan.target !== target) continue;
    for (const o of e.scan.occ) if (o.kind !== 'qref' && keyOf(o.name, target) === k) out.push({ file: e.file, occ: o });
  }
  return out;
}

// Text to put at an occurrence (an XML macro line needs it escaped).
const replacementFor = (occ, newText) => (occ.segment ? encodeFor(occ.segment, newText) : newText);

// The line and column of an offset, for text that has \n line breaks.
function positionOf(text, offset) {
  let line = 0;
  let last = -1;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return { line, character: offset - last - 1 };
}

module.exports = { scanFile, buildKnown, findAll, replacementFor, positionOf };
