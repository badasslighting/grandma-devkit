'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ma2TreeLua, parseMa2Tree, ma2Address, ma2ShowLua, ma2PathContext, ma2PathEntries, KINDS } = require('../lib/ma2Objects');
const { parseShow } = require('../lib/showCache');

test('ma2TreeLua lists the roots for an empty path and walks child indexes below one', () => {
  const roots = ma2TreeLua([]);
  assert.match(roots, /o\.handle\('Root ' \.\. i\)/);
  assert.match(roots, /for i = 1, 30 do/);
  const deep = ma2TreeLua([3, 1, 0]);
  assert.match(deep, /o\.handle\('Root 3'\)/);
  assert.match(deep, /ipairs\(\{1, 0\}\)/);
  assert.match(deep, /math\.min\(n, 500\) - 1/, 'children count from 0 and are capped');
  assert.throws(() => ma2TreeLua([3, 'x']), /whole numbers/);
  assert.throws(() => ma2TreeLua([3, -1]), /whole numbers/);
});

test('parseMa2Tree reads records, strips CMD_, and copes with pipes in names and junk', () => {
  const q = '"total=3 ;; 0|6|1|CMD_GLOBAL_SETTINGS|Global 1 ;; 1|0||CMD_MACRO_POOL|Global / x ;; junk"';
  assert.deepStrictEqual(parseMa2Tree([q]), {
    total: 3,
    items: [
      { index: 0, amount: 6, number: '1', cls: 'GLOBAL_SETTINGS', name: 'Global 1' },
      { index: 1, amount: 0, number: '', cls: 'MACRO_POOL', name: 'Global / x' },
    ],
  });
  assert.deepStrictEqual(parseMa2Tree([]), { total: 0, items: [] });
});

test('ma2Address builds Root n.m from pool numbers and refuses blanks', () => {
  assert.strictEqual(ma2Address([3, '2']), 'Root 3.2');
  assert.strictEqual(ma2Address([13]), 'Root 13');
  assert.strictEqual(ma2Address([3, '']), null);
  assert.strictEqual(ma2Address([]), null);
});

test('ma2ShowLua covers every kind, finds pools from a member or by plural name, and descends into the macro pool', () => {
  const lua = ma2ShowLua();
  for (const [k, p] of KINDS) assert.ok(lua.includes(`{'${k}', '${p}'}`), k);
  assert.match(lua, /o\.parent\(h\)/);
  assert.match(lua, /POOL\$/);
  assert.match(lua, /tonumber\(o\.number\(c\)\)/, 'unnumbered objects are skipped');
  assert.deepStrictEqual(parseShow(['"Macro|99|DevkitMacro ;; Layout|7|DevkitLayout"']), { Macro: [{ no: '99', name: 'DevkitMacro' }], Layout: [{ no: '7', name: 'DevkitLayout' }] });
});

test('ma2PathContext finds the address typed so far inside gma.show.getobj.handle("Root ...", both quote styles', () => {
  assert.deepStrictEqual(ma2PathContext('local h = gma.show.getobj.handle("Root '), { numbers: [], partial: '' });
  assert.deepStrictEqual(ma2PathContext("h = gma.show.getobj.handle('Root 3."), { numbers: [3], partial: '' });
  assert.deepStrictEqual(ma2PathContext('gma.show.getobj.handle( "Root 3.12.4'), { numbers: [3, 12], partial: '4' });
  assert.strictEqual(ma2PathContext('gma.show.getobj.handle("Group 1'), null, 'only Root addresses');
  assert.strictEqual(ma2PathContext('gma.cmd("Root 3.'), null, 'not a handle call');
  assert.strictEqual(ma2PathContext('gma.show.getobj.handle("Root 3.2")'), null, 'closed string');
});

test('ma2TreeLua by address walks Root a.b with handle(), not child positions', () => {
  const byAddr = ma2TreeLua([3, 2], 300, true);
  assert.match(byAddr, /o\.handle\('Root 3\.2'\)/);
  assert.doesNotMatch(byAddr, /o\.child\(h, i\); if not h/, 'no child-chain walk');
  assert.match(ma2TreeLua([3, 2]), /o\.child\(h, i\); if not h/, 'the default still walks child positions');
});

test('ma2PathEntries keeps children that have a pool number', () => {
  const parsed = parseMa2Tree(["total=2 ;; 0|0|1|CMD_GROUP|Front ;; 1|0||CMD_GROUP|Blank"]);
  assert.deepStrictEqual(ma2PathEntries(parsed), [{ number: '1', name: 'Front', cls: 'GROUP' }]);
});

test('offlineAddressChildren lists the bundled grandMA2 tree by address, without a console', () => {
  const { offlineAddressChildren } = require('../lib/offlineTree');
  const roots = offlineAddressChildren([]);
  assert.ok(roots.length > 10 && roots.every((r) => /^\d+$/.test(r.number)), 'root numbers');
  assert.ok(roots.some((r) => r.number === '1' && r.name === 'Showfile'));
  const kids = offlineAddressChildren([1]);
  assert.ok(kids.some((k) => k.number === '1' && /HISTORY/.test(k.cls)), 'children of Root 1');
  assert.deepStrictEqual(offlineAddressChildren([999]), [], 'unknown address');
});
