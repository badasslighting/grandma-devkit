'use strict';
const test = require('node:test');
const assert = require('node:assert');
const e = require('../lib/enums');
const { enumContext } = require('../lib/liveNames');

test('bundled enum names are offered without a console', () => {
  const names = e.enumNames([]);
  assert.ok(names.length > 400);
  for (const n of ['TimerMode', 'Roles', 'PathType', 'CueTrigger', 'YesNo']) assert.ok(names.includes(n), n);
  assert.ok(names.every((n) => /^[A-Za-z_]\w*$/.test(n)), 'identifier names only');
  assert.ok(!names.includes('Enums'), 'the property enum called Enums is not a global member');
  assert.deepStrictEqual(names, [...names].sort());
});

test('bundled enum members carry their values, sorted by name', () => {
  assert.deepStrictEqual(e.enumMembers('TimerMode', []), [{ name: 'Countdown', value: '0' }, { name: 'Stopwatch', value: '1' }]);
  const temp = e.enumMembers('PathType', []).find((m) => m.name === 'Temp');
  assert.deepStrictEqual(temp, { name: 'Temp', value: '12' });
  assert.deepStrictEqual(e.enumMembers('NoSuchEnum', []), []);
});

test('members are written-able Lua: no numeric aliases, keywords or spaced spellings', () => {
  const yn = e.enumMembers('YesNo', []).map((m) => m.name);
  assert.deepStrictEqual(yn, ['No', 'Yes']);
  for (const n of e.staticEnumNames()) {
    for (const m of e.staticEnumMembers(n)) assert.match(m.name, /^[A-Za-z_]\w*$/, `${n}.${m.name}`);
  }
  assert.ok(!e.staticEnumMembers('SacnDataMode').some((m) => /\s/.test(m.name)));
});

test('live answers win over the bundle', () => {
  assert.deepStrictEqual(e.enumNames(['Only']), ['Only']);
  const live = [{ name: 'Live', value: '9' }];
  assert.deepStrictEqual(e.enumMembers('TimerMode', live), live);
});

test('enumAt finds the enum or member under the cursor', () => {
  const line = 'local m = Enums.TimerMode.Countdown';
  assert.strictEqual(e.enumAt(line, 2), null);
  assert.strictEqual(e.enumAt(line, 11), null, 'on the Enums keyword');
  assert.deepStrictEqual(e.enumAt(line, 18), { name: 'TimerMode', member: '', start: 16, end: 25 });
  assert.deepStrictEqual(e.enumAt(line, 30), { name: 'TimerMode', member: 'Countdown', start: 26, end: 35 });
});

test('enumHoverMarkdown describes bundled enums and members, and ignores unknown names', () => {
  assert.match(e.enumHoverMarkdown('TimerMode', 'Stopwatch'), /Enums\.TimerMode\.Stopwatch\*\* = 1/);
  assert.match(e.enumHoverMarkdown('TimerMode', ''), /Countdown \(0\), Stopwatch \(1\)/);
  assert.strictEqual(e.enumHoverMarkdown('TimerMode', 'Nope'), null);
  assert.strictEqual(e.enumHoverMarkdown('Nope', ''), null);
});

test('completion context feeds the static lookup end to end', () => {
  const en = enumContext('x = Enums.TimerMode.Co');
  assert.deepStrictEqual(e.enumMembers(en.name, []).map((m) => m.name), ['Countdown', 'Stopwatch']);
  assert.ok(e.enumNames([]).includes('TimerMode'));
});

test('enumHoverMarkdown: live members win over the bundle, an empty live answer falls back', () => {
  const live = [{ name: 'Live', value: '9' }];
  const md = e.enumHoverMarkdown('TimerMode', 'Live', live);
  assert.match(md, /Enums\.TimerMode\.Live\*\* = 9/);
  assert.match(md, /live console/);
  assert.strictEqual(e.enumHoverMarkdown('TimerMode', 'Countdown', live), null, 'a bundled member the console does not have is not described');
  assert.match(e.enumHoverMarkdown('TimerMode', '', live), /Live \(9\)/);
  assert.doesNotMatch(e.enumHoverMarkdown('TimerMode', '', live), /Stopwatch/);
  assert.match(e.enumHoverMarkdown('TimerMode', 'Stopwatch', []), /Stopwatch\*\* = 1/, 'empty live: the bundle');
  assert.match(e.enumHoverMarkdown('TimerMode', 'Stopwatch', []), /bundled/);
  assert.match(e.enumHoverMarkdown('Unknown', '', live), /Live \(9\)/, 'the console may know enums the bundle does not');
});
