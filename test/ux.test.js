'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ux = require('../lib/ux');

const pkg = require('../package.json');
const contrib = pkg.contributes;
const commands = new Set(contrib.commands.map((c) => c.command));

test('every command the palette rules, the connection menu and the Variables menu name exists', () => {
  for (const r of contrib.menus.commandPalette) assert.ok(commands.has(r.command), `palette rule for unknown command ${r.command}`);
  for (const t of ['ma2', 'ma3']) for (const running of [true, false]) for (const i of ux.connectItems(t, running)) assert.ok(commands.has(i.command), `connect menu names unknown ${i.command}`);
  for (const i of ux.VAR_ITEMS) assert.ok(commands.has(i.command), `Variables menu names unknown ${i.command}`);
});

test('the connection menu fits the console and the state', () => {
  const labels = (t, r) => ux.connectItems(t, r).map((i) => i.command);
  assert.ok(labels('ma2', false).includes('ma3.installBridge') && labels('ma2', false).includes('ma3.telnet.setPassword'));
  assert.ok(!labels('ma2', false).includes('ma3.osc.setup'), 'OSC is grandMA3 only');
  assert.ok(labels('ma3', false).includes('ma3.osc.setup') && !labels('ma3', false).includes('ma3.telnet.setPassword'));
  assert.ok(labels('ma3', true).includes('ma3.runOnConsole') && !labels('ma3', true).includes('ma3.installBridge'), 'once connected, offer running code, not installing');
  assert.match(ux.statusText('ma2', true), /grandMA2/);
  assert.match(ux.statusText('ma3', false), /debug-disconnect.*grandMA3/);
});

test('console-specific commands are hidden for the other console, and the variable commands sit behind one menu', () => {
  const rule = (c) => contrib.menus.commandPalette.find((r) => r.command === c);
  for (const c of ['ma3.osc.send', 'ma3.newPlugin', 'ma3.dialogDesigner.open']) assert.equal(rule(c).when, 'ma3.console != ma2');
  for (const c of ['ma3.telnet.send', 'ma3.newPluginMa2']) assert.equal(rule(c).when, 'ma3.console != ma3');
  const menu = new Set(ux.VAR_ITEMS.map((i) => i.command));
  for (const c of commands) if (/^ma3\.(vars|bank)\./.test(c) && c !== 'ma3.vars.menu') assert.ok(rule(c) && rule(c).when === 'false', `${c} is out of the palette (reached from the menu or a view)`);
  for (const c of menu) assert.equal(rule(c).when, 'false');
  assert.equal(rule('ma3.vars.menu').when, 'config.ma3.vars.enabled');
  const views = Object.fromEntries(contrib.views.explorer.map((v) => [v.id, v.when]));
  assert.equal(views['ma3.vars'], 'config.ma3.vars.enabled');
  assert.equal(views['ma3.varbank'], 'config.ma3.vars.enabled');
  assert.equal(contrib.configuration.properties['ma3.vars.enabled'].default, true);
});

test('the walkthrough points at real commands and real files', () => {
  const w = contrib.walkthroughs.find((x) => x.id === 'ma3.getStarted');
  assert.ok(w && w.steps.length >= 5);
  assert.equal(ux.WALKTHROUGH, `${pkg.publisher}.${pkg.name}#${w.id}`);
  for (const s of w.steps) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', s.media.markdown)), `${s.id}: missing ${s.media.markdown}`);
    for (const m of s.description.matchAll(/\(command:([\w.]+)/g)) assert.ok(commands.has(m[1]) || m[1].startsWith('workbench.'), `${s.id}: unknown command ${m[1]}`);
  }
});

test('only one output panel is created by the extension', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  assert.equal((src.match(/createOutputChannel\(/g) || []).length, 1);
});

// Evaluates the palette "when" clauses this extension uses: `ma3.console != x`, `false`, `config.ma3.vars.enabled`.
function listed(when, ctx) {
  if (when === 'false') return false;
  const m = /^ma3\.console != (\w+)$/.exec(when);
  if (m) return ctx.console !== m[1];
  if (when === 'config.ma3.vars.enabled') return ctx.varsEnabled;
  throw new Error('unhandled when: ' + when);
}
const visible = (ctx) => new Set(contrib.menus.commandPalette.filter((r) => listed(r.when, ctx)).map((r) => r.command));
const everyone = new Set(contrib.commands.map((c) => c.command));

test('palette: a grandMA3 file hides the Telnet and MA2-only commands, a grandMA2 file hides OSC and the designers', () => {
  const ma3 = visible({ console: 'ma3', varsEnabled: true });
  for (const c of ['ma3.telnet.send', 'ma3.telnet.monitor', 'ma3.telnet.setPassword', 'ma3.newPluginMa2', 'ma3.checkMa2Api']) assert.ok(!ma3.has(c), `${c} hidden in a grandMA3 file`);
  for (const c of ['ma3.osc.send', 'ma3.newPlugin', 'ma3.dialogDesigner.open', 'ma3.overlayDesigner.open']) assert.ok(ma3.has(c) || !contrib.menus.commandPalette.some((r) => r.command === c && !listed(r.when, { console: 'ma3', varsEnabled: true })), `${c} listed in a grandMA3 file`);
  const ma2 = visible({ console: 'ma2', varsEnabled: true });
  for (const c of ['ma3.osc.send', 'ma3.osc.setup', 'ma3.updateApiFromConsole', 'ma3.newPlugin', 'ma3.profileFunction', 'ma3.dialogDesigner.open', 'ma3.overlayDesigner.open']) assert.ok(!ma2.has(c), `${c} hidden in a grandMA2 file`);
  for (const c of ['ma3.telnet.send', 'ma3.newPluginMa2', 'ma3.checkMa2Api']) assert.ok(ma2.has(c), `${c} listed in a grandMA2 file`);
});

test('palette: with no Lua file open nothing console-specific is hidden', () => {
  const none = visible({ console: '', varsEnabled: true });
  for (const c of ['ma3.telnet.send', 'ma3.osc.send', 'ma3.newPlugin', 'ma3.newPluginMa2']) assert.ok(none.has(c), `${c} listed with no file open`);
});

test('palette: how many commands each context lists (hidden-by-rule commands removed, unruled ones always listed)', () => {
  const count = (ctx) => { const v = visible(ctx); const ruled = new Set(contrib.menus.commandPalette.map((r) => r.command)); return [...everyone].filter((c) => !ruled.has(c) || v.has(c)).length; };
  const ma3 = count({ console: 'ma3', varsEnabled: true });
  const ma2 = count({ console: 'ma2', varsEnabled: true });
  const none = count({ console: '', varsEnabled: true });
  assert.ok(ma3 < everyone.size && ma2 < everyone.size && ma3 < none && ma2 < none, `ma3 ${ma3}, ma2 ${ma2}, none ${none}, all ${everyone.size}`);
  console.log(`palette lists: grandMA3 file ${ma3}, grandMA2 file ${ma2}, no file ${none}, of ${everyone.size} commands`);
});

test('hot reload: ma3.deployOnSaveReload is off by default and sits next to deployOnSave', () => {
  const props = contrib.configuration.properties;
  assert.strictEqual(props['ma3.deployOnSaveReload'].default, false);
  const keys = Object.keys(props);
  assert.strictEqual(keys.indexOf('ma3.deployOnSaveReload'), keys.indexOf('ma3.deployOnSave') + 1);
});

test('workspaceShow: object numbers and names a project already uses, for completion with no console', () => {
  const { workspaceShow } = require('../lib/offlineShow');
  const show = workspaceShow([
    { file: 'a.lua', target: 'ma3', text: 'Cmd("Go+ Macro 12")\nCmd("Label Macro 12 \\"Intro\\"")\nCmd("Call Preset 2.5")\nCmd("Go+ Sequence 3 Thru 5")' },
    { file: 'b.gma3macro', target: 'ma3', text: 'Go+ Macro 4\nLabel Group 7 "Front"' },
  ]);
  assert.deepStrictEqual(show.Macro.map((o) => o.no), ['4', '12']);
  assert.strictEqual(show.Macro.find((o) => o.no === '12').name, 'Intro');
  assert.deepStrictEqual(show.Sequence.map((o) => o.no), ['3', '4', '5']);
  assert.ok(show.Preset.some((o) => o.no === '2.5'));
  assert.ok(show.Group && show.Group[0].name === 'Front', 'a labelled object counts even when nothing else uses it');
});

test('no setting name is also the parent of another (VS Code cannot read ma3.a.b when ma3.a is a value)', () => {
  const keys = Object.keys(contrib.configuration.properties);
  for (const k of keys) {
    const child = keys.find((o) => o.startsWith(k + '.'));
    assert.ok(!child, `${k} is both a setting and the parent of ${child}`);
  }
});
