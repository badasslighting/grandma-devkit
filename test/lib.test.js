'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseHelpLua, parseLine } = require('../lib/helpParser');
const { snippetFor, hoverMarkdown, activeCall } = require('../lib/apiModel');
const { findBlockingLoops } = require('../lib/lint');
const { checkManifest } = require('../lib/manifest');
const { luaTemplate, xmlTemplate, validName } = require('../lib/templates');
const { findManifest, deploy, filesForManifest } = require('../lib/deploy');

test('parseLine splits params, optionals and returns', () => {
  const fn = parseLine('HookObjectChange(function:callback, light_userdata:handle, light_userdata:plugin_handle[, light_userdata:target]): integer:hook_id');
  assert.deepStrictEqual(fn.params.map((p) => [p.name, p.optional]), [
    ['callback', false],
    ['handle', false],
    ['plugin_handle', false],
    ['target', true],
  ]);
  assert.strictEqual(fn.returns, 'integer:hook_id');
});

test('parseLine handles nested parens in params and nothing', () => {
  const a = parseLine('GridsGetRowById(light_userdata:handle to UIGrid (or derived), integer: rowId): row index or nil (x)');
  assert.strictEqual(a.params.length, 2);
  assert.strictEqual(a.returns, 'row index or nil (x)');
  assert.deepStrictEqual(parseLine('Root(nothing): light_userdata:handle').params, []);
  assert.strictEqual(parseLine('not an api line'), null);
});

test('parseHelpLua switches section at Object API banner', () => {
  const api = parseHelpLua('Object-Free API\n===\nEcho(string:x): nothing\n===\nObject API\n===\nParent(light_userdata:handle): light_userdata:p\n');
  assert.deepStrictEqual(api.global.map((f) => f.name), ['Echo']);
  assert.deepStrictEqual(api.object.map((f) => f.name), ['Parent']);
});

test('shipped api.json is populated', () => {
  const api = require('../data/api.json');
  assert.ok(api.global.find((f) => f.name === 'Cmd'));
  assert.ok(api.object.find((f) => f.name === 'Parent'));
});

test('snippetFor keeps required params, drops handle for methods', () => {
  const fn = parseLine('Timer(function:fn, integer:delay[, function:cleanup]): nothing');
  assert.strictEqual(snippetFor(fn, false), 'Timer(${1:fn}, ${2:delay})');
  const m = parseLine('Child(light_userdata:handle, integer:index): light_userdata:c');
  assert.strictEqual(snippetFor(m, true), 'Child(${1:index})');
  assert.match(hoverMarkdown(m, 'object'), /Object API/);
});

test('activeCall finds function and argument index', () => {
  assert.deepStrictEqual(activeCall('Cmd("a, b", '), { name: 'Cmd', argIndex: 1 });
  assert.deepStrictEqual(activeCall('foo(Bar(1), {a, b}, '), { name: 'foo', argIndex: 2 });
  assert.strictEqual(activeCall('x = 1'), null);
});

test('findBlockingLoops flags only loops with no exit', () => {
  assert.strictEqual(findBlockingLoops('while true do\n  x = x + 1\nend').length, 1);
  assert.strictEqual(findBlockingLoops('while true do\n  coroutine.yield(1)\nend').length, 0);
  assert.strictEqual(findBlockingLoops('while true do\n  if x then break end\nend').length, 0);
  assert.strictEqual(findBlockingLoops('-- while true do\nlocal s = "while true do"\n').length, 0);
  // yield after the loop must not count for the loop
  const f = findBlockingLoops('while true do\n  work()\nend\ncoroutine.yield(1)\n');
  assert.deepStrictEqual(f.map((x) => x.line), [0]);
  // nested blocks inside the body do not end it early
  assert.strictEqual(findBlockingLoops('while true do\n  if a then f() end\n  coroutine.yield(1)\nend').length, 0);
});

test('checkManifest reports missing file, missing return, ok case', () => {
  const xml = xmlTemplate('P');
  const ok = checkManifest(xml, '/d', () => luaTemplate('P'), () => true);
  assert.deepStrictEqual(ok, []);
  const missing = checkManifest(xml, '/d', () => '', () => false);
  assert.match(missing[0].message, /not found/);
  const noReturn = checkManifest(xml, '/d', () => 'local x = 1\n-- return Main\n', () => true);
  assert.match(noReturn[0].message, /never returns/);
  assert.deepStrictEqual(checkManifest('<other/>', '/d'), []);
  assert.match(checkManifest('<GMA3><Plugin Name="A"></Plugin></GMA3>', '/d')[0].message, /DataVersion/);
});

test('validName', () => {
  assert.ok(validName('My_Plugin-2'));
  assert.ok(!validName('2bad'));
  assert.ok(!validName('has space'));
  assert.ok(!validName('../x'));
});

test('deploy copies manifest and lua files, finds manifest from lua', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'ma3src-'));
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'ma3dst-'));
  try {
    fs.writeFileSync(path.join(src, 'P.lua'), luaTemplate('P'));
    fs.writeFileSync(path.join(src, 'P.xml'), xmlTemplate('P'));
    fs.writeFileSync(path.join(src, 'other.lua'), 'x');
    assert.strictEqual(findManifest(path.join(src, 'P.lua')), path.join(src, 'P.xml'));
    assert.strictEqual(findManifest(path.join(src, 'other.lua')), null);
    assert.strictEqual(filesForManifest(path.join(src, 'P.xml')).length, 2);
    deploy(path.join(src, 'P.xml'), dst);
    assert.deepStrictEqual(fs.readdirSync(dst).sort(), ['P.lua', 'P.xml']);
    assert.throws(() => deploy(path.join(src, 'P.xml'), ''), /plugins folder/);
    fs.unlinkSync(path.join(src, 'P.lua'));
    const dst2 = path.join(dst, 'sub');
    assert.throws(() => deploy(path.join(src, 'P.xml'), dst2), /Missing file/);
    assert.ok(!fs.existsSync(dst2), 'nothing created when a source is missing');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});
