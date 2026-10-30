'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const V = require('../lib/variables');

// The generated Lua for a grandMA2 [condition] is checked against the repo's own model of the console (evalLine).

const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8' });
  return r.error && r.error.code === 'ENOENT' ? null : r;
};
const have = (cmd) => run(cmd, ['-v']) !== null;

test('conditions: a "$" operand that is not a plain variable name is refused, and every rewrite is valid Lua', (t) => {
  if (!have('luac')) return t.skip('no luac on the PATH');
  const refused = ['5 == $"a"', '$x == $"abc"', '5 == $\\ ', '5 == $\\', '5 == $1', '5 == $$', '$x == $', '$x == $1a', '5 == $a-b', '$x == $"a', '$x == $\\"'];
  for (const c of refused) assert.strictEqual(V.bracketLineToLua(`[${c}] Go+`), null, c);
  const hostile = [
    ...refused,
    '$x == "a\\b"', '$x == "a\'b"', '"a]b" == $x', '$x == a\\', '$x == a"b', '$x == "a\nb"', '$x == "a\rb"', '$x == "\u0001"', '$x == 5', '5 < $x', '$x == $y', '"5" == $x',
  ];
  let rewritten = 0;
  for (const c of hostile) {
    for (const line of [`[${c}] Go+`, `[${c}] Label Macro 1 "a\\b\nc"`]) {
      const r = V.bracketLineToLua(line);
      if (!r) continue;
      rewritten++;
      const out = run('luac', ['-p', '-'], r.lua);
      assert.strictEqual(out.status, 0, `${JSON.stringify(line)} -> ${r.lua}\n${out.stderr}`);
    }
  }
  assert.ok(rewritten >= 6, 'the plain operands are still rewritten');
});
