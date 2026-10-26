'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { commandStrings, parseBracket, checkCommand, afterCondition } = require('../lib/conditions');
const { suggestKeywords, conditionSuggestions, commandHover } = require('../lib/cmdContext');
const { lintRules } = require('../lib/rules');
const api = require('../data/api.json');

const rules = (src, target) => lintRules(src, api, { target }).map((f) => f.rule + '@' + f.line);
const check = (text, target, opts) => checkCommand(text, target, opts).map((f) => f.rule);

test('command strings: only the first argument of Cmd-like calls, comments and long strings skipped', () => {
  const src = ['Cmd("Go+ Sequence 1")', 'gma.cmd(\'[$a==1] Off\')', 'Printf("not a command")', '-- Cmd("commented")', 'Cmd([[long]])', 'Cmd("[$x==1] " .. rest)'].join('\n');
  const found = commandStrings(src);
  assert.deepStrictEqual(found.map((s) => s.text), ['Go+ Sequence 1', '[$a==1] Off', '[$x==1] ']);
  assert.deepStrictEqual(found.map((s) => s.dynamic), [false, false, true]);
  assert.strictEqual(src.slice(found[1].offset, found[1].offset + 3), '[$a');
});

test('parseBracket finds the condition, quotes and escapes included', () => {
  assert.deepStrictEqual(parseBracket('[$a==5] Off Page 3'), { start: 0, end: 6, expr: '$a==5', rest: ' Off Page 3' });
  assert.strictEqual(parseBracket('[$a=="x]"] Go').expr, '$a=="x]"');
  assert.strictEqual(parseBracket('[$a==\\"x]\\"] Go').end, 11);
  assert.strictEqual(parseBracket('[$a==5').end, -1);
  assert.strictEqual(parseBracket('Go+'), null);
  assert.strictEqual(afterCondition('[$a==5] Off'), ' Off');
  assert.strictEqual(afterCondition('[$a==5'), '[$a==5');
});

test('grandMA2 bracket conditions: valid ones pass, the rest are flagged', () => {
  for (const ok of ['[$v==5] Off Page 3', '[$v >= 5] Go+', '[$v<3]Go+', '[$v=="yes"] Delete Group Thru', '[$v==\\"yes\\"] Go+']) assert.deepStrictEqual(check(ok, 'ma2'), [], ok);
  assert.deepStrictEqual(check('[$v=5] Go+', 'ma2'), ['bracket-operator']);
  assert.deepStrictEqual(check('[$v!=5] Go+', 'ma2'), ['bracket-operator']);
  assert.deepStrictEqual(check('[$v<>5] Go+', 'ma2'), ['bracket-operator']);
  assert.deepStrictEqual(check('[$v] Go+', 'ma2'), ['bracket-no-operator']);
  assert.deepStrictEqual(check('[$v==5 Go+', 'ma2'), ['bracket-unclosed']);
  assert.deepStrictEqual(check('[] Go+', 'ma2'), ['bracket-empty']);
  assert.deepStrictEqual(check('[$v==5]', 'ma2'), ['bracket-no-command']);
  // the string is only the start of a longer command
  assert.deepStrictEqual(check('[$v==5] ', 'ma2', { dynamic: true }), []);
  assert.deepStrictEqual(check('[$v==', 'ma2', { dynamic: true }), []);
  // operator characters inside quotes are not operators
  assert.deepStrictEqual(check('[$v=="a=b"] Go+', 'ma2'), []);
});

test('grandMA3 does not run [condition] lines', () => {
  assert.deepStrictEqual(check('[$v==5] Go+', 'ma3'), ['bracket-ma3']);
  assert.deepStrictEqual(check('[$v==5] Go+', undefined), ['bracket-ma3']);
  assert.deepStrictEqual(check('Go+ Sequence 1', 'ma3'), []);
});

test('If is a filter: comparisons after it are flagged on both consoles, EndIf needs an If', () => {
  assert.deepStrictEqual(check('Store If Group 5 EndIf Preset 1.1', 'ma3'), []);
  assert.deepStrictEqual(check('Select Fixture 1 Thru 9 If Output', 'ma2'), []);
  assert.deepStrictEqual(check('If $v==1 Go+ Sequence 1', 'ma2'), ['if-not-branch']);
  assert.deepStrictEqual(check('If $v==1 Go+ Sequence 1', 'ma3'), ['if-not-branch']);
  assert.deepStrictEqual(check('If $v > 1 Go+', 'ma3'), ['if-not-branch']);
  assert.deepStrictEqual(check('Store If Group 5 EndIf Preset 1.1 $v==1', 'ma3'), []);
  assert.deepStrictEqual(check('Go+ EndIf', 'ma3'), ['endif-without-if']);
  assert.deepStrictEqual(check('[$a==1] Store If Group 5 EndIf Preset 1.1', 'ma2'), []);
  assert.match(checkCommand('If $v==1 Go+', 'ma2')[0].message, /square brackets/);
  assert.match(checkCommand('If $v==1 Go+', 'ma3')[0].message, /Lua/);
});

test('lintRules reports command-string findings at the right line and column', () => {
  const src = 'local x = 1\ngma.cmd("[$v=5] Go+")\nCmd("Go+")';
  const f = lintRules(src, api, { target: 'ma2' }).filter((x) => x.rule === 'bracket-operator');
  assert.deepStrictEqual(f.map((x) => [x.line, x.col, x.len]), [[1, 12, 1]]);
  assert.deepStrictEqual(rules('Cmd("[$v==1] Go+")', 'ma3'), ['bracket-ma3@0']);
  assert.deepStrictEqual(rules('Cmd("[$v==1] Go+")', 'ma2'), []);
  assert.deepStrictEqual(rules('-- Cmd("[$v==1] Go+")', 'ma3'), []);
});

test('MA2 getvar returns text: numeric comparison is flagged with a tonumber fix', () => {
  assert.deepStrictEqual(rules("if gma.show.getvar('n') == 5 then end", 'ma2'), ['getvar-number@0']);
  assert.deepStrictEqual(rules("if 5 < gma.show.getvar('n') then end", 'ma2'), ['getvar-number@0']);
  assert.deepStrictEqual(rules("if gma.show.getvar('n') == '5' then end", 'ma2'), []);
  assert.deepStrictEqual(rules("if tonumber(gma.show.getvar('n')) == 5 then end", 'ma2'), []);
  assert.deepStrictEqual(rules("local s = gma.show.getvar('n') .. 5", 'ma2'), []);
  assert.deepStrictEqual(rules("if gma.show.getvar('n') == 5 then end", 'ma3'), []);
  const f = lintRules("if gma.show.getvar('n') > 2 then end", api, { target: 'ma2' })[0];
  assert.deepStrictEqual([f.col, f.len, f.fix.text], [3, 20, "tonumber(gma.show.getvar('n'))"]);
});

test('completion: operators inside an open MA2 condition, keywords after it', () => {
  assert.strictEqual(conditionSuggestions('[$v', 'ma3'), null);
  assert.deepStrictEqual(conditionSuggestions('[', 'ma2'), []);
  assert.deepStrictEqual(conditionSuggestions('[$v', 'ma2').map((c) => c.name), ['==', '>', '<', '>=', '<=']);
  assert.deepStrictEqual(conditionSuggestions('[$v==5', 'ma2').map((c) => c.name), [']']);
  assert.strictEqual(conditionSuggestions('[$v==5] Go', 'ma2'), null);
  assert.strictEqual(suggestKeywords('[$v==5] ')[0].kind, 'verb');
  assert.strictEqual(suggestKeywords('Store If ')[0].kind, 'object');
  const names = suggestKeywords('Select Fixture 1 ').map((k) => k.name);
  for (const n of ['If', 'EndIf', 'IfOutput', 'IfActive', 'IfProg']) assert.ok(names.includes(n), n);
});

test('hover: If-family keywords and MA2 conditions inside a command string only', () => {
  const line = 'gma.cmd("Select Fixture 1 If Output")';
  const at = line.indexOf('If');
  assert.match(commandHover(line, at + 1, 'ma3').markdown, /Filter/);
  assert.strictEqual(commandHover(line, line.indexOf('Fixture'), 'ma3'), null);
  assert.strictEqual(commandHover('local If = 1', 2, 'ma3'), null);
  const cond = 'gma.cmd("[$myvar==5] Off")';
  assert.match(commandHover(cond, cond.indexOf('myvar'), 'ma2').markdown, /Condition/);
  assert.strictEqual(commandHover(cond, cond.indexOf('myvar'), 'ma3'), null);
  assert.strictEqual(commandHover(cond, cond.indexOf('Off'), 'ma2'), null);
});
