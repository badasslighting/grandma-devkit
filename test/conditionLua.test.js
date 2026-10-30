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

// {x, y}: the values of the variables x and y (undefined = unset). -> 'run' | 'skip' for the console and for the Lua.
const consoleSays = (cond, c) => {
  const vars = new Map();
  if (c.x !== undefined) vars.set('X', c.x);
  if (c.y !== undefined) vars.set('Y', c.y);
  return V.evalLine(`[${cond}] Go+`, vars).runs ? 'run' : 'skip';
};

// Runs the rewrite of `[cond] Go+` once per case under `lua` with stub GetVar/GlobalVars/Cmd.
function luaSays(cond, cases) {
  const rw = V.bracketLineToLua(`[${cond}] Go+`);
  const lit = (v) => (v === undefined ? 'nil' : JSON.stringify(v));
  const script = [
    'local vars',
    'function GlobalVars() return "g" end',
    'function UserVars() return "u" end',
    'function GetVar(_, n) return vars[n] end',
    'local ran',
    'function Cmd() ran = true end',
    `local cases = {${cases.map((c) => `{x=${lit(c.x)},y=${lit(c.y)}}`).join(',')}}`,
    'for _, c in ipairs(cases) do',
    '  vars = c; ran = false',
    `  ${rw.lua}`,
    '  io.write(ran and "1" or "0")',
    'end',
  ].join('\n');
  const r = run('lua', ['-'], script);
  assert.strictEqual(r.status, 0, `${cond}: ${r.stderr}\n${rw.lua}`);
  return [...r.stdout].map((ch) => (ch === '1' ? 'run' : 'skip'));
}

// Every case must match the console; a refused rewrite (null) is acceptable only where `mustRewrite` is false.
function compareToConsole(conds, cases, mustRewrite = true) {
  for (const cond of conds) {
    if (!V.bracketLineToLua(`[${cond}] Go+`)) {
      assert.ok(!mustRewrite, `${cond} was refused`);
      continue;
    }
    const got = luaSays(cond, cases);
    cases.forEach((c, i) => assert.strictEqual(got[i], consoleSays(cond, c), `[${cond}] with x=${JSON.stringify(c.x)} y=${JSON.stringify(c.y)}`));
  }
}
const ORDERINGS = ['<', '>', '<=', '>='];

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

test('conditions: the Lua number test is the console\'s (no hex, no exponent): the same run/skip as evalLine', (t) => {
  if (!have('lua')) return t.skip('no lua on the PATH');
  const numbers = ['5', '16', '1000', ' 5 ', '+5', '-5', '.5', '5.', '5.0', '05', '', undefined];
  // hex and exponent text: not a number on the console, so "0x10" == 16 is false and "1e3" > 5 is a text comparison
  const looksNumeric = ['0x10', '1e3', '1E3', '0x', '1e', '5e0', 'inf', 'nan', '1_0'];
  compareToConsole(['$x == 16', '$x == 5', '$x == 1000', '$x == 1e3', '$x == 0x10'], [...looksNumeric, ...numbers].map((x) => ({ x })));
  // an ordering of these is a text comparison on the console; where the text sorts below the number it skips
  const below = ['0x10', '1e3', '1E3', '0x', '1e', '1_0'];
  compareToConsole(['$x > 5', '$x >= 5', '5 < $x', '5 <= $x'], [...below, ...numbers].map((x) => ({ x })));
  // two variables: equal as numbers only when both pass the same test
  const pairs = [];
  for (const x of ['0x10', '16', '1e3', '1000', '5', '5.0', ' 5', undefined]) for (const y of ['0x10', '16', '1e3', '1000', '5', '5.0', undefined]) pairs.push({ x, y });
  compareToConsole(['$x == $y'], pairs);
  // not all skips: "16" still equals 16, "5" still equals "5.0"
  assert.deepStrictEqual(luaSays('$x == 16', [{ x: '0x10' }, { x: '16' }]), ['skip', 'run']);
  assert.deepStrictEqual(luaSays('$x == $y', [{ x: '0x10', y: '16' }, { x: '5', y: '5.0' }]), ['skip', 'run']);
});
