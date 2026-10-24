'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ma2TreeLua, parseMa2Tree, ma2Address, ma2ShowLua, KINDS } = require('../lib/ma2Objects');
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
