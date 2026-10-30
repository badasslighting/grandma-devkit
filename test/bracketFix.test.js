'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bracketCallToLuaIf, decodeLuaString } = require('../lib/bracketFix');
const V = require('../lib/variables');

const fix = (line, scopeOf) => {
  const r = bracketCallToLuaIf(line, scopeOf);
  return r && r.text;
};

test('quick fix: a [condition] Cmd line becomes a Lua if', () => {
  assert.strictEqual(fix('Cmd("[$x > 1] Go+ Executor 1")'), 'do local v = tonumber((GetVar(GlobalVars(), "x"))); if v ~= nil and v > 1 then Cmd("Go+ Executor 1") end end');
  assert.strictEqual(fix("  gma.cmd('[$v==5] Off Page 3')"), '  do local v = tonumber((GetVar(GlobalVars(), "v"))); if v ~= nil and v == 5 then Cmd("Off Page 3") end end');
  assert.strictEqual(fix('Cmd("[$s==\\"yes\\"] Label Macro 1 \\"a\\"")'), 'do local v = GetVar(GlobalVars(), "s"); if v ~= nil and tostring(v) == "yes" then Cmd("Label Macro 1 \\"a\\"") end end');
  assert.strictEqual(fix('Cmd("[$x==5] Go+");  -- later'), 'do local v = tonumber((GetVar(GlobalVars(), "x"))); if v ~= nil and v == 5 then Cmd("Go+") end end -- later');
  assert.strictEqual(fix('Cmd("[$x>=5] Go+")', (n) => (n === 'x' ? 'user' : 'global')), 'do local v = tonumber((GetVar(UserVars(), "x"))); if v ~= nil and v >= 5 then Cmd("Go+") end end');
  assert.strictEqual(fix('Cmd("[$a==$b] Go+")'), 'do local v, w = GetVar(GlobalVars(), "a"), GetVar(GlobalVars(), "b"); if v ~= nil and w ~= nil and (tostring(v) == tostring(w) or tonumber(v) ~= nil and tonumber(v) == tonumber(w)) then Cmd("Go+") end end');
});

test('quick fix: a backslash in the command stays one backslash', () => {
  assert.strictEqual(fix('Cmd("[$x==1] Import \\"a\\\\b.xml\\"")'), 'do local v = tonumber((GetVar(GlobalVars(), "x"))); if v ~= nil and v == 1 then Cmd("Import \\"a\\\\b.xml\\"") end end');
});

test('quick fix: not offered where the line is not one whole Cmd call', () => {
  assert.strictEqual(fix('Cmd("[$x==1] Go+") Cmd("Go+")'), null); // two calls on a line must not be read as one string
  assert.strictEqual(fix('Cmd("[$x==1] Go+"); Cmd("Off")'), null);
  assert.strictEqual(fix('local ok = Cmd("[$x==1] Go+")'), null);
  assert.strictEqual(fix('Cmd("[$x==1] " .. rest)'), null);
  assert.strictEqual(fix('Cmd("[$x==1] Go+" .. rest)'), null);
  assert.strictEqual(fix('Cmd("Go+")'), null);
  assert.strictEqual(fix('Cmd("[$x==1] Go+", true)'), null);
  assert.strictEqual(fix('CmdIndirect("[$x==1] Go+")'), null);
  assert.strictEqual(fix('Cmd("[$x==1] Go\\z+")'), null); // an escape this does not read
  assert.strictEqual(fix('Cmd("[$x==1]")'), null); // nothing to run
  assert.strictEqual(fix('Cmd("[$x==1 Go+")'), null); // unclosed
});

test('quick fix: not offered where the condition cannot be translated safely', () => {
  for (const c of [
    '$a==1 && $b==2', '$a==1 || $b==2', '$a==1 and $b==2', '($a==1)', 'NOT $a==1', '$a+1==2', // grouped or unsupported
    '$a', '$a=1', '$a<>1', '$a~=1', '$a=>1', // no or unknown operator
    '$a!=1', // grandMA2 reads it as ==; the user decides
    '$HOSTTYPE=="Console"', '$time==1', // grandMA2 system variable: GetVar cannot read it on grandMA3
    '$a=="5"', // grandMA2 compares a quoted number as a number
    '$a<"x"', // Lua raises an error on number < text
    '$a<$b', '$a>=$b', // both types unknown: Lua raises an error on number < text
    '$a=="x]y"', // the console ends the condition at the "]" inside the quotes
    '$a==1 junk',
  ]) assert.strictEqual(fix(`Cmd("[${c.replace(/"/g, '\\"')}] Go+")`), null, c);
  // a text value with == is fine; ordering two numbers is fine
  assert.strictEqual(fix('Cmd("[$a==yes] Go+")'), 'do local v = GetVar(GlobalVars(), "a"); if v ~= nil and tostring(v) == "yes" then Cmd("Go+") end end');
  assert.strictEqual(fix('Cmd("[$a<2.5] Go+")'), 'do local v = tonumber((GetVar(GlobalVars(), "a"))); if v ~= nil and v < 2.5 then Cmd("Go+") end end');
});

test('quick fix: a "]" inside quotes after the condition is part of the command', () => {
  assert.strictEqual(fix('Cmd("[$a==1] Label Macro 1 \\"x]y\\"")'), 'do local v = tonumber((GetVar(GlobalVars(), "a"))); if v ~= nil and v == 1 then Cmd("Label Macro 1 \\"x]y\\"") end end');
});

test('conditionToLua: only a single plain comparison', () => {
  assert.deepStrictEqual(V.conditionToLua('$a == 1'), { pre: 'local v = tonumber((GetVar(GlobalVars(), "a")))', test: 'v ~= nil and v == 1' });
  assert.strictEqual(V.conditionToLua('$a==1 && $b==2'), null);
  assert.strictEqual(V.conditionToLua('$a!=1'), null);
  assert.strictEqual(V.conditionToLua('$SHOWFILE==x'), null);
});

test('decodeLuaString', () => {
  assert.strictEqual(decodeLuaString('a\\"b\\\\c\\\'d'), 'a"b\\c\'d');
  assert.strictEqual(decodeLuaString('a\\x41'), null);
  assert.strictEqual(decodeLuaString('a\\nb'), null); // a newline cannot be in a command
});

test('conditionToLua: an unset or text variable skips the branch instead of raising a Lua error', () => {
  // grandMA2 makes the comparison false; a bare GetVar(...) > 1 is "attempt to compare nil with number" when unset
  const gt = V.conditionToLua('$x > 1');
  assert.strictEqual(gt.pre, 'local v = tonumber((GetVar(GlobalVars(), "x")))'); // text "abc" -> nil, "5" -> 5
  assert.strictEqual(gt.test, 'v ~= nil and v > 1'); // unset -> nil -> skipped
  assert.strictEqual(V.conditionToLua('3 < $x').test, 'v ~= nil and 3 < v');
  // [$x == 5] is numeric on grandMA2 even when x holds "5"
  assert.strictEqual(V.conditionToLua('$x == 5').pre, 'local v = tonumber((GetVar(GlobalVars(), "x")))');
  // text and variable-to-variable equality: unset skips, numbers compare as numbers
  assert.strictEqual(V.conditionToLua('$s == yes').test, 'v ~= nil and tostring(v) == "yes"');
  assert.match(V.conditionToLua('$a == $b').test, /^v ~= nil and w ~= nil and /);
  assert.strictEqual(V.conditionToLua('1 < 2').pre, ''); // no variable: nothing to guard
  assert.strictEqual(V.conditionToLua('$a < $b'), null);
});

test('quick fix: the result is one statement even with a local (a do block), so it can replace the line', () => {
  const r = fix('Cmd("[$x > 1] Go+")');
  assert.ok(r.startsWith('do local v = ') && r.endsWith(' end end'), r);
  assert.strictEqual(fix('Cmd("[1 < 2] Go+")'), 'if 1 < 2 then Cmd("Go+") end');
});

test('conditions: a backslash in a text value is escaped for the Lua string', () => {
  assert.strictEqual(V.conditionToLua('$x==a\\b').test, 'v ~= nil and tostring(v) == "a\\\\b"');
  assert.strictEqual(V.conditionToLua('"a\\b"==$x').test, 'v ~= nil and "a\\\\b" == tostring(v)');
});

test('bracketLineToLua: a second [condition] that the first-"]" scan cannot size is refused', () => {
  // the "]" inside the quotes ends the bracket for the loop but not for parseBracket: grandMA2 would read it differently
  assert.strictEqual(V.bracketLineToLua('[$a==1] [$b=="x]y"] Go+'), null);
  // two plain brackets are fine: the last one counts
  assert.ok(V.bracketLineToLua('[$a==1] [$b==2] Go+').lua.includes('"b"'));
});
