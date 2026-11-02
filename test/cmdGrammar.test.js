'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tokenize, checkGrammar, NEEDS_OBJECT } = require('../lib/cmdGrammar');
const grammar = require('../data/grammar.json');

const rules = (text, target) => checkGrammar(text, target).map((f) => f.rule);

test('tokenize: ranges, quotes, options, numbers, signs, Thru, separators and a leading condition', () => {
  const text = '[$a==1] Go+ Executor 1.5 + 2 Thru 4 "x y" /o /path="c:/a" ; Off';
  const t = tokenize(text);
  assert.deepStrictEqual(t.map((x) => x.type), ['condition', 'word', 'word', 'number', 'sign', 'number', 'word', 'number', 'quote', 'option', 'option', 'separator', 'word']);
  for (const x of t) assert.strictEqual(text.slice(x.start, x.end), x.text);
  assert.strictEqual(t[1].text, 'Go+');
  assert.deepStrictEqual(t.filter((x) => x.type === 'option').map((x) => x.name), ['o', 'path']);
  assert.deepStrictEqual(tokenize('Label Macro 1 \\"a b\\"').map((x) => x.type), ['word', 'word', 'number', 'quote']);
  assert.ok(tokenize('[$a==1 Go+')[0].open);
});

test('grammar-unknown-keyword: first word of each segment, nearest keyword, fix only when unique', () => {
  const f = checkGrammar('Storre Cue 1', 'ma2');
  assert.deepStrictEqual(f.map((x) => [x.rule, x.start, x.end, x.severity]), [['grammar-unknown-keyword', 0, 6, 'hint']]);
  assert.deepStrictEqual(f[0].fix, { kind: 'replace', text: 'Store' });
  assert.deepStrictEqual(rules('Go+ Executor 1 ; Fixtrue 3 At 50', 'ma2'), ['grammar-unknown-keyword']);
  assert.strictEqual(checkGrammar('Go+ ; Fixtrue 3', 'ma3')[0].start, 6);
  const none = checkGrammar('Qzx 1', 'ma3');
  assert.deepStrictEqual(none.map((x) => x.rule), ['grammar-unknown-keyword']);
  assert.strictEqual(none[0].fix, undefined);
  // names elsewhere, abbreviations, numbers, variables and quotes are not keywords to check
  for (const ok of ['Label Group 1 Front', 'Seq 3', 'Exec 1.1 At 50', 'G 1 At 50', '1 Thru 5 At 50', '$cmd', 'Go+ $Color1', 'go+ sequence 1', '"x"']) assert.deepStrictEqual(rules(ok, 'ma3'), [], ok);
});

test('grammar-other-console: only an exact keyword of the other console', () => {
  assert.deepStrictEqual(rules('SetVar $a = 1', 'ma3'), ['grammar-other-console']);
  assert.deepStrictEqual(rules('Patch Fixture 1', 'ma2'), ['grammar-other-console']);
  assert.match(checkGrammar('GoBack Sequence 1', 'ma3')[0].message, /grandMA2 keyword/);
  // a prefix of the other console's keyword is not an exact match
  assert.deepStrictEqual(rules('SetVa $a = 1', 'ma3'), ['grammar-unknown-keyword']);
  // Go+ / Go- are grandMA3-only in the data but valid grandMA2 commands
  assert.deepStrictEqual(rules('Go+ Executor 1', 'ma2'), []);
  assert.deepStrictEqual(rules('Go- Executor 1', 'ma2'), []);
});

test('grammar-unknown-option: checked against every keyword in the segment, abbreviations accepted', () => {
  assert.deepStrictEqual(rules('Store Cue 1 /zap', 'ma3'), ['grammar-unknown-option']);
  assert.deepStrictEqual(rules('Delete Cue 1 /bogus', 'ma2'), ['grammar-unknown-option']);
  const f = checkGrammar('Store Cue 1 /o /qq', 'ma3');
  assert.deepStrictEqual(f.map((x) => [x.rule, x.start, x.end]), [['grammar-unknown-option', 15, 18]]);
  for (const ok of ['Store Cue 1 /nc', 'Store Cue 1 /ka', 'Store Cue 1 /o /m', 'Store Cue 1 /cueonly=true', 'Delete Group 2 /noconfirm']) assert.deepStrictEqual(rules(ok, 'ma2'), [], ok);
  // a later keyword's options count (MA3 Update has no cueonly, Cue does)
  assert.deepStrictEqual(rules('Update Cue 3 /cueonly', 'ma3'), []);
  // no keyword with an option list, or free-form /property=value: not checked
  assert.deepStrictEqual(rules('Label Macro 1 "x" /whatever', 'ma3'), []);
  assert.deepStrictEqual(rules('Assign Executor 1 /priority=high', 'ma2'), []);
});

test('grammar-verb-no-object: allowlisted verbs with nothing but options after them', () => {
  for (const v of NEEDS_OBJECT) {
    assert.deepStrictEqual(rules(v, 'ma2'), ['grammar-verb-no-object'], v);
    assert.deepStrictEqual(rules(v, 'ma3'), ['grammar-verb-no-object'], v);
  }
  assert.deepStrictEqual(rules('Delete /nc', 'ma3'), ['grammar-verb-no-object']);
  assert.deepStrictEqual(rules('Go+ ; Copy', 'ma2'), ['grammar-verb-no-object']);
  // bare verbs that are valid, and verbs with something after them
  for (const ok of ['Store', 'Go+', 'Off', 'On', 'Kill', 'Toggle', 'Top', 'Update', 'Edit', 'Call', 'Delete Group 2', 'Label Macro $m', 'Del']) assert.deepStrictEqual(rules(ok, 'ma3'), [], ok);
});

test('the no-object allowlist matches the manual syntax on both consoles', () => {
  for (const id of ['ma2', 'ma3']) {
    for (const v of NEEDS_OBJECT) {
      const lines = grammar[id].keywords[v.toLowerCase()].syntaxText;
      assert.ok(lines.length, `${id} ${v}`);
      for (const l of lines) assert.match(l, new RegExp(`^${v}\\s+(?:Off\\s+)?["[]`), `${id} ${l}`);
    }
  }
});

test('grammar-thru-bare: Thru first in a segment or twice in a row', () => {
  assert.deepStrictEqual(rules('Thru 10', 'ma2'), ['grammar-thru-bare']);
  assert.deepStrictEqual(rules('Go+ ; Thru 10 At 50', 'ma3'), ['grammar-thru-bare']);
  const f = checkGrammar('Fixture 1 Thru Thru 5', 'ma3');
  assert.deepStrictEqual(f.map((x) => [x.rule, x.start]), [['grammar-thru-bare', 15]]);
  for (const ok of ['Fixture Thru 10', 'Fixture 1 Thru', 'Fixture 1 Thru 10', '[$v==1] Delete Group Thru']) assert.deepStrictEqual(rules(ok, 'ma2'), [], ok);
});

test('grammar-at-empty: At with nothing after it', () => {
  assert.deepStrictEqual(rules('Fixture 1 At', 'ma2'), ['grammar-at-empty']);
  assert.deepStrictEqual(rules('Fixture 1 At ; Go+', 'ma3'), ['grammar-at-empty']);
  for (const ok of ['Fixture 1 At 50', 'At Full', 'Copy Cue 1 At 2 /o', 'Copy Cue 1 At /o']) assert.deepStrictEqual(rules(ok, 'ma3'), [], ok);
});

test('dynamic or unfinished strings are not checked', () => {
  for (const s of ['Stroe Cue " .. n', 'Fixture 1 At ', 'Delete " .. obj', 'Stroe %d', 'Fixture 1 At ..', '[$x==1 Stroe']) assert.deepStrictEqual(rules(s, 'ma2'), [], s);
  assert.deepStrictEqual(checkGrammar('Stroe Cue 1', 'ma2', { dynamic: true }), []);
});

const MA2_VALID = [
  'Go+ Executor 1', 'Go+ Executor 1.5', 'Go- Executor 2', 'Go Executor 3 Cue 5', 'Goto Cue 5 Executor 1', 'GoBack Executor 1',
  'Go+ Sequence 1', 'Store Cue 3 /nc', 'Store Cue 3 /o', 'Store Cue 1 Sequence 5 /merge', 'Store Group 4 "Front Wash" /o',
  'Store Preset 4.1 /selective', 'Store Macro 7', 'Store Cue 1 /o /nc', 'Store Cue 2 /ka', 'Store', 'Select Fixture 1 Thru 10',
  'Fixture 1 Thru 10 + 15', 'Fixture 1 At 50', 'Fixture 1 Thru 4 At Preset 4.1', 'Channel 1 Thru 12 At Full', 'Group 3 At 75',
  'Delete Group 2 /nc', 'Delete Cue 5 Sequence 2 /noconfirm', 'Delete Cue 1 Thru 10 Sequence 5 /nc', 'Label Macro 5 "x"',
  'Label Executor 1.1 "Main"', 'Label Group 1 Thru 5 "Wash"', '[$a==1] Go+ Executor 1', '[$mode=="show"] Off Executor 1 Thru 10',
  'Off Executor 3', 'Off Page 2', 'On Executor 4', 'Call Plugin 2', 'Plugin 3', 'Macro 12', 'ClearAll', 'Clear', 'ClearSelection',
  'Blackout', 'Blind', 'Highlight', 'Freeze', 'Kill Executor 5', 'Toggle Executor 1.2', 'Flash Executor 3', 'Top Executor 1',
  'Pause Executor 1', 'Temp Executor 9', 'Swop Executor 4', 'Solo Executor 6', 'Learn Executor 1', 'SetVar $mode = "show"',
  'AddVar $count = 1', 'Page 2', 'Page +', 'Copy Cue 1 At Cue 2', 'Copy Group 1 At 5 /o', 'Move Group 2 At 10',
  'Assign Sequence 1 At Executor 1.1', 'Assign Macro 3 Executor 1.20', 'Appearance Macro 5 /r=100 /g=0 /b=0',
  'Export Macro 1 "macros"', 'Import "mymacros" At Macro 10', 'Preset 4.1', 'Executor 1.1 At 100', 'Cue 5', 'Park Fixture 1 Thru 5',
  'Unpark Fixture 1', 'Lua "gma.echo(1)"', 'Fixture 1 Thru 10 At 0 ; Go+ Executor 1', 'Fixture 1 ; Fixture 2 At 100',
  'Clear ; Clear ; Clear', 'Oops', 'Update Cue 3 /cueonly', 'Fade 3', 'Fixture 1 At Fade 3', 'Group 1 Thru 5', 'Fix Executor 1',
  'Lock Executor 1', 'Edit Macro 3', 'DefGoForward', 'Fixture Thru 10', 'Fixture 1 Thru', 'Exec 1.1 At 50', 'Go+', 'Go+ ; Go+',
  'Off', 'Kill', 'At 50', 'At Full', 'Full', 'Zero', 'Select Group 1', 'SelFix Group 1', '[$v>=5] Off Page 3', 'Go+ $Color1',
];

const MA3_VALID = [
  'Go+ Sequence 1', 'Go Sequence 2', 'Go- Sequence 1', 'Goto Cue 3 Sequence 1', 'Off Sequence 5', 'On Sequence 5', 'Kill Sequence 3',
  'Toggle Sequence 4', 'Flash Executor 201', 'Store Cue 3 /nc', 'Store Cue 3 /Merge', 'Store Cue 3 Sequence 1 /o',
  'Store Preset 4.1 /Selective', 'Store Group 3 /o', 'Store Macro 7 /o', 'Store Preset 1.5 /o /nc', 'Store Sequence 1 Cue 2 /cueonly',
  'Store Cue 1 Thru 5 /o', 'Store', 'Delete Group 2 /nc', 'Delete Cue 5 Sequence 2 /nc', 'Delete Preset 4.1 Thru 4.10 /nc',
  'Label Macro 5 "x"', 'Label Sequence 1 "Main"', 'Select Fixture 1 Thru 10', 'Fixture 1 At 50', 'Fixture 1 Thru 10 At Preset 4.1',
  'Group 3 At 75', 'Call Plugin 2', 'Plugin 3', 'Macro 12', 'ClearAll', 'Clear', 'ClearSelection', 'Blind', 'Highlight', 'Freeze',
  'Release Sequence 1', 'Park Fixture 1', 'Unpark Fixture 1', 'Copy Cue 1 At 2', 'Copy Group 1 At 5 /o', 'Copy Sequence 1 At 2 /m',
  'Move Group 2 At 10', 'Assign Sequence 1 At Page 1.201', 'Assign Appearance 3 At Macro 5', 'Export Macro 1 "macro"',
  'Import Macro Library "x.xml" At 10', 'Set Sequence 1 Property "Name" "Main"', 'SetUserVariable "mode" "show"',
  'SetGlobalVariable "x" 1', 'Page 2', 'Page +', 'Executor 201 At 100', 'Cue 5', 'Lua "Printf(1)"',
  'Fixture 1 Thru 10 At 0 ; Go+ Sequence 1', 'Oops', 'Update Cue 3 /cueonly', 'Edit Macro 3', 'Insert Cue 2.5', 'Fixture Thru 10',
  'Fixture 1 Thru', 'Temp Sequence 1', 'Solo Sequence 1', 'Pause Sequence 1', 'Rate1 Sequence 1', 'Speed1 Sequence 1',
  'Load Sequence 1 Cue 3', 'Go+', 'Go+ ; Go+', 'Off', 'Kill', 'At 50', 'At Full', 'Full', 'Zero', 'Clone Fixture 1 At 2 /o',
  '[$a==1] Go+ Sequence 1', 'Off Executor 3', 'Go+ Sequence 1 Cue 5', 'Fixture 1 + 3 At 100', 'Group 1 Thru 5', 'Top Sequence 1',
  'Swap Sequence 1', 'Learn Sequence 1', 'Programmer', 'Patch',
];

test('no false positives on realistic valid commands', () => {
  assert.ok(MA2_VALID.length >= 60 && MA3_VALID.length >= 60);
  for (const c of MA2_VALID) assert.deepStrictEqual(checkGrammar(c, 'ma2'), [], `ma2: ${c}`);
  for (const c of MA3_VALID) assert.deepStrictEqual(checkGrammar(c, 'ma3'), [], `ma3: ${c}`);
});
