'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../lib/dialogModel');

function sampleFlow() {
  const main = M.newDialog('main');
  main.title = 'Pick "one"';
  main.message = 'Line 1\nLine 2';
  main.commands = [{ value: 1, name: 'Go', next: 'confirm' }, { value: 2, name: 'Cancel', next: null }];
  main.inputs = [{ name: 'Label', value: 'x', maxTextLength: 20 }];
  main.states = [{ name: 'Fast', state: true }];
  main.selectors = [{ name: 'Mode', selectedValue: 2, type: 1, values: [{ name: 'Low', value: 1 }, { name: 'High', value: 2 }] }];
  const confirm = M.newDialog('confirm');
  confirm.commands = [{ value: 1, name: 'Yes', next: null }];
  return { start: 'main', dialogs: [main, confirm] };
}

test('luaStr escapes quotes, backslashes, newlines and control characters', () => {
  assert.strictEqual(M.luaStr('a"b\\c\nd\x01'), '"a\\"b\\\\c\\nd\\001"');
});

test('a single dialog with no links is one plain MessageBox call', () => {
  const d = M.newDialog('main');
  const lua = M.generate({ start: 'main', dialogs: [d] });
  assert.ok(lua.startsWith('local r = MessageBox({'));
  assert.ok(!lua.includes('dlg_'));
});

test('a flow generates one function per dialog, branches on r.result, and starts at the start dialog', () => {
  const lua = M.generate(sampleFlow());
  assert.match(lua, /^local dlg_main, dlg_confirm\n/);
  assert.match(lua, /dlg_main = function\(\)/);
  assert.match(lua, /if r\.result == 1 then return dlg_confirm\(\)/);
  assert.match(lua, /\ndlg_main\(\)\n$/);
  assert.match(lua, /\[\"Low\"\] = 1/);
  assert.ok(!/elseif/.test(lua));
});

const { spawnSync } = require('node:child_process');
const lua = spawnSync('lua', ['-v']).status === 0;

test('generated Lua runs: stubbed MessageBox walks the flow main -> confirm', { skip: !lua && 'no lua on PATH' }, () => {
  const code = `local calls = {}
MessageBox = function(t) calls[#calls + 1] = t.title; return { result = 1, inputs = {}, states = {}, selectors = {} } end
${M.generate(sampleFlow())}
assert(calls[1] == 'Pick "one"' and calls[2] == 'Title', table.concat(calls, ','))`;
  const r = spawnSync('lua', ['-'], { input: code, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

test('generated Lua has balanced braces and function/end', () => {
  const l = M.generate(sampleFlow());
  assert.strictEqual((l.match(/{/g) || []).length, (l.match(/}/g) || []).length);
  assert.strictEqual((l.match(/= function()/g) || []).length, (l.match(/^end$/gm) || []).length);
});

test('validate: a good flow has no errors; duplicates, bad links and unreachable dialogs are found', () => {
  assert.deepStrictEqual(M.validate(sampleFlow()).filter((p) => p.level === 'error'), []);
  const f = sampleFlow();
  f.dialogs[0].commands[1].value = 1;
  f.dialogs[0].commands[0].next = 'nowhere';
  f.dialogs.push(M.newDialog('orphan'));
  const p = M.validate(f);
  assert.ok(p.some((x) => x.level === 'error' && /share the value/.test(x.message)));
  assert.ok(p.some((x) => x.level === 'error' && /does not exist/.test(x.message)));
  assert.ok(p.some((x) => x.level === 'warning' && x.dialog === 'orphan'));
  assert.ok(M.hasErrors(p));
});

test('validate: names unique per dialog, selectors need values, ids are identifiers', () => {
  const f = sampleFlow();
  f.dialogs[0].states[0].name = 'Label';
  f.dialogs[0].selectors[0].values = [];
  f.dialogs[1].id = 'bad id';
  const msgs = M.validate(f).map((x) => x.message).join('|');
  assert.match(msgs, /used twice/);
  assert.match(msgs, /has no values/);
  assert.match(msgs, /not a usable dialog id/);
});

test('uniqueId and cleanId', () => {
  assert.strictEqual(M.cleanId(' My Dialog! '), 'My_Dialog');
  const f = sampleFlow();
  assert.strictEqual(M.uniqueId(f, 'main'), 'main_2');
  assert.strictEqual(M.uniqueId(f, '???'), 'dialog');
});

test('importMessageBoxes reads a literal call back, including comments, quotes and order', () => {
  const src = `local r = MessageBox({
    title = 'It\\'s', -- comment
    message = "hi\\nthere",
    commands = { { value = 2, name = "B", order = 2 }, { value = 1, name = "A", order = 1 } },
    selectors = { { name = "M", selectedValue = 2, type = 1, values = { ["Low"] = 1, ["High"] = 2 } } },
    states = { { name = "S", state = true } },
    inputs = { { name = "I", value = "v", maxTextLength = 5 } },
  })`;
  const { flow, skipped } = M.importMessageBoxes(src);
  assert.strictEqual(skipped, 0);
  const d = flow.dialogs[0];
  assert.strictEqual(d.title, "It's");
  assert.strictEqual(d.message, 'hi\nthere');
  assert.deepStrictEqual(d.commands.map((c) => c.name), ['A', 'B']);
  assert.deepStrictEqual(d.selectors[0].values, [{ name: 'Low', value: 1 }, { name: 'High', value: 2 }]);
  assert.strictEqual(d.states[0].state, true);
  assert.strictEqual(d.inputs[0].maxTextLength, 5);
});

test('importMessageBoxes skips calls that use variables and counts them', () => {
  const { flow, skipped } = M.importMessageBoxes('MessageBox({ title = name, message = "x" })\nMessageBox({ title = "ok", message = "y" })');
  assert.strictEqual(skipped, 1);
  assert.strictEqual(flow.dialogs.length, 1);
  assert.strictEqual(flow.dialogs[0].title, 'ok');
});

test('generate then import gives the same dialog back', () => {
  const f = sampleFlow();
  const lua = M.generateCall(f.dialogs[0]);
  const back = M.importMessageBoxes(lua).flow.dialogs[0];
  const want = { ...f.dialogs[0], commands: f.dialogs[0].commands.map((c) => ({ ...c, next: null })) };
  assert.deepStrictEqual({ ...back, id: 'main' }, want);
});
