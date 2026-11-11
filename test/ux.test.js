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
