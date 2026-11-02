'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractRefs, checkShowRefs, RANGE_CAP } = require('../lib/showRefs');
const { parseShow, isTruncated, showLua, CAP } = require('../lib/showCache');
const { ma2ShowLua } = require('../lib/ma2Objects');
const { lintRules } = require('../lib/rules');

// A show as parseShow returns it: Macro 1, 11, 13; Group 1 Front, 2 Back; Sequence 1; Preset 2.4, 2.6; Plugin 3.
const SHOW = parseShow(['"Macro|1|Intro ;; Macro|11|Blue ;; Macro|13|Red ;; Group|1|Front ;; Group|2|Back ;; Sequence|1|Main ;; Preset|2.4|Warm ;; Preset|2.6|Cold ;; Plugin|3|Tool"']);
const refs = (c, t = 'ma3') => extractRefs(c, t).map((r) => [r.kind, r.no !== undefined ? r.no : r.name, r.verb]);
const check = (c, show = SHOW, t = 'ma3') => checkShowRefs(c, t, show);
const messages = (c, show) => check(c, show).map((f) => f.message);

test('extractRefs: verbs, bare objects, spans, lists with + and several segments', () => {
  const c = 'Off Sequence 1 ; Go+ Macro 12 + 13';
  const r = extractRefs(c, 'ma3');
  assert.deepStrictEqual(r.map((x) => [x.kind, x.no, x.verb]), [['Sequence', '1', 'Off'], ['Macro', '12', 'Go+'], ['Macro', '13', 'Go+']]);
  for (const x of r) assert.strictEqual(c.slice(x.start, x.end), x.no);
  assert.deepStrictEqual(refs('Macro 5'), [['Macro', '5', null]]);
  assert.deepStrictEqual(refs('Goto Cue 3 Sequence 4'), [['Sequence', '4', 'Goto']]);
  assert.deepStrictEqual(refs('Layout 4', 'ma2'), [], 'a bare Layout is not a known default action');
  assert.deepStrictEqual(refs('Select Layout 4'), [['Layout', '4', 'Select']]);
  assert.deepStrictEqual(refs('[$a==1] Kill Group 2', 'ma2'), [['Group', '2', 'Kill']]);
});

test('extractRefs: Thru ranges expand, share one span, and stop at RANGE_CAP', () => {
  const r = extractRefs('Delete Macro 3 Thru 6 /nc', 'ma3');
  assert.deepStrictEqual(r.map((x) => x.no), ['3', '4', '5', '6']);
  assert.ok(r.every((x) => x.start === 13 && x.end === 21 && x.range === r[0].range && !x.range.capped));
  assert.deepStrictEqual(refs('Group 5 Thru Group 3').map((x) => x[1]), ['3', '4', '5']);
  assert.deepStrictEqual(refs('Delete Preset 2.8 Thru 2.10').map((x) => x[1]), ['2.8', '2.9', '2.10']);
  assert.deepStrictEqual(refs('Delete Preset 2.8 Thru 3.1'), [], 'a range across preset types is not expanded');
  const big = extractRefs('Delete Macro 1 Thru 1000', 'ma3');
  assert.strictEqual(big.length, RANGE_CAP);
  assert.ok(big[0].range.capped);
  // open ranges are not references to check
  assert.deepStrictEqual(refs('Delete Macro 1 Thru'), []);
  assert.deepStrictEqual(refs('Delete Macro Thru 5'), []);
});

test('extractRefs: presets need type.number, quoted names, other numbers are not literal', () => {
  assert.deepStrictEqual(refs('Preset 2.5'), [['Preset', '2.5', null]]);
  assert.deepStrictEqual(refs('Fixture 1 Thru 4 At Preset 2.5'), [['Preset', '2.5', null]]);
  assert.deepStrictEqual(refs('Preset 2'), []);
  assert.deepStrictEqual(refs('Group "Front" + "Side"'), [['Group', 'Front', null], ['Group', 'Side', null]]);
  assert.deepStrictEqual(refs('Group \\"Front\\"'), [['Group', 'Front', null]]);
  assert.deepStrictEqual(refs('Group "Fr*"'), [], 'wildcard names are not checked');
  for (const c of ['Go+ Macro $m', 'Go+ Sequence 1.5', 'Macro', 'Group Front']) assert.deepStrictEqual(refs(c), [], c);
});

test('checkShowRefs: a missing number is a hint with its span and the nearest existing numbers', () => {
  const f = check('Go+ Macro 12');
  assert.deepStrictEqual(f, [{ start: 10, end: 12, message: 'Macro 12 is not in the loaded show (nearest: 11, 13).', rule: 'show-missing-object', severity: 'hint' }]);
  assert.deepStrictEqual(messages('Off Sequence 7'), ['Sequence 7 is not in the loaded show (nearest: 1).']);
  assert.deepStrictEqual(messages('Macro 50'), ['Macro 50 is not in the loaded show.']);
  assert.deepStrictEqual(messages('Fixture 1 At Preset 2.5'), ['Preset 2.5 is not in the loaded show (nearest: 2.4, 2.6).']);
  for (const ok of ['Go+ Macro 11', 'Off Sequence 1', 'Group 1 + 2 At 50', 'Preset 2.6', 'Call Plugin 3']) assert.deepStrictEqual(check(ok), [], ok);
});

test('checkShowRefs: a range is flagged only when none of it exists', () => {
  assert.deepStrictEqual(messages('Delete Macro 20 Thru 30 /nc'), ['Macro 20 Thru 30: none of these are in the loaded show.']);
  assert.deepStrictEqual(check('Delete Macro 1 Thru 100 /nc'), []);
  assert.deepStrictEqual(check('Macro 10 Thru 12'), []);
  // longer than RANGE_CAP: not all numbers were looked at
  assert.deepStrictEqual(check('Delete Macro 300 Thru 900'), []);
});

test('safety (a): verbs that create or define the object are never flagged (G3)', () => {
  const empty = parseShow(['"Macro|1|x ;; Group|2|y ;; Plugin|1|z ;; Sequence|1|s ;; Preset|1.1|p"']);
  for (const c of ['Store Macro 99', 'Copy Group 1 At 50', 'Import Plugin 3', 'Store Macro 99 /o', 'Copy Group 3 At 50 /o', 'Move Group 3 At 9', 'Label Macro 50 "New"',
    'Appearance Macro 50 /r=100', 'Assign Sequence 9 At Page 1.201', 'Edit Macro 77', 'Clone Group 7 At 8', 'Import "x" At Macro 10', 'Store Cue 1 Sequence 9',
    'Insert Cue 2 Sequence 9', 'Fixture 1 Thru 4 Store Group 9']) {
    assert.deepStrictEqual(checkShowRefs(c, 'ma3', empty), [], c);
    assert.deepStrictEqual(checkShowRefs(c, 'ma2', empty), [], `ma2 ${c}`);
  }
  // the same numbers are flagged by a verb that needs them
  assert.deepStrictEqual(checkShowRefs('Go+ Macro 99 ; Select Group 50 ; Call Plugin 3', 'ma3', empty).map((f) => f.rule), Array(3).fill('show-missing-object'));
});

test('safety (a): after At, only a preset applied to a selection is checked', () => {
  assert.deepStrictEqual(check('Group 1 At Group 40'), []);
  assert.deepStrictEqual(check('Preset 2.4 At Preset 2.9'), []);
  assert.strictEqual(check('Group 1 At Preset 2.9').length, 1);
  // verbs not on the must-exist list are not checked at all
  for (const c of ['Export Macro 77 "x"', 'Set Sequence 9 Property "Name" "x"', 'Seq 9', 'Del Macro 77']) assert.deepStrictEqual(check(c), [], c);
});

test('safety (b): a truncated pool is never flagged (G4)', () => {
  const groups = Array.from({ length: CAP }, (_, i) => `Group|${i + 1}|G${i + 1}`);
  const full = parseShow([`"${groups.join(' ;; ')} ;; Macro|1|x"`]);
  assert.strictEqual(full.Group.length, 300);
  assert.ok(isTruncated(full, 'Group'));
  assert.deepStrictEqual(check('Go+ Group 301', full), []);
  assert.deepStrictEqual(check('Delete Group 400 Thru 410', full), []);
  // the marker record from the console walk, with fewer entries than the cap
  const cut = parseShow(['"Group|1|a ;; Group|*| ;; Preset|2.4|w ;; Preset|2.*|"']);
  assert.deepStrictEqual(cut.truncated, ['Group', 'Preset']);
  assert.deepStrictEqual(check('Go+ Group 5 ; Preset 2.5', cut), []);
  // the other pools of the same show are still checked
  assert.strictEqual(check('Go+ Macro 5', full).length, 1);
});

test('safety (b): no show, an empty show, or a kind the show does not list: nothing', () => {
  assert.deepStrictEqual(check('Go+ Macro 99', null), []);
  assert.deepStrictEqual(check('Go+ Macro 99', parseShow([''])), []);
  assert.deepStrictEqual(check('Go+ Macro 99', {}), []);
  assert.deepStrictEqual(check('Select World 4 ; Go+ Sequence 1'), []);
  assert.deepStrictEqual(check('Go+ Macro 99', { Macro: [] }), []);
});

test('safety (c): dynamic strings are not checked', () => {
  for (const c of ['Go+ Macro " .. n', 'Go+ Macro %d', 'Go+ Macro 99 " .. x', 'Off Sequence ']) assert.deepStrictEqual(check(c), [], c);
  assert.deepStrictEqual(checkShowRefs('Go+ Macro 99', 'ma3', SHOW, { dynamic: true }), []);
  assert.strictEqual(check('Go+ Macro 99').length, 1);
});

test('safety (d): a name is checked only when the names of that kind are unique', () => {
  assert.deepStrictEqual(messages('Group "Side"'), ['Group "Side" is not in the loaded show.']);
  assert.deepStrictEqual(check('Group "front"'), [], 'names match case-insensitively');
  const dup = parseShow(['"Group|1|Wash ;; Group|2|Wash ;; Group|3|Spot"']);
  assert.deepStrictEqual(check('Group "Side"', dup), []);
});

test('parseShow keeps its shape; truncation is a side property; the walks emit the marker', () => {
  const show = parseShow(['"Group|1|Front ;; Group|*| ;; Macro|2|M"']);
  assert.deepStrictEqual(show, { Group: [{ no: '1', name: 'Front' }], Macro: [{ no: '2', name: 'M' }] });
  assert.deepStrictEqual(Object.keys(show), ['Group', 'Macro']);
  assert.deepStrictEqual(show.truncated, ['Group']);
  assert.ok(!isTruncated(show, 'Macro'));
  assert.match(showLua(), /if n > cap then r\[#r \+ 1\] = kind \.\. '\|' \.\. prefix \.\. '\*\|'/);
  assert.match(ma2ShowLua(), /if o\.amount\(pool\) > 300 then r\[#r \+ 1\] = k\[1\] \.\. '\|\*\|' end/);
});

test('lintRules: show findings with the string offset, only when a show is passed', () => {
  const src = 'Cmd("Go+ Macro 11")\nCmd("Go+ Macro 12")\nCmd("Store Macro 12")';
  const f = lintRules(src, null, { target: 'ma3', show: SHOW }).filter((x) => x.rule === 'show-missing-object');
  assert.deepStrictEqual(f.map((x) => [x.line, x.col, x.len, x.severity]), [[1, 15, 2, 'hint']]);
  assert.deepStrictEqual(lintRules(src, null, { target: 'ma3' }).filter((x) => x.rule === 'show-missing-object'), []);
});
