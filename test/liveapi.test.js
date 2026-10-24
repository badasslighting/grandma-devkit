'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ma3ApiLua, parseMa3Api, diffApi, ma2WalkLua, parseMa2Walk, ma2Gaps } = require('../lib/liveApi');
const api = require('../data/api.json');

test('parseMa3Api reads descriptor rows into the same entries HelpLua gives', () => {
  const dump = '"Echo(string:formatted_command ...): nothing ;;; Root(nothing): light_userdata:handle @@@@ ToAddr(light_userdata:handle,boolean:with_name[, boolean:use_visible_addr]): string:address"';
  const parsed = parseMa3Api([dump]);
  assert.deepStrictEqual(parsed.global.map((f) => f.name), ['Echo', 'Root']);
  assert.deepStrictEqual(parsed.object.map((f) => [f.name, f.params.length, f.returns]), [['ToAddr', 3, 'string:address']]);
  assert.deepStrictEqual(parseMa3Api([]), { global: [], object: [] });
  assert.match(ma3ApiLua(), /GetApiDescriptor\(\)[\s\S]*GetObjApiDescriptor\(\)/);
});

test('the shipped api.json round-trips through the descriptor line format', () => {
  const line = (f) => f.signature;
  const dump = `"${api.global.map(line).join(' ;;; ')} @@@@ ${api.object.map(line).join(' ;;; ')}"`;
  const parsed = parseMa3Api([dump]);
  assert.strictEqual(parsed.global.length, api.global.length);
  assert.strictEqual(parsed.object.length, api.object.length);
  assert.deepStrictEqual(diffApi(api, parsed), { added: [], removed: [], changed: [] });
});

test('diffApi reports added, removed and changed functions, object methods with a colon', () => {
  const a = { global: [{ name: 'A', signature: 'A(x): nothing' }, { name: 'B', signature: 'B(): nothing' }], object: [{ name: 'M', signature: 'M(h): nothing' }] };
  const b = { global: [{ name: 'A', signature: 'A(x, y): nothing' }, { name: 'C', signature: 'C(): nothing' }], object: [] };
  assert.deepStrictEqual(diffApi(a, b), { added: ['C'], removed: ['B', ':M'], changed: ['A'] });
  assert.deepStrictEqual(diffApi(a, { global: [{ name: 'A', signature: 'A( x ) : nothing' }, { name: 'B', signature: 'B(): nothing' }], object: a.object }).changed, [], 'spacing is not a change');
});

test('the MA2 walk is parsed and compared with the curated list', () => {
  const walk = parseMa2Walk(['"gma.cmd ;;; gma.echo ;;; gma.zzz.newfn ;;; gma.sleep @@@@ gma.zzz ;;; gma.show"']);
  assert.deepStrictEqual(walk.functions, ['gma.cmd', 'gma.echo', 'gma.zzz.newfn', 'gma.sleep']);
  assert.deepStrictEqual(walk.tables, ["gma.zzz", "gma.show"]);
  const gaps = ma2Gaps(walk);
  assert.deepStrictEqual(gaps.missing, ['gma.zzz.newfn']);
  assert.ok(gaps.notOnConsole.includes('gma.feedback') && !gaps.notOnConsole.includes('gma.cmd'));
  assert.match(ma2WalkLua(), /mt\.__index[\s\S]*walk\(real, "gma", 0\)/, 'walks the real table behind the bridge proxy');
});
