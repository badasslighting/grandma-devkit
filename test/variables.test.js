'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../lib/variables');
const { commandStrings, checkCommand } = require('../lib/conditions');
const { decode, macroKind, commandSegments, toRaw } = require('../lib/macroFiles');
const { scanFile, buildKnown, findAll, positionOf } = require('../lib/varIndex');

const vars = (o) => new Map(Object.entries(o).map(([k, v]) => [k.toUpperCase(), v]));
const names = (list) => list.map((o) => o.name);

test('scanCommand: refs outside quotes, refs inside quotes, and what SetVar defines', () => {
  const s = V.scanCommand('SetVar $a = 7', 'ma2');
  assert.deepStrictEqual(s.defs.map((d) => [d.name, d.scope, d.op, d.valueText]), [['a', 'global', 'set', '7']]);
  assert.deepStrictEqual(s.refs, []);
  const t = V.scanCommand('Label Macro $m $t$n "x$a"', 'ma2');
  assert.deepStrictEqual(names(t.refs), ['m', 't', 'n']);
  assert.deepStrictEqual(names(t.quoted), ['a']);
  assert.strictEqual('Label Macro $m'.slice(t.refs[0].start - 1, t.refs[0].start + t.refs[0].len), '$m');
  const u = V.scanCommand('SetUserVar $u = "a b"', 'ma2');
  assert.deepStrictEqual(u.defs.map((d) => [d.scope, d.valueText]), [['user', '"a b"']]);
  assert.strictEqual(V.scanCommand('SetVar $x =', 'ma2').defs[0].op, 'clear');
});

test('scanCommand: grandMA3 variable commands name the variable in quotes', () => {
  const s = V.scanCommand('SetUserVariable "color1" 11', 'ma3');
  assert.deepStrictEqual(s.defs.map((d) => [d.name, d.scope, d.form, d.valueText]), [['color1', 'user', 'name', '11']]);
  assert.strictEqual('SetUserVariable "color1" 11'.slice(s.defs[0].start, s.defs[0].start + s.defs[0].len), 'color1');
  assert.strictEqual(V.scanCommand('SetGlobalVariable "g" 3', 'ma3').defs[0].scope, 'global');
  // Lua-escaped quotes in a command string
  const e = V.scanCommand('SetUserVariable \\"c\\" 5', 'ma3');
  assert.strictEqual(e.defs[0].name, 'c');
  assert.strictEqual(e.defs[0].valueText, '5');
});

test('scanCommand: conditions and chains', () => {
  const s = V.scanCommand('[$a==1] Go+ Executor $e ; Label Macro 1 $t', 'ma2');
  assert.deepStrictEqual(s.refs.map((r) => [r.name, r.inCondition, r.part]), [['a', true, 0], ['e', false, 0], ['t', false, 1]]);
  assert.deepStrictEqual(V.splitChain('A ; "B ; C" ; D').map((p) => p.text.trim()), ['A', '"B ; C"', 'D']);
});

test('scanLua: API calls with literal names, comments skipped, command strings scanned', () => {
  const src = [
    "SetVar(GlobalVars(), 'color1', 5)",
    "local v = GetVar(UserVars(), 'color1')",
    "DelVar(UserVars(), 'old')",
    "-- GetVar(UserVars(), 'commented')",
    "gma.show.setvar('x', 1)",
    "local y = gma.user.getvar('$y')",
    'Cmd("Label Macro $m")',
  ].join('\n');
  const occ = V.scanLua(src, 'ma3', commandStrings);
  assert.deepStrictEqual(occ.map((o) => [o.name, o.kind, o.scope, o.api]), [
    ['color1', 'def', 'global', 'ma3'],
    ['color1', 'get', 'user', 'ma3'],
    ['old', 'del', 'user', 'ma3'],
    ['x', 'def', 'global', 'ma2'],
    ['y', 'get', 'user', 'ma2'],
    ['m', 'ref', 'unknown', 'command'],
  ]);
  for (const o of occ.filter((o) => o.api !== 'command')) assert.strictEqual(src.slice(o.start, o.start + o.len), o.name);
  assert.strictEqual(occ[4].dollarInName, true);
});

// ---- the verified grandMA2 condition behaviour, replayed (onPC 3.9.61.1, 2026-10-26) ---------------------------------

const V2 = vars({ DKV_x: 7, DKV_y: 1, DKV_z: 'abc', DKV_n61: 61, DKV_w: 5.5, DKV_s: 'a b', DKV_k: 'Macro', DKV_n: 10, DKV_n2: 9, DKV_u: 3, FADERPAGE: 1 });
const live = [
  // [condition, did the command run on the console]
  ['[$DKV_x==7]', true], ['[$DKV_x==8]', false],
  ['[$DKV_x==7 && $DKV_y==1]', true], ['[$DKV_x==7 && $DKV_y==2]', true], ['[$DKV_x==8 && $DKV_y==1]', false], ['[$DKV_y==2 && $DKV_x==7]', false],
  ['[$DKV_x==7 && $DKV_y==1 && $DKV_z==abd]', true],
  ['[$DKV_x==8 || $DKV_y==1]', false],
  ['[$DKV_x==7 and $DKV_y==2]', true], ['[$DKV_x==8 and $DKV_y==1]', false], ['[$DKV_x==7 or $DKV_y==2]', true], ['[$DKV_x==8 or $DKV_y==1]', false],
  ['[($DKV_x==7) && ($DKV_y==1)]', false], ['[$DKV_x]', false],
  ['[$DKV_x==7] [$DKV_y==1]', true], ['[$DKV_x==7][$DKV_y==1]', true], ['[$DKV_x==7] [$DKV_y==2]', false], ['[$DKV_x==8][$DKV_y==1]', true], ['[$DKV_x==7][$DKV_y==2]', false],
  ['[$DKV_x==7][$DKV_y==1][$DKV_z==abc]', true],
  ['[$DKV_s=="a b"]', true], ['[$DKV_s==a b]', false], ['[$DKV_z=="abc"]', true], ['[$DKV_z==abc]', true], ['[$DKV_z=="ABC"]', false],
  ['[$DKV_k==Macro]', true], ['[$DKV_k=="Macro"]', true],
  ['[$DKV_x>=7]', true], ['[$DKV_x<=6]', false], ['[$DKV_w>5]', true], ['[$DKV_w==5.5]', true], ['[$DKV_x==7.0]', true], ['[$DKV_x==07]', true],
  ['[$DKV_w>5.25]', true], ['[$DKV_w<5.75]', true], ['[$DKV_x+1==8]', false],
  ['[$DKV_x==$DKV_y]', false], ['[$DKV_x==$DKV_x]', true], ['[NOT $DKV_x==8]', false], ['[!($DKV_x==8)]', false],
  ['[1==1 && 2==2]', true], ['[1==1]', true], ['[$FADERPAGE==1]', true], ['[$DKV_nope==1]', false],
  ['[$DKV_n61>599]', false], ['[$DKV_n61<599]', true], ['[$DKV_n61>60]', true], ['[$DKV_n61==61.0]', true],
  ['[$DKV_n>$DKV_n2]', true], ['[$DKV_u==3]', true],
  ['[$DKV_z<abd]', true], ['[$DKV_z>abb]', true], ['[$DKV_z>abd]', false], ['[$DKV_z>5]', true], ['[$DKV_z<5]', false], ['[$DKV_x>abc]', false], ['[$DKV_x<abc]', true],
  ['[$DKV_z!=abd]', false], ['[$DKV_z!=abc]', true], ['[$DKV_x!=7]', true], ['[$DKV_x!=8]', false],
  ['[$DKV_z<>abd]', false], ['[$DKV_x=7]', false], ['[$DKV_x=>7]', false], ['[$DKV_x~=7]', false], ['[$DKV_x~=8]', false],
  ['[$DKV_x==7 ]', true], ['[$DKV_x == 7]', true], ['[$DKV_x ==7]', true],
  ['[$DKV_q=="a]b"]', false], ['[$DKV_q==a]b]', false],
];
test('grandMA2 conditions: the model agrees with every case checked on the console', () => {
  for (const [cond, ran] of live) assert.strictEqual(V.evalLine(`${cond} Label Macro 241 "hit"`, V2).runs, ran, cond);
});

test('grandMA2 conditions cover the whole ; chain, and names are not case-sensitive', () => {
  const r = V.evalLine('[$DKV_x==8] Label Macro 241 "hit" ; Label Macro 242 "hit"', V2);
  assert.strictEqual(r.runs, false);
  assert.strictEqual(r.command, 'Label Macro 241 "hit" ; Label Macro 242 "hit"');
  assert.strictEqual(V.evalLine('[$dkv_X==7] Go+', V2).runs, true);
  assert.strictEqual(V.evalLine('Go+', V2).runs, true);
});

test('compareValues: numbers as numbers, otherwise case-sensitive text; != is ==', () => {
  assert.strictEqual(V.compareValues('61', '<', '599'), true);
  assert.strictEqual(V.compareValues('abc', '<', 'abd'), true);
  assert.strictEqual(V.compareValues('abc', '==', 'ABC'), false);
  assert.strictEqual(V.compareValues('7', '!=', '7'), true);
});

// ---- expansion ----------------------------------------------------------------------------------------

test('expandCommand: outside quotes replaced, inside quotes per console, unset reported', () => {
  const m = vars({ a: 241, t: 'mm', n: 1 });
  assert.deepStrictEqual(V.expandCommand('Label Macro $a $t$n', m, 'ma2'), { text: 'Label Macro 241 mm1', problems: [] });
  const q2 = V.expandCommand('Label Macro 242 "x$a"', m, 'ma2');
  assert.strictEqual(q2.text, 'Label Macro 242 "x$a"');
  assert.match(q2.problems[0], /illegal name/);
  const q3 = V.expandCommand('Label Macro 242 "x$a"', new Map([['a', 241]]), 'ma3');
  assert.strictEqual(q3.text, 'Label Macro 242 "xa"');
  const u2 = V.expandCommand('Go+ $nope', m, 'ma2');
  assert.match(u2.problems[0], /Error #54/);
  assert.match(V.expandCommand('Go+ $nope', m, 'ma3').problems[0], /does not run/);
  assert.strictEqual(V.expandCommand('Label Macro 24$n $t', m, 'ma2').text, 'Label Macro 241 mm');
});

// ---- lint -----------------------------------------------------------------------------------------------

const lint = (text, target, known = new Map()) => {
  const s = V.scanCommand(text, target);
  const occ = V.flattenCommand(s, 0, 'command');
  return V.lintVariables(occ, { target, known }).map((f) => f.rule);
};
const known = (...defs) => new Map(defs.map(([name, scope]) => [V.keyOf(name, 'ma2'), [{ name, scope }]]));

test('lint: variable inside quotes, unset variable, system variables', () => {
  assert.deepStrictEqual(lint('Label Macro 1 "x$a"', 'ma2', known(['a', 'global'])), ['var-in-quotes']);
  assert.deepStrictEqual(lint('Go+ $nothere', 'ma2', known(['a', 'global'])), ['var-undefined']);
  assert.deepStrictEqual(lint('Go+ $FADERPAGE', 'ma2', known(['a', 'global'])), []);
  assert.deepStrictEqual(lint('Go+ $a', 'ma2', known(['a', 'global'])), []);
  assert.deepStrictEqual(lint('Go+ $FADERPAGE', 'ma3', new Map()), ['var-undefined']); // no system variables on grandMA3
  assert.deepStrictEqual(lint('Go+ $a', 'ma2', null), []); // no workspace knowledge: nothing to say
});

test('lint: values written without quotes', () => {
  assert.deepStrictEqual(lint('SetVar $k = Macro', 'ma2'), ['var-value-unquoted']);
  assert.deepStrictEqual(lint('SetVar $k = a b', 'ma2'), ['var-value-unquoted']);
  assert.deepStrictEqual(lint('SetVar $k = "a b"', 'ma2'), []);
  assert.deepStrictEqual(lint('SetVar $k = 7', 'ma2'), []);
  assert.deepStrictEqual(lint('SetVar $k = abcdefg', 'ma2'), []);
  assert.deepStrictEqual(lint('SetVar $k = COL', 'ma2'), ['var-value-unquoted']);
  assert.deepStrictEqual(lint('SetUserVariable "k" a b', 'ma3'), ['var-value-unquoted']);
});

test('lint: a chain that uses a variable set earlier in it', () => {
  const k = known(['b', 'global']);
  assert.deepStrictEqual(lint('SetVar $b = 1 ; Go+ Executor $b', 'ma2', k), ['var-chain']);
  assert.deepStrictEqual(lint('SetVar $b = 1', 'ma2', k), []);
  assert.deepStrictEqual(lint('Go+ Executor $b ; SetVar $b = 1', 'ma2', k), []);
});

test('lint: grandMA3 names are case-sensitive', () => {
  const k = new Map([[V.keyOf('Color1', 'ma3'), [{ name: 'Color1', scope: 'user' }]]]);
  const out = (text) => {
    const occ = V.flattenCommand(V.scanCommand(text, 'ma3'), 0, 'command');
    return V.lintVariables(occ, { target: 'ma3', known: k });
  };
  const f = out('Go+ $color1');
  assert.deepStrictEqual(f.map((x) => x.rule), ['var-case']);
  assert.strictEqual(f[0].fix.text, 'Color1');
  assert.deepStrictEqual(out('Go+ $Color1'), []);
});

test('lint: Lua API scope, $ in a name, user and global with one name', () => {
  const run = (src, target, known) => {
    const occ = V.scanLua(src, target, commandStrings);
    return V.lintVariables(occ, { target, known }).map((f) => f.rule);
  };
  const k = new Map([[V.keyOf('u', 'ma2'), [{ name: 'u', scope: 'user' }]], [V.keyOf('g', 'ma2'), [{ name: 'g', scope: 'global' }]]]);
  assert.deepStrictEqual(run("local a = gma.show.getvar('u')", 'ma2', k), ['var-scope']);
  assert.deepStrictEqual(run("local a = gma.user.getvar('g')", 'ma2', k), ['var-scope']);
  assert.deepStrictEqual(run("local a = gma.user.getvar('u')", 'ma2', k), []);
  assert.deepStrictEqual(run("local a = gma.show.getvar('VERSION')", 'ma2', k), []);
  assert.deepStrictEqual(run("local a = gma.show.getvar('$g')", 'ma2', k), ['var-dollar-in-api']);
  assert.deepStrictEqual(run("SetVar(UserVars(), 'x', 1)\nSetVar(GlobalVars(), 'x', 2)", 'ma3', new Map()), ['var-shadow', 'var-shadow']);
});

// ---- conditions.js rules that came from the live checks ---------------------------------------------------------

test('conditions: logic, unsupported syntax, stacked brackets, a bracket in quotes, != and no operator', () => {
  const check = (t) => checkCommand(t, 'ma2').map((f) => f.rule);
  assert.deepStrictEqual(check('[$a==1 && $b==2] Go+'), ['bracket-logic']);
  assert.deepStrictEqual(check('[$a==1 or $b==2] Go+'), ['bracket-logic']);
  assert.deepStrictEqual(check('[$a==1 || $b==2] Go+'), ['bracket-logic']);
  assert.deepStrictEqual(check('[NOT $a==1] Go+'), ['bracket-unsupported']);
  assert.deepStrictEqual(check('[($a==1)] Go+'), ['bracket-unsupported']);
  assert.deepStrictEqual(check('[$a+1==2] Go+'), ['bracket-unsupported']);
  assert.deepStrictEqual(check('[$a==1] [$b==2] Go+'), ['bracket-stacked']);
  assert.deepStrictEqual(check('[$a=="x]y"] Go+'), ['bracket-quote']);
  assert.deepStrictEqual(check('[$a!=1] Go+'), ['bracket-operator']);
  assert.match(checkCommand('[$a!=1] Go+', 'ma2')[0].message, /read as "=="/);
  assert.deepStrictEqual(check('[$a] Go+'), ['bracket-no-operator']);
  assert.deepStrictEqual(check('[$a==-1] Go+'), []);
  assert.deepStrictEqual(check('[$a=="a - b"] Go+'), []);
});

// ---- ranges ---------------------------------------------------------------------------------------------

test('parseRange and templates', () => {
  const r = V.parseRange('$color1 thru $color5');
  assert.deepStrictEqual([r.prefix, r.from, r.to, r.names], ['color', 1, 5, ['color1', 'color2', 'color3', 'color4', 'color5']]);
  assert.deepStrictEqual(V.parseRange('color01..color03').names, ['color01', 'color02', 'color03']);
  assert.deepStrictEqual(V.parseRange('$c1 Thru 3').names, ['c1', 'c2', 'c3']);
  assert.deepStrictEqual(V.parseRange('$a2 - $a4').names, ['a2', 'a3', 'a4']);
  assert.match(V.parseRange('$a1 thru $b5').error, /share one name/);
  assert.match(V.parseRange('$a5 thru $a1').error, /backwards/);
  assert.match(V.parseRange('nonsense').error, /Write a range/);
  assert.strictEqual(V.applyTemplate('hue{n}', 3, 2), 'hue3');
  assert.strictEqual(V.applyTemplate('hue{n+10}', 3, 2), 'hue13');
  assert.strictEqual(V.applyTemplate('hue{n:3}', 3, 2), 'hue003');
  assert.strictEqual(V.applyTemplate('hue{i+1}', 3, 2), 'hue3');
});

test('planRangeRename: every variable of the range in every form, nothing else', () => {
  const apply = (src, edits) => {
    let out = src;
    for (const e of edits.slice().sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.newText + out.slice(e.start + e.len);
    return out;
  };
  const range = V.parseRange('$color1 thru $color5');
  const macro = ['SetVar $color1 = 5', 'Go+ Executor $color2', 'Label Macro 1 $color3 ; Go+ $COLOR4', 'Go+ $color5 $color6 $colorx $other1'].join('\n');
  const m = scanFile(macro, 'a.gma2macro', 'gma2macro');
  const plan = V.planRangeRename(m.occ, range, '$hue{n}', 'ma2');
  assert.strictEqual(plan.error, undefined);
  assert.strictEqual(apply(macro, plan.edits), ['SetVar $hue1 = 5', 'Go+ Executor $hue2', 'Label Macro 1 $hue3 ; Go+ $hue4', 'Go+ $hue5 $color6 $colorx $other1'].join('\n'));
  const lua = ["Cmd('Label Macro 2 $color2')", "SetVar(UserVars(), 'color3', 9)", "local v = gma.show.getvar('COLOR1')"].join('\n');
  const occ = V.scanLua(lua, 'ma2', commandStrings);
  assert.strictEqual(apply(lua, V.planRangeRename(occ, range, '$hue{n}', 'ma2').edits), ["Cmd('Label Macro 2 $hue2')", "SetVar(UserVars(), 'hue3', 9)", "local v = gma.show.getvar('hue1')"].join('\n'));
  const bad = V.planRangeRename(occ, V.parseRange('$color1 thru $color5'), '$hue', 'ma2');
  assert.match(bad.error, /same name/);
  assert.match(V.planRangeRename(occ, V.parseRange('$color1 thru $color5'), '$1{n}', 'ma2').error, /not a valid variable name/);
});

test('planRangeRename: grandMA3 keeps the case of the match exact', () => {
  const occ = V.flattenCommand(V.scanCommand('Go+ $Color1 $color1', 'ma3'), 0, 'command');
  const plan = V.planRangeRename(occ, V.parseRange('color1 thru color2'), 'x{n}', 'ma3');
  assert.strictEqual(plan.edits.length, 1);
  assert.strictEqual(plan.edits[0].start, 'Go+ $Color1 $'.length);
});

test('planInline: values that would be read differently are refused', () => {
  const occ = V.flattenCommand(V.scanCommand('Go+ Executor $e ; Label Macro $e "x"', 'ma2'), 0, 'command');
  const ok = V.planInline(occ, 'E', '1.3', 'ma2');
  assert.deepStrictEqual(ok.edits.map((e) => [e.start, e.len, e.newText]), [[17, 2, '1.3'], [36, 2, '1.3']].map(([s, l, t], i) => [ok.edits[i].start, l, t]));
  assert.match(V.planInline(occ, 'e', 'a b', 'ma2').error, /spaces/);
  assert.match(V.planInline(occ, 'e', 'Macro', 'ma2').error, /command word/);
});

// ---- converting -------------------------------------------------------------------------------------------

test('convertCommand and convertLua', () => {
  assert.strictEqual(V.convertCommand('SetVar $x = 7', 'ma2', 'ma3').text, 'SetGlobalVariable "x" 7');
  assert.strictEqual(V.convertCommand('SetUserVar $x = abc', 'ma2', 'ma3').text, 'SetUserVariable "x" "abc"');
  assert.match(V.convertCommand('SetVar $x =', 'ma2', 'ma3').notes[0], /DelVar\(GlobalVars\(\), "x"\)/);
  assert.match(V.convertCommand('AddVar $x = 1', 'ma2', 'ma3').notes[0], /no grandMA3 counterpart/);
  assert.strictEqual(V.convertCommand('SetUserVariable "x" 7', 'ma3', 'ma2').text, 'SetUserVar $x = 7');
  assert.strictEqual(V.convertCommand('SetGlobalVariable "x" "a b"', 'ma3', 'ma2').text, 'SetVar $x = "a b"');
  assert.strictEqual(V.convertCommand('Go+ Executor $x', 'ma3', 'ma2').text, 'Go+ Executor $x');
  const lua2 = "local a = gma.show.getvar('x')\ngma.user.setvar('y', 2)";
  assert.strictEqual(V.convertLua(lua2, 'ma2', 'ma3').text, "local a = GetVar(GlobalVars(), 'x')\nSetVar(UserVars(), 'y', 2)");
  const lua3 = "local a = GetVar(GlobalVars(), 'x')\nSetVar(UserVars(), 'y', 2)\nDelVar(UserVars(), 'y')";
  assert.strictEqual(V.convertLua(lua3, 'ma3', 'ma2').text, "local a = gma.show.getvar('x')\ngma.user.setvar('y', 2)\ngma.cmd(\"SetUserVar $y =\")");
  assert.match(V.convertLua("GetVar(PluginVars('p'), 'x')", 'ma3', 'ma2').notes[0], /no plugin or addon/);
  assert.strictEqual(V.convertLua('-- gma.show.getvar(\'x\')', 'ma2', 'ma3').text, "-- gma.show.getvar('x')");
});

test('bracket conditions become Lua ifs', () => {
  assert.deepStrictEqual(V.bracketLineToLua('[$x==5] Off Page 3'), { lua: 'if GetVar(GlobalVars(), "x") == 5 then Cmd("Off Page 3") end' });
  assert.deepStrictEqual(V.bracketLineToLua('[$x>=5] Go+', (n) => (n === 'x' ? 'user' : 'global')), { lua: 'if GetVar(UserVars(), "x") >= 5 then Cmd("Go+") end' });
  assert.deepStrictEqual(V.bracketLineToLua('[$s=="yes"] Label Macro 1 "a"'), { lua: 'if GetVar(GlobalVars(), "s") == "yes" then Cmd("Label Macro 1 \\"a\\"") end' });
  assert.strictEqual(V.bracketLineToLua('[$a==1 && $b==2] Go+'), null);
  assert.strictEqual(V.bracketLineToLua('Go+'), null);
  assert.strictEqual(V.conditionToLua('$a!=1'), 'GetVar(GlobalVars(), "a") == 1'); // != is read as == on grandMA2
});

// ---- live values ------------------------------------------------------------------------------------------

test('parseListVar reads the console reply, system variables marked', () => {
  const reply = ['Executing : ListVar', 'Global : $HOSTSUBTYPE = onPC', 'Global : $PATH = C:/ProgramData/MA Lighting Technologies/grandma/gma2_V_3.9.61', 'Global : $SHOWFILE = testshow', 'Global : $DKV_X = 7', 'User : $DKV_U = a b', 'Global : $EMPTY = '];
  const v = V.parseListVar(reply);
  assert.deepStrictEqual(v.map((x) => [x.scope, x.name, x.value, x.system]), [
    ['global', 'HOSTSUBTYPE', 'onPC', true],
    ['global', 'PATH', 'C:/ProgramData/MA Lighting Technologies/grandma/gma2_V_3.9.61', true],
    ['global', 'SHOWFILE', 'testshow', true],
    ['global', 'DKV_X', '7', false],
    ['user', 'DKV_U', 'a b', false],
    ['global', 'EMPTY', '', false],
  ]);
  assert.strictEqual(Object.keys(V.MA2_SYSTEM_VARS).length, 26);
  // the same reply twice (another Telnet session was listing at the same time)
  assert.strictEqual(V.parseListVar(['Global : $A = 1', 'Global : $A = 1', 'User : $A = 2']).length, 2);
});

test('parseVarValues, set and clear builders', () => {
  assert.deepStrictEqual(V.parseVarValues('global|a|number|7;;;user|b|string|x y'), [
    { scope: 'global', name: 'a', type: 'number', value: '7' },
    { scope: 'user', name: 'b', type: 'string', value: 'x y' },
  ]);
  assert.deepStrictEqual(V.parseVarValues(''), []);
  assert.strictEqual(V.ma3SetLua('user', 'x', '7'), 'SetVar(UserVars(), "x", 7)\nreturn "ok"');
  assert.strictEqual(V.ma3SetLua('global', 'x', 'a "b"'), 'SetVar(GlobalVars(), "x", "a \\"b\\"")\nreturn "ok"');
  assert.strictEqual(V.ma3SetLua('user', 'x', null), 'DelVar(UserVars(), "x")\nreturn "ok"');
  assert.throws(() => V.ma3SetLua('user', 'x"; os.exit() --', 1), /Not a variable name/);
  assert.strictEqual(V.ma2SetCommand('global', 'x', '7'), 'SetVar $x = 7');
  assert.strictEqual(V.ma2SetCommand('user', 'x', 'a b'), 'SetUserVar $x = "a b"');
  assert.strictEqual(V.ma2SetCommand('user', 'x', null), 'SetUserVar $x =');
  assert.match(V.ma3VarsLua(['a', 'b c', 'd']), /\{"a","d"\}/);
  assert.match(V.ma2VarsLua(['a']), /gma\.show\.getvar/);
});

test('snapshots: diff and the plan that restores one', () => {
  const before = [{ scope: 'global', name: 'a', value: '1' }, { scope: 'global', name: 'b', value: '2' }, { scope: 'global', name: 'TIME', value: '1' }];
  const after = [{ scope: 'global', name: 'A', value: '5' }, { scope: 'user', name: 'c', value: '3' }, { scope: 'global', name: 'TIME', value: '9' }];
  const d = V.diffVars(before, after, 'ma2');
  assert.deepStrictEqual(d.added.map((v) => v.name), ['c']);
  assert.deepStrictEqual(d.removed.map((v) => v.name), ['b']);
  assert.deepStrictEqual(d.changed.map((c) => [c.name, c.from, c.to]).slice(0, 1), [['A', '1', '5']]);
  const plan = V.restorePlan(before, after, 'ma2');
  assert.deepStrictEqual(plan.set.map((v) => [v.name, v.value]).sort(), [['A', '1'], ['b', '2']].sort());
  assert.deepStrictEqual(plan.clear.map((v) => v.name), ['c']);
});

// ---- macro files ----------------------------------------------------------------------------------------

test('XML entities decode with a map back to the file', () => {
  const d = decode('[$a==&quot;x&quot;] Go &amp; $b');
  assert.strictEqual(d.text, '[$a=="x"] Go & $b');
  assert.strictEqual(d.map.length, d.text.length + 1);
  assert.strictEqual('[$a==&quot;x&quot;] Go &amp; $b'.slice(d.map[d.text.indexOf('$b')]), '$b');
});

const MA2_XML = '<?xml version="1.0"?>\n<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" major_vers="3">\n\t<Macro index="1" name="m">\n\t\t<Macroline index="0">\n\t\t\t<text>[$tight==&quot;yes&quot;] Go+ Executor $e</text>\n\t\t</Macroline>\n\t\t<Macroline index="1">\n\t\t\t<text>SetVar $e = 3</text>\n\t\t</Macroline>\n\t</Macro>\n</MA>\n';
const MA3_XML = '<?xml version="1.0"?>\n<GMA3 DataVersion="2.5.1.0">\n\t<Macro Name="m" Index="1">\n\t\t<MacroLine Command="Label Group 1 &quot;A &amp; B&quot; $t" />\n\t\t<MacroLine Command="SetUserVariable &quot;t&quot; 5" Wait="1" />\n\t</Macro>\n</GMA3>\n';

test('macro files: kinds, segments and positions', () => {
  assert.deepStrictEqual(macroKind('a.gma2macro', ''), { kind: 'text', target: 'ma2' });
  assert.deepStrictEqual(macroKind('a.gma3macro', ''), { kind: 'text', target: 'ma3' });
  assert.deepStrictEqual(macroKind('a.xml', MA2_XML), { kind: 'xml', target: 'ma2' });
  assert.deepStrictEqual(macroKind('a.xml', MA3_XML), { kind: 'xml', target: 'ma3' });
  assert.strictEqual(macroKind('a.xml', '<root/>'), null);
  assert.strictEqual(macroKind('a.lua', ''), null);
  const x2 = commandSegments(MA2_XML, 'm.xml');
  assert.deepStrictEqual(x2.segments.map((s) => s.text), ['[$tight=="yes"] Go+ Executor $e', 'SetVar $e = 3']);
  const x3 = commandSegments(MA3_XML, 'm.xml');
  assert.deepStrictEqual(x3.segments.map((s) => s.text), ['Label Group 1 "A & B" $t', 'SetUserVariable "t" 5']);
  const t = commandSegments('# note\r\n@macro Name\r\n  [$a==1] Go+ $b\r\n\r\n// c\r\nSetVar $b = 2\r\n', 'm.gma2macro');
  assert.deepStrictEqual(t.segments.map((s) => s.text), ['[$a==1] Go+ $b', 'SetVar $b = 2']);
  const seg = x2.segments[0];
  const at = seg.text.indexOf('$e');
  const raw = toRaw(seg, at + 1, 1);
  assert.strictEqual(MA2_XML.slice(raw.start, raw.start + raw.len), 'e');
});

test('scanFile: macro lines give occurrences at the right place in the file, and the command-line findings', () => {
  const s = scanFile(MA2_XML, 'm.xml', 'xml');
  assert.strictEqual(s.kind, 'xml');
  assert.deepStrictEqual(s.occ.map((o) => [o.name, o.kind]), [['tight', 'ref'], ['e', 'ref'], ['e', 'def']]);
  for (const o of s.occ) assert.strictEqual(MA2_XML.slice(o.start, o.start + o.len), o.name);
  const s3 = scanFile(MA3_XML, 'm.xml', 'xml');
  assert.deepStrictEqual(s3.occ.map((o) => [o.name, o.kind]), [['t', 'ref'], ['t', 'def']]);
  for (const o of s3.occ) assert.strictEqual(MA3_XML.slice(o.start, o.start + o.len), o.name);
  const bad = scanFile('[$a==1 && $b==2] Go+\n[$c!=1] Go+\n', 'x.gma2macro', 'gma2macro');
  assert.deepStrictEqual(bad.issues.map((i) => i.rule), ['bracket-logic', 'bracket-operator']);
  assert.strictEqual(scanFile('x', 'x.txt', 'plaintext').kind, null);
  assert.deepStrictEqual(positionOf('ab\ncd\nef', 4), { line: 1, character: 1 });
});

test('the workspace index: definitions per console, occurrences across files', () => {
  const lua = scanFile("SetVar(GlobalVars(), 'Color1', 5)\nCmd('Go+ $Color1')", 'a.lua', 'lua', 'ma3');
  const mac = scanFile('SetUserVariable "Color1" 3\nGo+ $color1\n', 'b.gma3macro', 'gma3macro');
  const other = scanFile('SetVar $color1 = 3\n', 'c.gma2macro', 'gma2macro');
  const entries = [{ file: 'a.lua', scan: lua }, { file: 'b.gma3macro', scan: mac }, { file: 'c.gma2macro', scan: other }];
  const k3 = V.keyOf('Color1', 'ma3');
  assert.deepStrictEqual(buildKnown(entries, 'ma3').get(k3).map((d) => [d.file, d.scope]), [['a.lua', 'global'], ['b.gma3macro', 'user']]);
  assert.deepStrictEqual(buildKnown(entries, 'ma2').get(V.keyOf('color1', 'ma2')).map((d) => d.file), ['c.gma2macro']);
  assert.deepStrictEqual(findAll(entries, 'Color1', 'ma3').map((h) => [h.file, h.occ.kind]), [['a.lua', 'def'], ['a.lua', 'ref'], ['b.gma3macro', 'def']]);
  assert.strictEqual(findAll(entries, 'color1', 'ma2').length, 1);
});
