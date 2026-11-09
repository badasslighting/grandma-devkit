'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { replLua, parseRepl, valueText } = require('../lib/repl');

const haveLua = (() => {
  try {
    execFileSync('lua', ['-v'], { stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
})();
const opts = { skip: !haveLua && 'no lua on the PATH' };

// Run the generated Lua on a plain interpreter and decode the way the extension does (the bridge %q-quotes returns).
function run(expr, mode, setup = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repl-'));
  fs.writeFileSync(path.join(dir, 'r.lua'), `${setup}\nlocal reply = (function()\n${replLua(expr, mode)}\nend)()\nio.write(string.format('%q', reply))`);
  const out = execFileSync('lua', [path.join(dir, 'r.lua')], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return parseRepl([out]);
}

test('replLua carries an expression that contains long-bracket closers', () => {
  const lua = replLua('("]]")', 'run');
  assert.match(lua, /\[==\[\("\]\]"\)\]==\]/);
});

test('run mode describes each returned value', opts, () => {
  const r = run('1 + 1, "hi", nil, {1, 2}', 'run');
  assert.deepEqual(r.values.map((v) => v.t), ['number', 'string', 'nil', 'table']);
  assert.equal(valueText(r.values[0]), '2');
  assert.equal(valueText(r.values[1]), '"hi"');
  assert.equal(r.values[3].n, 2);
});

test('run mode falls back to statements and reports errors', opts, () => {
  assert.deepEqual(run('local a = 1', 'run').values, []);
  assert.match(run('error("boom")', 'run').error, /boom/);
  assert.match(run('1 +', 'run').error, /repl/);
});

test('children mode lists table keys with expressions that re-evaluate to the child', opts, () => {
  const r = run('{b = 2, a = {x = 1}, [3] = "z"}', 'children');
  assert.deepEqual(r.children.map((c) => c.k), [3, 'a', 'b']);
  assert.equal(r.children.find((c) => c.k === 'a').d.t, 'table');
  assert.equal(r.children.find((c) => c.k === 'a').expr, '({b = 2, a = {x = 1}, [3] = "z"})["a"]');
});

test('strings with quotes, control and non-UTF8 bytes survive the JSON round trip', opts, () => {
  // the Lua source is "a\"b\\c\n\255": a quote, a backslash, a newline and one byte that is not UTF-8
  const r = run(String.raw`"a\"b\\c\n\255"`, 'run');
  assert.equal(r.values[0].t, 'string');
  assert.equal(r.values[0].s, 'a"b\\c\n?');
});

test('parseRepl answers with an error for an unreadable reply', () => {
  assert.match(parseRepl(['"nope"']).error, /unreadable/);
  assert.equal(parseRepl([]).error, 'no reply');
});

test('panel helpers: tidyExpr undoes the grouping parentheses, rootIndexPath reads a Root()[n] chain', () => {
  const { tidyExpr, rootIndexPath, replHtml } = require('../lib/replPanel');
  assert.equal(tidyExpr('(Root()[14])[3]'), 'Root()[14][3]');
  assert.equal(tidyExpr('((Root()[14])[3])["a"]'), 'Root()[14][3]["a"]');
  assert.equal(tidyExpr('Root().ShowData'), 'Root().ShowData');
  assert.deepEqual(rootIndexPath('(Root()[14])[3]'), [14, 3]);
  assert.deepEqual(rootIndexPath('Root()'), []);
  assert.equal(rootIndexPath('Root().ShowData'), null);
  const html = replHtml('abc123', 'ma2');
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.doesNotMatch(html, /__NONCE__|__TARGET__/);
  assert.match(html, /target: 'ma2'/);
});
