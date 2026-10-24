'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { FUNCTIONS, BY_PATH, members, memberContext, pathAt, activeCallPath } = require('../lib/ma2Api');
const { parseManifest, checkManifest } = require('../lib/manifest');
const { schemaProblems, schemaFor, rootOf, isMa2, contextAt } = require('../lib/manifestSchema');
const { ma2LuaTemplate, ma2XmlTemplate } = require('../lib/templates');
const { defaultMa2PluginsPath, reloadLuaMa2 } = require('../lib/deploy');
const { detectTarget } = require('../lib/target');
const { lintRules } = require('../lib/rules');
const { findBlockingLoops } = require('../lib/lint');
const { stringContext } = require('../lib/cmdContext');
const { defaultBridgeDirMa2 } = require('../lib/bridge');
const api = require('../data/api.json');

const MA2_XML = '<?xml version="1.0" encoding="utf-8"?>\n<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" major_vers="3" minor_vers="9" stream_vers="61">\n\t<Plugin index="0" execute_on_load="0" name="P" luafile="P.lua" />\n</MA>\n';

test('ma2 api: every function has a signature, paths are unique, and members nest', () => {
  assert.ok(FUNCTIONS.length > 30);
  assert.strictEqual(new Set(FUNCTIONS.map((f) => f.path)).size, FUNCTIONS.length);
  assert.strictEqual(BY_PATH.get('gma.cmd').signature, 'gma.cmd(command)');
  assert.strictEqual(BY_PATH.get('gma.textinput').signature, 'gma.textinput(title, [default]): string or nil');
  const top = members('gma').map((m) => m.name);
  for (const n of ['cmd', 'show', 'gui', 'user', 'network']) assert.ok(top.includes(n), n);
  assert.deepStrictEqual(members('gma.show').filter((m) => m.namespace).map((m) => m.name).sort(), ['getobj', 'property']);
  assert.ok(members('gma.show.getobj').some((m) => m.name === 'handle' && m.fn));
});

test('ma2 api: memberContext, pathAt and activeCallPath', () => {
  assert.deepStrictEqual(memberContext('x = gma.show.get'), { prefix: 'gma.show', partial: 'get' });
  assert.deepStrictEqual(memberContext('gma.'), { prefix: 'gma', partial: '' });
  assert.strictEqual(memberContext('t.show.'), null);
  assert.strictEqual(pathAt('local h = gma.show.getobj.handle("Group 1")', 31), 'gma.show.getobj.handle');
  assert.strictEqual(pathAt('print(x)', 3), null);
  assert.deepStrictEqual(activeCallPath('gma.gui.confirm("T", '), { path: 'gma.gui.confirm', argIndex: 1 });
  assert.strictEqual(activeCallPath('gma.cmd("Go+ '), null);
});

test('ma2 manifest: parse the self-closing Plugin and check the Lua file', () => {
  const plugins = parseManifest(MA2_XML);
  assert.deepStrictEqual(plugins.map((p) => [p.name, p.ma2, p.components[0].fileName]), [['P', true, 'P.lua']]);
  const run = (xml, lua, has = true) => checkManifest(xml, '/d', () => lua, () => has).map((p) => p.message);
  assert.deepStrictEqual(run(MA2_XML, 'local function main() end\nreturn main'), []);
  assert.match(run(MA2_XML, 'local x = 1')[0], /never returns its main function/);
  assert.match(run(MA2_XML, '', false)[0], /luafile "P.lua" not found/);
  assert.match(run(MA2_XML.replace('name="P"', ''), 'return 1')[0], /needs a name/);
  assert.match(run(MA2_XML.replace(' luafile="P.lua"', ''), 'return 1')[0], /needs a luafile/);
});

test('ma2 manifest: mixed self-closing and block plugins keep their order', () => {
  const xml = '<GMA3 DataVersion="2.0.0.0"><Plugin Name="A" Version="1.0.0"><ComponentLua Name="A" FileName="A.lua" /></Plugin></GMA3>';
  assert.deepStrictEqual(parseManifest(xml).map((p) => [p.name, p.ma2]), [['A', false]]);
});

test('ma2 schema: detection, problems and context', () => {
  assert.ok(isMa2(MA2_XML));
  assert.ok(!isMa2('<GMA3 DataVersion="2.0.0.0"></GMA3>'));
  assert.strictEqual(rootOf(MA2_XML), 'MA');
  assert.ok('luafile' in schemaFor(MA2_XML).Plugin.attrs);
  assert.deepStrictEqual(schemaProblems(MA2_XML), []);
  const bad = MA2_XML.replace('execute_on_load="0"', 'execute_on_load="2"').replace('luafile', 'lua_file');
  assert.deepStrictEqual(schemaProblems(bad).map((p) => p.message.split(' ')[0]), ['execute_on_load', 'Unknown']);
  assert.deepStrictEqual(contextAt('<MA xmlns="x">\n<Plugin index="0" na'), { kind: 'attribute', element: 'Plugin', used: ['index'], partial: 'na' });
});

test('ma2 templates produce a manifest the checker accepts', () => {
  const xml = ma2XmlTemplate('Demo', '3.9.60');
  assert.match(xml, /major_vers="3" minor_vers="9" stream_vers="60"/);
  assert.deepStrictEqual(checkManifest(xml, '/d', () => ma2LuaTemplate('Demo'), () => true), []);
  assert.match(ma2LuaTemplate('Demo'), /gma\.feedback\("Demo started"\)[\s\S]*return main, cleanup/);
});

test('ma2 deploy: newest gma2_V folder with a plugins directory, and the reload Lua', () => {
  const dirs = { 'gma2_V_3.9.9': true, 'gma2_V_3.9.61': true, 'gma2_V_3.10.1': true, templateshows: true };
  const root = path.join('C:\\PD', 'MA Lighting Technologies', 'grandma');
  const fsApi = {
    readdirSync: (d) => {
      assert.strictEqual(d, root);
      return Object.keys(dirs);
    },
    existsSync: (p) => !p.includes('3.10.1'), // newest has no plugins folder yet
  };
  assert.strictEqual(defaultMa2PluginsPath({ ProgramData: 'C:\\PD' }, 'win32', fsApi), path.join(root, 'gma2_V_3.9.61', 'plugins'));
  assert.strictEqual(defaultMa2PluginsPath({}, 'win32', fsApi), '');
  assert.strictEqual(defaultMa2PluginsPath({ ProgramData: 'C:\\PD' }, 'linux', fsApi), '');
  assert.strictEqual(reloadLuaMa2('X"Y', 20), 'gma.cmd("Import \\"XY\\" At Plugin 20 /o /nc")\ngma.cmd("Plugin \\"XY\\"")\n');
  assert.throws(() => reloadLuaMa2('x', 'a'), /number/);
  assert.match(defaultBridgeDirMa2({ ProgramData: 'C:\\PD' }, 'win32'), /MA2/);
  assert.strictEqual(defaultBridgeDirMa2({ MA2_LUABRIDGE_DIR: 'X' }, 'linux'), 'X');
});

test('target: setting wins, then gma calls, then a grandMA2 manifest, else grandMA3', () => {
  assert.strictEqual(detectTarget('Printf("x")'), 'ma3');
  assert.strictEqual(detectTarget('gma.cmd("Go+")'), 'ma2');
  assert.strictEqual(detectTarget('-- gma.cmd("x")\nlocal s = "gma.x"'), 'ma3');
  assert.strictEqual(detectTarget('return 1', 'auto', MA2_XML), 'ma2');
  assert.strictEqual(detectTarget('gma.cmd("x")', 'ma3'), 'ma3');
  assert.strictEqual(detectTarget('Printf("x")', 'ma2'), 'ma2');
});

test('ma2 lint: unknown gma function, no-argument call, gma.cmd in a loop; MA3 rules stay off', () => {
  const lint = (src) => lintRules(src, api, { target: 'ma2' }).map((f) => `${f.rule}@${f.line}`);
  assert.deepStrictEqual(lint('gma.feedbak("x")\ngma.feedback("ok")\ngma.network.getprimaryip()'), ['unknown-api@0']);
  assert.deepStrictEqual(lint('gma.cmd()\ngma.gettime()'), ['missing-args@0']);
  assert.deepStrictEqual(lint('for i = 1, 3 do\n  gma.cmd("Go+")\nend\ngma.cmd("x")'), ['cmd-in-loop@1']);
  assert.deepStrictEqual(lint('printf("a")\nCmd()'), []);
  assert.deepStrictEqual(lintRules('gma.feedbak("x")', api, { target: 'ma3' }).map((f) => f.rule), []);
});

test('blocking loops accept gma.sleep as a yield, and gma.cmd strings complete as commands', () => {
  assert.strictEqual(findBlockingLoops('while true do\n  gma.sleep(1)\nend').length, 0);
  assert.strictEqual(findBlockingLoops('while true do\n  x = x + 1\nend').length, 1);
  assert.deepStrictEqual(stringContext('gma.cmd("Go+ Exec'), { inCmd: true, text: 'Go+ Exec' });
  assert.deepStrictEqual(stringContext('gma.feedback("Go'), { inCmd: false, text: 'Go' });
});

test('a grandMA2 export that is not a plugin gets no manifest warnings', () => {
  const macro = '<?xml version="1.0"?>\n<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" major_vers="3" minor_vers="9" stream_vers="61">\n<Macro index="0" name="M"><Macroline index="0"><text>Go+</text></Macroline></Macro>\n</MA>\n';
  assert.deepStrictEqual(checkManifest(macro, '/d'), []);
});
