'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildRunLua, parseResults, discoverTests, errorLine } = require('../lib/luaTests');

// Runs the generated chunk on a real Lua when one is installed, quoting the result the way the bridge does.
function runOnLua(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luatests-'));
  const file = path.join(dir, 'run.lua');
  fs.writeFileSync(file, buildRunLua(source));
  const driver = path.join(dir, 'driver.lua');
  fs.writeFileSync(driver, 'io.write(string.format("%q", dofile(arg[1])))');
  return parseResults([execFileSync('lua', [driver, file], { encoding: 'utf8' })]);
}
const haveLua = (() => {
  try {
    execFileSync('lua', ['-v'], { stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
})();

test('discoverTests finds test() calls and their lines', () => {
  const src = "test('adds', function() end)\n-- not a test\n  test(\"it's quoted\", function() end)\nlocal x = attest('no', 1)\n";
  assert.deepStrictEqual(discoverTests(src), [{ name: 'adds', line: 0 }, { name: "it's quoted", line: 2 }]);
});

test('parseResults splits records, keeps errors with pipes, and flags junk', () => {
  const r = parseResults(['"ok|3|adds|;;;fail|0|bad name|testfile:4: expected 2, got 1 | extra"']);
  assert.deepStrictEqual(r[0], { name: 'adds', ok: true, ms: 3, error: '' }, 'an empty error is fine');
  assert.strictEqual(parseResults([]).length, 0);
  assert.deepStrictEqual(parseResults(['"ok|3|adds|"'])[0].ok, true);
  assert.strictEqual(parseResults(['"garbage"'])[0].ok, false);
});

test('errorLine reads the line out of a testfile: message', () => {
  assert.strictEqual(errorLine('testfile:12: expected 1'), 11);
  assert.strictEqual(errorLine('other:3: x'), null);
});

test('the source is embedded safely even when it contains long-bracket closers', () => {
  const lua = buildRunLua('local s = [[ x ]]\nlocal t = [=[ y ]=]\n');
  assert.match(lua, /local src = \[==\[/);
});

test('real Lua: passing, failing, erroring, helpers, hooks and a top-level error', { skip: !haveLua && 'no lua on the PATH' }, () => {
  const source = [
    'local log = {}',
    "beforeEach(function() log[#log + 1] = 'b' end)",
    "afterEach(function() log[#log + 1] = 'a' end)",
    "test('adds', function() assertEq(1 + 1, 2) end)",
    "test('fails with a message', function() assertEq(1, 2, 'one vs two') end)",
    "test('errors', function() local t = nil; return t.x end)",
    "test('error matcher', function() assertError(function() error('boom') end, 'boom') end)",
    "test('assertError wants an error', function() assertError(function() end) end)",
    "test('match', function() assertMatch('hello world', 'wor') assertNil(nil) assertNotNil(1) assertTrue(true) assertFalse(false) assertNe(1, 2) end)",
    "test('hooks ran', function() assertEq(#log, 13, 'before and after for each of the 6 earlier tests, plus its own before') end)",
    "test('pipes | and\\nnewlines are cleaned', function() error('a|b\\nc') end)",
  ].join('\n');
  const r = runOnLua(source);
  const by = Object.fromEntries(r.map((x) => [x.name, x]));
  assert.strictEqual(r.length, 8);
  assert.ok(by.adds.ok && by['error matcher'].ok && by.match.ok);
  assert.ok(!by['fails with a message'].ok);
  assert.match(by['fails with a message'].error, /testfile:5: one vs two: expected 2, got 1/);
  assert.match(by.errors.error, /attempt to index a nil value/);
  assert.match(by['assertError wants an error'].error, /expected an error, but the function returned normally/);
  assert.ok(by['hooks ran'].ok, by['hooks ran'].error);
  const piped = r.find((x) => x.name.startsWith('pipes'));
  assert.strictEqual(piped.name, 'pipes   and newlines are cleaned');
  assert.strictEqual(piped.error, 'testfile:11: a|b / c');
  assert.ok(r.every((x) => !/[\r\n]/.test(x.error)));
});

test('real Lua: a syntax error and a top-level error each become one failed (file) entry', { skip: !haveLua && 'no lua on the PATH' }, () => {
  const syntax = runOnLua('test(\n');
  assert.deepStrictEqual(syntax.map((x) => [x.name, x.ok]), [['(file)', false]]);
  assert.match(syntax[0].error, /testfile:/);
  const top = runOnLua("test('first', function() end)\nerror('setup broke')\n");
  assert.deepStrictEqual(top.map((x) => [x.name, x.ok]), [['first', true], ['(file)', false]]);
});

test('real Lua: test code runs in its own environment, so its globals do not leak', { skip: !haveLua && 'no lua on the PATH' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luatests-'));
  const file = path.join(dir, 'run.lua');
  fs.writeFileSync(file, `${buildRunLua("leaked = 1\ntest('sets', function() leakedToo = 2 end)")}`);
  const driver = path.join(dir, 'driver.lua');
  fs.writeFileSync(driver, 'dofile(arg[1]); io.write(tostring(leaked), tostring(leakedToo))');
  const out = execFileSync('lua', [driver, file], { encoding: 'utf8' });
  assert.strictEqual(out, 'nilnil');
});
