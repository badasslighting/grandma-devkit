'use strict';
const test = require('node:test');
const assert = require('node:assert');
const B = require('../lib/varBank');
const { scanFile } = require('../lib/varIndex');

const entry = (file, text, name, hint) => ({ file, scan: scanFile(text, name, name.endsWith('.lua') ? 'lua' : '', hint) });

test('usageStats ranks variables by how often the files use them', () => {
  const entries = [
    entry('a.gma2macro', ['SetVar $color1 = 5', 'Go+ $color1', 'Go+ $color1', 'Go+ $color2', 'Go+ $COLOR1', ''].join('\n'), 'a.gma2macro'),
    entry('b.lua', "gma.cmd('Go+ $color1')\ngma.cmd('Go+ $rare')\nlocal v = gma.show.getvar('color2')\n", 'b.lua', 'ma2'),
    entry('c.gma3macro', 'SetUserVariable "color1" 3\nGo+ $color1\n', 'c.gma3macro'),
  ];
  const ma2 = B.usageStats(entries, 'ma2');
  assert.deepStrictEqual(ma2.map((s) => [s.name, s.uses, s.sets, s.files]), [
    ['color1', 4, 1, 2],
    ['color2', 2, 0, 2],
    ['rare', 1, 0, 1],
  ]);
  assert.strictEqual(ma2[0].value, '5');
  assert.deepStrictEqual(ma2[0].scopes, ['global']);
  // the two consoles stay apart, and grandMA3 names are exact
  const all = B.usageStats(entries);
  assert.ok(all.some((s) => s.target === 'ma3' && s.name === 'color1' && s.total === 2));
  assert.strictEqual(B.usageStats(entries, 'ma3').length, 1);
});

test('usageStats keeps the most used spelling and ignores variables inside quotes', () => {
  const e = [entry('a.gma2macro', 'Go+ $Color\nGo+ $Color\nGo+ $color\nLabel Macro 1 "x$ignored"\n', 'a.gma2macro')];
  const s = B.usageStats(e, 'ma2');
  assert.deepStrictEqual(s.map((x) => [x.name, x.total]), [['Color', 3]]);
});

test('stock variables: 26 on grandMA2, none found on grandMA3', () => {
  const ma2 = B.stockVars('ma2');
  assert.strictEqual(ma2.length, 26);
  assert.ok(ma2.every((v) => v.doc && v.scope === 'system'));
  assert.ok(ma2.some((v) => v.name === 'FADERPAGE'));
  assert.deepStrictEqual(B.stockVars('ma3'), []);
});

test('favorites: add, update in place, remove, validate', () => {
  let list = [];
  list = B.addFavorite(list, { name: '$color1', target: 'ma2', scope: 'global', value: 5, note: 'front wash' });
  list = B.addFavorite(list, { name: 'speed', target: 'ma3', scope: 'user', value: 'fast' });
  list = B.addFavorite(list, { name: 'COLOR1', target: 'ma2', scope: 'global', value: 6 }); // same variable on grandMA2
  assert.deepStrictEqual(list.map((f) => [f.target, f.name, f.value]), [['ma2', 'COLOR1', '6'], ['ma3', 'speed', 'fast']]);
  list = B.addFavorite(list, { name: 'color1', target: 'ma3', scope: 'user' });
  assert.strictEqual(list.length, 3, 'grandMA3 names are exact and it is another console');
  assert.ok(B.isFavorite(list, 'color1', 'ma2'));
  assert.ok(!B.isFavorite(list, 'Speed', 'ma3'));
  list = B.removeFavorite(list, { name: 'color1', target: 'ma2', scope: 'global' });
  assert.ok(!B.isFavorite(list, 'color1', 'ma2'));
  assert.throws(() => B.addFavorite([], { name: '1bad' }), /not a variable name/);
  assert.throws(() => B.addFavorite([], { name: 'a b' }), /not a variable name/);
});

test('favorites export and import', () => {
  const list = B.addFavorite(B.addFavorite([], { name: 'a', target: 'ma2', value: 1 }), { name: 'b', target: 'ma3', scope: 'user', note: 'n' });
  const text = B.exportFavorites(list);
  assert.strictEqual(JSON.parse(text).format, B.FORMAT);
  const back = B.importFavorites(text, []);
  assert.deepStrictEqual(back.list, list);
  assert.deepStrictEqual(back.skipped, []);
  // merged into an existing list; invalid entries are skipped with a reason
  const mixed = JSON.stringify({ format: B.FORMAT, version: 1, variables: [{ name: 'c', target: 'ma2' }, { name: '9x' }, { name: 'a', target: 'ma2', value: 2 }] });
  const merged = B.importFavorites(mixed, list);
  assert.deepStrictEqual(merged.list.map((f) => f.name + f.value), ['a2', 'c', 'b']);
  assert.strictEqual(merged.skipped.length, 1);
  assert.throws(() => B.importFavorites('{"format":"other"}'), /not a grandMA Devkit variable list/);
  assert.throws(() => B.importFavorites('nonsense'), /Not a JSON file/);
});

test('describeUsage', () => {
  assert.strictEqual(B.describeUsage({ uses: 1, sets: 0, files: 1 }), '1 use, 0 sets, 1 file');
  assert.strictEqual(B.describeUsage({ uses: 12, sets: 2, files: 3 }), '12 uses, 2 sets, 3 files');
});
