'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { luaType, safeName, returnType, ma3Stubs, ma2Stubs, mergeLuarc } = require('../lib/stubs');
const api = require('../data/api.json');

test('type mapping and name sanitising', () => {
  assert.strictEqual(luaType('light_userdata'), 'Obj');
  assert.strictEqual(luaType('integer'), 'integer');
  assert.strictEqual(luaType('float'), 'number');
  assert.strictEqual(luaType('bool'), 'boolean');
  assert.strictEqual(luaType("{'abs_preset'=light_userdata"), 'any');
  const used = new Set();
  assert.deepStrictEqual(['end', 'a b', 'a b', '1st', ''].map((n) => safeName(n, used)), ['end_', 'a_b', 'a_b2', 'p_1st', 'arg']);
  assert.deepStrictEqual(returnType('string:address'), { type: 'string', name: 'address' });
  assert.deepStrictEqual(returnType('light_userdata:handle'), { type: 'Obj', name: 'handle' });
  assert.strictEqual(returnType('nothing'), null);
  assert.deepStrictEqual(returnType('{light_userdata:child_handles}'), { type: 'table', name: '' });
  assert.deepStrictEqual(returnType('true or nil'), { type: 'any', name: '' });
});

test('ma3 stubs: globals, Obj methods, varargs, optionals', () => {
  const s = ma3Stubs(api);
  assert.match(s, /^---@meta/);
  assert.match(s, /---@param formatted_command string\|number\n---@param \.\.\. any\nfunction Printf\(formatted_command, \.\.\.\) end/);
  assert.match(s, /---@param undo\? Obj\n---@param \.\.\. any\n---@return any\nfunction Cmd\(formatted_command, undo, \.\.\.\) end/);
  assert.match(s, /---@return Obj handle\nfunction Root\(\) end/);
  assert.match(s, /function Obj:Children\(\) end/);
  assert.match(s, /function Obj:ToAddr\(with_name, use_visible_addr\) end/, 'the first parameter (the handle) is self');
  assert.ok((s.match(/^function /gm) || []).length >= 300);
});

test('ma2 stubs: nested gma tables come before the functions that use them', () => {
  const s = ma2Stubs();
  assert.ok(s.indexOf('gma.show.getobj = {}') < s.indexOf('function gma.show.getobj.handle('));
  assert.match(s, /---@param address string\n---@return any\nfunction gma\.show\.getobj\.handle\(address\) end/);
  assert.match(s, /---@param default\? string\n---@return string\?\nfunction gma\.textinput\(title, default\) end/);
});

test('the generated stubs are valid Lua when a Lua compiler is on the PATH', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stubs-'));
  const files = { 'g3.lua': ma3Stubs(api), 'g2.lua': ma2Stubs() };
  let ran = false;
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    try {
      execFileSync('luac', ['-p', file], { stdio: 'pipe' });
      ran = true;
    } catch (err) {
      if (err.code === 'ENOENT') return t.skip('no luac on the PATH');
      assert.fail(`${name} does not compile: ${String(err.stderr || err.message).split('\n')[0]}`);
    }
  }
  assert.ok(ran);
});

test('mergeLuarc adds the library once, keeps other keys, and refuses commented JSON', () => {
  const first = mergeLuarc('', { libraryDir: './.vscode/grandma-stubs', runtimeVersion: 'Lua 5.4' });
  const cfg = JSON.parse(first.text);
  assert.deepStrictEqual(cfg['workspace.library'], ['./.vscode/grandma-stubs']);
  assert.strictEqual(cfg['runtime.version'], 'Lua 5.4');
  const again = mergeLuarc(first.text, { libraryDir: './.vscode/grandma-stubs', runtimeVersion: 'Lua 5.3' });
  const cfg2 = JSON.parse(again.text);
  assert.deepStrictEqual(cfg2['workspace.library'], ['./.vscode/grandma-stubs']);
  assert.strictEqual(cfg2['runtime.version'], 'Lua 5.4', 'an existing runtime version is kept');
  const other = mergeLuarc('{"workspace.library":["./lib"],"diagnostics.globals":["x"]}', { libraryDir: './s', runtimeVersion: 'Lua 5.4' });
  assert.deepStrictEqual(JSON.parse(other.text)['workspace.library'], ['./lib', './s']);
  assert.deepStrictEqual(JSON.parse(other.text)['diagnostics.globals'], ['x']);
  assert.match(mergeLuarc('{ // comment\n}', { libraryDir: './s', runtimeVersion: 'Lua 5.4' }).error, /not plain JSON/);
});
