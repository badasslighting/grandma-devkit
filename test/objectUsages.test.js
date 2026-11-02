'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildObjectIndex, findUsages, normalizeKind, parseObject, showLine, refAt } = require('../lib/objectUsages');
const { parseShow } = require('../lib/showCache');

const LUA = ['local function main()', '  Cmd("Go+ Macro 12")', '  Cmd("Call Macro 3 Thru 6")', '  Cmd("Store Macro 12 /o") -- not a usage', '  Cmd("Off Sequence 3 ; Select Layout 4")', '  Cmd("Group 5 At Preset 2.5")', 'end', 'return main', ''].join('\n');
const MACRO = ['# a comment naming Macro 12', 'Go+ Macro 12', '  Off Sequence 3', ''].join('\n');
const XML = '<?xml version="1.0"?>\n<GMA3 DataVersion="2.5"><Macro name="m"><MacroLine Command="Go+ Macro &quot;x&quot; ; Call Macro 5" /></Macro></GMA3>\n';
const index = buildObjectIndex([
  { file: 'a.lua', text: LUA },
  { file: 'show.gma3macro', text: MACRO },
  { file: 'export.xml', text: XML },
  { file: 'notes.txt', text: 'Go+ Macro 12' },
]);
const where = (kind, no) => findUsages(index, kind, no).map((u) => `${u.file}:${u.line}:${u.col}`);

test('findUsages: Lua Cmd strings and macro-file lines, with positions, verb and command text', () => {
  const u = findUsages(index, 'Macro', '12');
  assert.deepStrictEqual(u.map((x) => [x.file, x.line, x.col, x.len, x.verb, x.text]), [
    ['a.lua', 1, 17, 2, 'Go+', 'Go+ Macro 12'],
    ['show.gma3macro', 1, 10, 2, 'Go+', 'Go+ Macro 12'],
  ]);
  assert.deepStrictEqual(where('Sequence', '3'), ['a.lua:4:20', 'show.gma3macro:2:15']);
  assert.deepStrictEqual(where('Layout', '4'), ['a.lua:4:38']);
});

test('findUsages: XML macro lines map back to the escaped file text', () => {
  const [u] = findUsages(index, 'Macro', '5').filter((x) => x.file === 'export.xml');
  const line = XML.split('\n')[u.line];
  assert.strictEqual(line.slice(u.col, u.col + u.len), '5');
  assert.strictEqual(u.text, 'Go+ Macro "x" ; Call Macro 5');
});

test('findUsages: a Thru range is a usage of every number inside it, and of nothing outside', () => {
  assert.deepStrictEqual(where('Macro', '5'), ['a.lua:2:18', 'export.xml:1:97']);
  for (const n of ['3', '4', '6']) assert.deepStrictEqual(where('Macro', n), ['a.lua:2:18'], `Macro ${n}`);
  assert.deepStrictEqual(where('Macro', '7'), []);
  assert.deepStrictEqual(where('Macro', '2'), []);
  const wide = buildObjectIndex([{ file: 'w.lua', text: 'Cmd("Off Macro 900 Thru 1")' }]);
  assert.strictEqual(findUsages(wide, 'Macro', '850').length, 1, 'past the extractRefs expansion cap');
  const presets = buildObjectIndex([{ file: 'p.lua', text: 'Cmd("Preset 4.2 Thru 4.8")' }]);
  assert.strictEqual(findUsages(presets, 'Preset', '4.5').length, 1);
  assert.strictEqual(findUsages(presets, 'Preset', '3.5').length, 0, 'another preset type');
});

test('kind aliases, the Preset form and number forms', () => {
  for (const k of ['macro', 'MACRO', 'Macros', 'macros']) assert.strictEqual(normalizeKind(k), 'Macro');
  assert.strictEqual(normalizeKind('seq'), 'Sequence');
  assert.strictEqual(normalizeKind('cue'), undefined);
  assert.deepStrictEqual(where('macro', '012'), where('Macro', '12'));
  assert.deepStrictEqual(parseObject(undefined, 'Preset 2.5'), { kind: 'Preset', no: '2.5' });
  assert.deepStrictEqual(parseObject('preset', '2.5'), { kind: 'Preset', no: '2.5' });
  assert.deepStrictEqual(parseObject('Preset', '5'), null, 'a preset needs type.number');
  assert.deepStrictEqual(parseObject('Macro', 'x'), null);
  assert.deepStrictEqual(where(undefined, 'Preset 2.5'), ['a.lua:5:25']);
  assert.deepStrictEqual(where('presets', '2.5'), ['a.lua:5:25']);
});

test('no hits: store/label segments, comments, unknown kinds, other files', () => {
  assert.deepStrictEqual(where('Macro', '99'), []);
  assert.deepStrictEqual(where('Bogus', '1'), []);
  assert.deepStrictEqual(where('Macro', ''), []);
  const only = buildObjectIndex([{ file: 'b.lua', text: '-- Cmd("Go+ Macro 1")\nCmd("Label Macro 1 \\"x\\"")\nCmd("Go+ Macro " .. n)\n' }]);
  assert.deepStrictEqual(findUsages(only, 'Macro', '1'), []);
});

test('buildObjectIndex reuses the refs of unchanged files', () => {
  const next = buildObjectIndex([{ file: 'a.lua', text: LUA }, { file: 'show.gma3macro', text: 'Go+ Macro 7\n' }], index);
  assert.strictEqual(next.files.get('a.lua'), index.files.get('a.lua'));
  assert.notStrictEqual(next.files.get('show.gma3macro'), index.files.get('show.gma3macro'));
  assert.deepStrictEqual(findUsages(next, 'Macro', '7').map((u) => u.file), ['show.gma3macro']);
});

test('showLine: the object in the loaded show, missing, or nothing without usable data', () => {
  const show = parseShow(['"Macro|12|Blue ;; Macro|13|Red ;; Preset|2.5|Warm"']);
  assert.strictEqual(showLine(show, 'macro', '12'), 'Macro 12 in the loaded show: Blue');
  assert.strictEqual(showLine(show, 'Macro', '14'), 'Macro 14 is not in the loaded show');
  assert.strictEqual(showLine(show, undefined, 'Preset 2.5'), 'Preset 2.5 in the loaded show: Warm');
  assert.strictEqual(showLine(show, 'Group', '1'), null, 'kind not read');
  assert.strictEqual(showLine(null, 'Macro', '12'), null);
  const cut = parseShow(['"Macro|1|a ;; Macro|*|"']);
  assert.strictEqual(showLine(cut, 'Macro', '12'), null, 'truncated pool');
});

test('refAt: the reference under the cursor, on the number or the kind word', () => {
  const c = 'Go+ Macro 12 ; Call Macro 3 Thru 6';
  assert.deepStrictEqual(refAt(c, 'ma3', c.indexOf('12') + 1), { kind: 'Macro', no: '12' });
  assert.deepStrictEqual(refAt(c, 'ma3', c.indexOf('Macro') + 2), { kind: 'Macro', no: '12' });
  assert.deepStrictEqual(refAt(c, 'ma3', c.indexOf(' 3 ') + 1), { kind: 'Macro', no: '3' });
  assert.deepStrictEqual(refAt(c, 'ma3', c.length), { kind: 'Macro', no: '6' });
  assert.strictEqual(refAt(c, 'ma3', 1), null);
  assert.deepStrictEqual(refAt(c, 'ma3', 100 + c.indexOf('12'), (a) => a + 100), { kind: 'Macro', no: '12' });
});
