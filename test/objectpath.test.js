'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pathContext, childrenLua, parseChildren } = require('../lib/objectPath');

test('pathContext follows names, indexes and quoted names from Root()', () => {
  assert.deepStrictEqual(pathContext('local x = Root().'), { segments: [], partial: '' });
  assert.deepStrictEqual(pathContext('Root().ShowData.Da'), { segments: ['ShowData'], partial: 'Da' });
  assert.deepStrictEqual(pathContext('f(Root().ShowData.DataPools[1].'), { segments: ['ShowData', 'DataPools', 1], partial: '' });
  assert.deepStrictEqual(pathContext('Root()["ShowData"].DataPools[1].Gr'), { segments: ['ShowData', 'DataPools', 1], partial: 'Gr' });
  assert.strictEqual(pathContext('local d = Data.'), null, 'only chains from Root() are followed');
  assert.strictEqual(pathContext('Root():Children().'), null, 'method calls are not followed');
  assert.deepStrictEqual(pathContext('Root().ShowData'), { segments: [], partial: 'ShowData' }, 'a name typed right after Root() is still being completed');
  assert.strictEqual(pathContext('Root().ShowData.DataPools[1]'), null, 'nothing after the last index to complete');
  assert.strictEqual(pathContext('MyRoot().x.'), null);
});

test('childrenLua walks the segments and refuses names that could break out of the string', () => {
  const lua = childrenLua(['ShowData', 'DataPools', 1]);
  assert.match(lua, /ipairs\(\{"ShowData", "DataPools", 1\}\)/);
  assert.match(lua, /o:PropertyCount\(\)/);
  assert.throws(() => childrenLua(['x"]) os.exit() --']), /Unsupported path segment/);
  assert.match(childrenLua([]), /ipairs\(\{\}\)/);
  assert.match(childrenLua(['Default Pool']), /"Default Pool"/);
});

test('parseChildren keeps only names usable after a dot, once each', () => {
  const r = parseChildren(['"ShowData,Default Pool,Tags,Tags @@ NAME,INDEX,NO,9x"']);
  assert.deepStrictEqual(r, { children: ['ShowData', 'Tags'], properties: ['NAME', 'INDEX', 'NO'] });
  assert.deepStrictEqual(parseChildren([]), { children: [], properties: [] });
});
