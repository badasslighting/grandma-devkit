'use strict';
const { extractRefs } = require('./showRefs');
const { commandStrings } = require('./conditions');
const { commandSegments, toRaw } = require('./macroFiles');
const { positionOf } = require('./varIndex');
const { isTruncated } = require('./showCache');

// Find Usages of Console Object: every place in the workspace that names `Macro 12`, `Preset 2.5` and so on, in Lua
// Cmd()/gma.cmd() strings and macro-file lines. The references come from showRefs.extractRefs, so the same rules
// apply: only segments whose verb uses an existing object (Go+, Call, Off, a bare `Macro 5`...) count, and a segment
// that stores, copies or labels is not a usage. A Thru range is a usage of every number inside it.

const KINDS = ['Group', 'Sequence', 'Macro', 'Plugin', 'Layout', 'World', 'Filter', 'Timer', 'Timecode', 'Preset', 'Effect'];
const ALIASES = new Map([
  ...KINDS.map((k) => [k.toLowerCase(), k]),
  ...KINDS.map((k) => [`${k.toLowerCase()}s`, k]),
  ['seq', 'Sequence'],
  ['grp', 'Group'],
]);

// 'macro', 'Macros', 'SEQ' -> 'Macro', 'Sequence'; undefined when not a pool kind.
const normalizeKind = (kind) => ALIASES.get(String(kind || '').trim().toLowerCase());

// (kind, no) or (undefined, 'Preset 2.5') -> {kind, no} with the number in canonical form ('012' -> '12'), or null.
function parseObject(kind, no) {
  let k = kind;
  let n = String(no === undefined || no === null ? '' : no).trim();
  const m = /^([A-Za-z]+)\s+(\S+)$/.exec(n);
  if (m && (!k || normalizeKind(m[1]) === normalizeKind(k))) [k, n] = [m[1], m[2]];
  k = normalizeKind(k);
  if (!k) return null;
  const parts = k === 'Preset' ? /^(\d+)\.(\d+)$/.exec(n) : /^(\d+)$/.exec(n);
  if (!parts) return null;
  return { kind: k, no: parts.slice(1).map((p) => String(+p)).join('.') };
}

// The references in one file -> [{kind, no, range?, start, len, verb, text}], start/len absolute in the file, text the
// command they are in. A range is kept once, with range {from, to}, not once per number.
function fileRefs(text, fileName, target) {
  const out = [];
  const add = (r, start, len, cmd) => {
    if (r.no === undefined) return; // quoted names: the usage is by number
    if (r.range && out.some((o) => o.range === r.range)) return;
    out.push({ kind: r.kind, no: r.no, range: r.range, start, len, verb: r.verb, text: cmd });
  };
  const macro = commandSegments(text, fileName);
  if (macro.kind) {
    for (const seg of macro.segments) {
      for (const r of extractRefs(seg.text, macro.target)) {
        const raw = toRaw(seg, r.start, r.end - r.start);
        add(r, raw.start, raw.len, seg.text);
      }
    }
  } else if (/\.lua$/i.test(String(fileName))) {
    for (const s of commandStrings(text)) {
      for (const r of extractRefs(s.text, target || 'ma3', { dynamic: s.dynamic })) add(r, s.offset + r.start, r.end - r.start, s.text);
    }
  }
  return out;
}

// [{file, text, target?}] -> index {files: Map(file -> {text, refs})}. Pass the previous index to reuse the refs of
// files whose text has not changed.
function buildObjectIndex(files, prev) {
  const index = { files: new Map() };
  for (const f of files) {
    const old = prev && prev.files.get(f.file);
    index.files.set(f.file, old && old.text === f.text ? old : { text: f.text, refs: fileRefs(f.text, f.file, f.target) });
  }
  return index;
}

// The number as [preset type, number] for comparing.
const split = (kind, no) => (kind === 'Preset' ? String(no).split('.').map(Number) : [0, Number(no)]);

// Does a reference name this object? A range covers every number from..to (either order) of one preset type.
function covers(ref, kind, no) {
  if (ref.kind !== kind) return false;
  const [t, n] = split(kind, no);
  if (!ref.range) {
    const [rt, rn] = split(kind, ref.no);
    return rt === t && rn === n;
  }
  const [ta, a] = split(kind, ref.range.from);
  const [tb, b] = split(kind, ref.range.to);
  return ta === t && tb === t && n >= Math.min(a, b) && n <= Math.max(a, b);
}

// Usages of one object -> [{file, line, col, len, verb, text}], line and col 0-based, sorted by file then position.
function findUsages(index, kind, no) {
  const obj = parseObject(kind, no);
  if (!obj) return [];
  const out = [];
  for (const [file, e] of index.files) {
    for (const r of e.refs) {
      if (!covers(r, obj.kind, obj.no)) continue;
      const p = positionOf(e.text, r.start);
      out.push({ file, line: p.line, col: p.character, len: r.len, verb: r.verb, text: r.text, start: r.start });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start).map(({ start, ...u }) => u);
}

// One line on what the loaded show holds under that number, or null when there is no usable show data for the kind
// (no data, the kind not read, or its pool cut off at the cache cap).
function showLine(show, kind, no) {
  const obj = parseObject(kind, no);
  if (!obj || !show || !show[obj.kind] || !show[obj.kind].length || isTruncated(show, obj.kind)) return null;
  const hit = show[obj.kind].find((o) => {
    const p = parseObject(obj.kind, o.no);
    return p && p.no === obj.no;
  });
  return hit ? `${obj.kind} ${obj.no} in the loaded show: ${hit.name || '(no name)'}` : `${obj.kind} ${obj.no} is not in the loaded show`;
}

// The object reference at an offset of a command string (cursor on the kind word or the number) -> {kind, no} or
// null. `abs(r)` maps a reference's start/end in the string to file offsets.
function refAt(command, target, offset, abs = (a) => a, opts = {}) {
  for (const r of extractRefs(command, target, opts)) {
    if (r.no === undefined) continue;
    const start = abs(r.start);
    const end = abs(r.end);
    const k = command.slice(0, r.start).search(/[A-Za-z]+\s+$/);
    const kindStart = k < 0 ? start : abs(k);
    if (offset < Math.min(start, kindStart) || offset > end) continue;
    if (!r.range) return { kind: r.kind, no: r.no };
    // a range: the number under the cursor, or its first number
    const toAt = abs(r.end - String(r.range.to).length);
    return { kind: r.kind, no: offset >= toAt ? r.range.to : r.range.from };
  }
  return null;
}

module.exports = { KINDS, normalizeKind, parseObject, fileRefs, buildObjectIndex, findUsages, showLine, refAt, covers };
