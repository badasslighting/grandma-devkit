'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { groupCapture } = require('../scripts/ma3Capture');

function row(lua, cls, index, children = [], address = 'collision') {
  return { lua_address: lua, class: cls, native_index: index, children, properties: [], address };
}
const child = (index, cls) => ({ index, class: cls, address: 'collision', link: false });

test('colliding command addresses do not merge parents or lose children', () => {
  const rows = [row('Root()', 'Root', 0, [child(1, 'Fixtures'), child(2, 'Layouts')]),
    row('Root()[1]', 'Fixtures', 1, [child(1, 'Fixture')]),
    row('Root()[2]', 'Layouts', 2, [child(1, 'Layout')]),
    row('Root()[1][1]', 'Fixture', 1), row('Root()[2][1]', 'Layout', 1)];
  const { grouped } = groupCapture(rows);
  assert.ok(grouped.has('/Root/Fixtures/Fixture'));
  assert.ok(grouped.has('/Root/Layouts/Layout'));
  assert.deepEqual([...grouped.get('/Root/Fixtures').children], ['/Root/Fixtures/Fixture']);
  assert.deepEqual([...grouped.get('/Root/Layouts').children], ['/Root/Layouts/Layout']);
});

test('preset pools and live/edit patch slots remain distinct', () => {
  const rows = [row('Root()', 'Root', 0, [child(1, 'Presets'), child(2, 'Presets'), child(9, 'Patch'), child(10, 'Patch')]),
    row('Root()[1]', 'Presets', 1), row('Root()[2]', 'Presets', 2), row('Root()[9]', 'Patch', 9), row('Root()[10]', 'Patch', 10)];
  const { grouped } = groupCapture(rows);
  for (const key of ['/Root/Presets:1', '/Root/Presets:2', '/Root/Patch:9', '/Root/Patch:10']) assert.ok(grouped.has(key), key);
});

test('duplicate Lua paths are rejected before dataset generation', () => {
  assert.throws(() => groupCapture([row('Root()', 'Root', 0), row('Root()', 'Root', 0)]), /Duplicate Lua path/);
});

