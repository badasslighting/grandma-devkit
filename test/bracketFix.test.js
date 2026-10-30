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
  assert.strictEqual(fix('Cmd("[$x > 1] Go+ Executor 1")'), 'if GetVar(GlobalVars(), "x") > 1 then Cmd("Go+ Executor 1") end');
  assert.strictEqual(fix("  gma.cmd('[$v==5] Off Page 3')"), '  if GetVar(GlobalVars(), "v") == 5 then Cmd("Off Page 3") end');
  assert.strictEqual(fix('Cmd("[$s==\\"yes\\"] Label Macro 1 \\"a\\"")'), 'if GetVar(GlobalVars(), "s") == "yes" then Cmd("Label Macro 1 \\"a\\"") end');
  assert.strictEqual(fix('Cmd("[$x==5] Go+");  -- later'), 'if GetVar(GlobalVars(), "x") == 5 then Cmd("Go+") end -- later');
  assert.strictEqual(fix('Cmd("[$x>=5] Go+")', (n) => (n === 'x' ? 'user' : 'global')), 'if GetVar(UserVars(), "x") >= 5 then Cmd("Go+") end');
  assert.strictEqual(fix('Cmd("[$a==$b] Go+")'), 'if GetVar(GlobalVars(), "a") == GetVar(GlobalVars(), "b") then Cmd("Go+") end');
});

test('quick fix: a backslash in the command stays one backslash', () => {
  assert.strictEqual(fix('Cmd("[$x==1] Import \\"a\\\\b.xml\\"")'), 'if GetVar(GlobalVars(), "x") == 1 then Cmd("Import \\"a\\\\b.xml\\"") end');
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
    '$a=="x]y"', // the console ends the condition at the "]" inside the quotes
    '$a==1 junk',
  ]) assert.strictEqual(fix(`Cmd("[${c.replace(/"/g, '\\"')}] Go+")`), null, c);
  // a text value with == is fine; ordering two numbers is fine
  assert.strictEqual(fix('Cmd("[$a==yes] Go+")'), 'if GetVar(GlobalVars(), "a") == "yes" then Cmd("Go+") end');
  assert.strictEqual(fix('Cmd("[$a<2.5] Go+")'), 'if GetVar(GlobalVars(), "a") < 2.5 then Cmd("Go+") end');
});

test('quick fix: a "]" inside quotes after the condition is part of the command', () => {
  assert.strictEqual(fix('Cmd("[$a==1] Label Macro 1 \\"x]y\\"")'), 'if GetVar(GlobalVars(), "a") == 1 then Cmd("Label Macro 1 \\"x]y\\"") end');
});

test('conditionToLua: only a single plain comparison', () => {
  assert.strictEqual(V.conditionToLua('$a == 1'), 'GetVar(GlobalVars(), "a") == 1');
  assert.strictEqual(V.conditionToLua('$a==1 && $b==2'), null);
  assert.strictEqual(V.conditionToLua('$a!=1'), null);
  assert.strictEqual(V.conditionToLua('$SHOWFILE==x'), null);
});

test('decodeLuaString', () => {
  assert.strictEqual(decodeLuaString('a\\"b\\\\c\\\'d'), 'a"b\\c\'d');
  assert.strictEqual(decodeLuaString('a\\x41'), null);
  assert.strictEqual(decodeLuaString('a\\nb'), null); // a newline cannot be in a command
});
