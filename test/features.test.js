'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { reloadLua } = require('../lib/deploy');
const { stringContext, suggestKeywords } = require('../lib/cmdContext');

test('reloadLua imports the library form and calls the slot', () => {
  assert.strictEqual(reloadLua('My"Plugin', 7), 'Cmd("Import Plugin Library \\"MyPlugin\\" At Plugin 7 /nc")\nCmd("Call Plugin 7")\n');
  assert.throws(() => reloadLua('x', 'a;b'), /number/);
});

test('stringContext recognises the Cmd string and ignores other strings and comments', () => {
  assert.deepStrictEqual(stringContext('Cmd("Go+ Exec'), { inCmd: true, text: 'Go+ Exec' });
  assert.deepStrictEqual(stringContext("CmdIndirect( 'Store "), { inCmd: true, text: 'Store ' });
  assert.deepStrictEqual(stringContext('Printf("Go'), { inCmd: false, text: 'Go' });
  assert.strictEqual(stringContext('Cmd("Go+")'), null);
  assert.strictEqual(stringContext('-- Cmd("Go'), null);
});

test('suggestKeywords orders verbs, objects and modifiers by position', () => {
  const first = (t) => suggestKeywords(t).find((k) => k.rank === 0).kind;
  assert.strictEqual(first(''), 'verb');
  assert.strictEqual(first('Go+ '), 'object');
  assert.strictEqual(first('Fixture 1 '), 'modifier');
  assert.strictEqual(first('Store Sequence 1 Cue 3 '), 'modifier');
});
