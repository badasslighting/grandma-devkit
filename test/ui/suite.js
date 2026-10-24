'use strict';
// Runs inside the VS Code extension host. Drives the real UI commands and reports to MA3DEV_UI_RESULT.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ws = process.env.MA3DEV_UI_WORKSPACE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(pred, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await pred();
    if (v) return v;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function openLua(name, text) {
  const file = path.join(ws, name);
  fs.writeFileSync(file, text);
  const doc = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(doc);
  return { doc, editor };
}

const outputText = () =>
  vscode.workspace.textDocuments
    .filter((d) => d.uri.scheme === 'output' && /grandMA Devkit|grandMA3/i.test(d.uri.path + d.uri.authority + d.uri.query))
    .map((d) => d.getText())
    .join('\n');
const runDiags = (doc) => vscode.languages.getDiagnostics(doc.uri).filter((d) => d.severity === vscode.DiagnosticSeverity.Error);

// Capture notification popups instead of showing them.
const popups = [];
for (const kind of ['showInformationMessage', 'showWarningMessage', 'showErrorMessage']) {
  vscode.window[kind] = async (msg) => {
    popups.push([kind, msg]);
  };
}

test('extension activates and registers the bridge commands', async () => {
  await openLua('a.lua', 'return 1\n');
  await vscode.extensions.getExtension('badasslighting.grandma-devkit').activate();
  const cmds = await vscode.commands.getCommands(true);
  for (const c of ['ma3.runOnConsole', 'ma3.bridgeStatus', 'ma3.bridgeReset']) assert.ok(cmds.includes(c), `${c} registered`);
});

test('0.3 commands are registered', async () => {
  const cmds = await vscode.commands.getCommands(true);
  for (const c of ['ma3.deployAndRun', 'ma3.packagePlugin', 'ma3.refreshShow', 'ma3.objects.refresh', 'ma3.objects.copyPath']) assert.ok(cmds.includes(c), `${c} registered`);
});

test('Cmd strings complete console keywords and live show groups', async () => {
  const { doc } = await openLua('cmd.lua', 'Cmd("Store Group ")\n');
  await vscode.commands.executeCommand('ma3.refreshShow');
  const pos = new vscode.Position(0, 17);
  const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, pos);
  const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
  assert.ok(labels.includes('Fixture'), 'object keywords offered after Store Group? (keyword list present)');
  assert.ok(list.items.some((i) => /^Group: /.test(i.detail || '')), 'group numbers from the running show offered');
  const outside = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(0, 3));
  assert.ok(!outside.items.some((i) => i.label === 'Fixture'), 'no command keywords outside the string');
});

test('lint flags a typo, Cmd in a loop and heavy work in a Timer callback', async () => {
  const { doc } = await openLua('lint.lua', 'printf("x")\nfor i = 1, 3 do Cmd("Go+") end\nTimer(function() local l = ObjectList("Sequence 1") end, 1, 0)\nreturn 1\n');
  const diags = await until(() => {
    const d = vscode.languages.getDiagnostics(doc.uri);
    return d.length >= 3 ? d : null;
  }, 'lint diagnostics');
  const codes = diags.map((d) => d.code).sort();
  assert.deepStrictEqual(codes, ['cmd-in-loop', 'heavy-in-callback', 'unknown-api']);
});

test('Enums.* and attribute names complete from the running console', async () => {
  const { doc } = await openLua('enums.lua', 'local m = Enums.TimerMo\nlocal n = Enums.TimerMode.\nlocal i = GetAttributeIndex("Dim")\n');
  const labels = (list) => list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
  await vscode.commands.executeCommand('ma3.refreshShow');
  const enums = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(0, 23));
  assert.ok(labels(enums).includes('TimerMode'), 'enum names offered');
  const members = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(1, 28));
  assert.ok(['Countdown', 'Stopwatch'].every((n) => labels(members).includes(n)), 'TimerMode members offered');
  const attrs = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(2, 30));
  assert.ok(labels(attrs).includes('Dimmer'), 'attribute names offered inside GetAttributeIndex("...")');
});

test('manifest XML completes elements and attributes', async () => {
  const file = path.join(ws, 'P.xml');
  fs.writeFileSync(file, '<GMA3 DataVersion="2.0.0.0">\n\t<Plugin Name="P">\n\t\t<\n\t</Plugin>\n</GMA3>\n');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(2, 3));
  assert.ok(list.items.some((i) => i.label === 'ComponentLua'), 'ComponentLua offered inside Plugin');
});

test('object browser lists Root children through the bridge', async () => {
  const bridge = require('../../lib/bridge');
  const { listLua, parseList } = require('../../lib/objectTree');
  const r = await bridge.run(bridge.defaultBridgeDir(), listLua([]), 2);
  const { total, items } = parseList(r.returns);
  assert.ok(total > 5 && items.some((i) => i.name === 'ShowData'), 'Root has ShowData');
});

test('grandMA2: gma.* completes, hovers, shows signatures and lints', async () => {
  const { doc } = await openLua('ma2.lua', 'gma.\ngma.cmd("Go+")\ngma.feedbak("x")\nfor i = 1, 3 do gma.cmd("Go+") end\nreturn 1\n');
  const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(0, 4));
  const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
  assert.ok(['cmd', 'show', 'gui', 'user'].every((l) => labels.includes(l)), `gma members offered: ${labels.slice(0, 8)}`);
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(1, 6));
  assert.ok(hovers.some((h) => h.contents.some((c) => /gma\.cmd\(command\)/.test(c.value))), 'hover shows the gma.cmd signature');
  await openLua('ma2sig.lua', 'gma.cmd(\n');
  const sigDoc = vscode.window.activeTextEditor.document;
  const sig = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', sigDoc.uri, new vscode.Position(0, 8), '(');
  assert.ok(sig && sig.signatures.some((s) => s.label.startsWith('gma.cmd(')), `signature help for gma.cmd: ${JSON.stringify(sig)}`);
  const codes = await until(() => {
    const d = vscode.languages.getDiagnostics(doc.uri);
    return d.length >= 2 ? d.map((x) => x.code).sort() : null;
  }, 'ma2 diagnostics');
  assert.deepStrictEqual(codes, ['cmd-in-loop', 'unknown-api']);
});

test('grandMA2: gma.cmd strings complete console keywords', async () => {
  const { doc } = await openLua('ma2cmd.lua', 'gma.cmd("Store Seq")\n');
  const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(0, 17));
  assert.ok(list.items.some((i) => i.label === 'Sequence'), 'Sequence offered inside gma.cmd string');
});

test('grandMA2: manifest XML completes the MA root, Plugin attributes and flags problems', async () => {
  const file = path.join(ws, 'M.xml');
  fs.writeFileSync(file, '<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" major_vers="3" minor_vers="9" stream_vers="61">\n\t<Plugin index="0" na\n</MA>\n');
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(1, 22));
  const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
  assert.ok(labels.includes('name') && labels.includes('luafile') && !labels.includes('index'), `Plugin attributes: ${labels}`);
});

test('grandMA2: New grandMA2 Plugin writes a manifest and Lua that pass the checks', async () => {
  await vscode.commands.executeCommand('ma3.newPluginMa2', 'UiMa2Demo');
  const xml = fs.readFileSync(path.join(ws, 'UiMa2Demo', 'UiMa2Demo.xml'), 'utf8');
  assert.match(xml, /<MA xmlns="http:\/\/schemas\.malighting\.de\/grandma2\/xml\/MA"/);
  assert.match(xml, /name="UiMa2Demo" luafile="UiMa2Demo\.lua"/);
  const lua = fs.readFileSync(path.join(ws, 'UiMa2Demo', 'UiMa2Demo.lua'), 'utf8');
  assert.match(lua, /gma\.feedback/);
  const mdoc = await vscode.workspace.openTextDocument(path.join(ws, 'UiMa2Demo', 'UiMa2Demo.xml'));
  await vscode.window.showTextDocument(mdoc);
  await sleep(500);
  assert.deepStrictEqual(vscode.languages.getDiagnostics(mdoc.uri), []);
});

test('contributed settings have the declared defaults', async () => {
  const cfg = vscode.workspace.getConfiguration('ma3');
  assert.strictEqual(cfg.get('bridge.timeout'), 2);
  assert.strictEqual(cfg.get('bridge.dir'), '');
});

test('LuaBridge Status reports the live heartbeat', async () => {
  popups.length = 0;
  await vscode.commands.executeCommand('ma3.bridgeStatus');
  await until(() => popups.length, 'status popup');
  assert.match(popups[0][1], /LuaBridge running/, popups[0][1]);
});

test('Run File on Console prints returns and output, no error markers', async () => {
  const { doc } = await openLua('ok.lua', 'Printf("ui-test-hello")\nreturn 6*7\n');
  await vscode.commands.executeCommand('ma3.runOnConsole');
  const text = await until(() => (/cpu_ms/.test(outputText()) ? outputText() : ''), 'output channel text');
  assert.match(text, /ui-test-hello/);
  assert.match(text, /returns: 42/);
  assert.strictEqual(runDiags(doc).length, 0);
});

test('Run File on Console marks the failing line', async () => {
  const { doc } = await openLua('bad.lua', 'local a = 1\nlocal b = nil\nreturn b.x\n');
  await vscode.commands.executeCommand('ma3.runOnConsole');
  const diags = await until(() => (runDiags(doc).length ? runDiags(doc) : null), 'error diagnostic');
  assert.strictEqual(diags[0].range.start.line, 2);
  assert.match(diags[0].message, /nil value/);
  await until(() => /error: bridge:3:/.test(outputText()), 'error text in output channel');
});

test('Run Selection offsets the error line and runs only the selection', async () => {
  const { doc, editor } = await openLua('sel.lua', 'error("outside selection")\nlocal x = 1\nlocal y = nil\nreturn y.z\n');
  editor.selection = new vscode.Selection(1, 0, 3, 10);
  await vscode.commands.executeCommand('ma3.runOnConsole');
  const diags = await until(() => (runDiags(doc).length ? runDiags(doc) : null), 'error diagnostic');
  assert.strictEqual(diags[0].range.start.line, 3, 'selection starts at line 2, error is its 3rd line');
  assert.doesNotMatch(diags[0].message, /outside selection/);
});

test('A clean re-run clears the earlier error marker', async () => {
  const { doc, editor } = await openLua('fix.lua', 'return nil + 1\n');
  await vscode.commands.executeCommand('ma3.runOnConsole');
  await until(() => runDiags(doc).length, 'error diagnostic');
  await editor.edit((b) => b.replace(new vscode.Range(0, 0, 0, 14), 'return 1'));
  await vscode.commands.executeCommand('ma3.runOnConsole');
  await until(() => runDiags(doc).length === 0, 'diagnostic cleared');
});

test('Clear Globals drops a global set by an earlier run', async () => {
  await openLua('g1.lua', 'UI_TEST_GLOBAL = 99\nreturn UI_TEST_GLOBAL\n');
  await vscode.commands.executeCommand('ma3.runOnConsole');
  await until(() => /returns: 99/.test(outputText()), 'first run');
  await vscode.commands.executeCommand('ma3.bridgeReset');
  await openLua('g2.lua', 'return tostring(UI_TEST_GLOBAL)\n');
  await vscode.commands.executeCommand('ma3.runOnConsole');
  await until(() => /returns: .*nil/.test(outputText()), 'global cleared');
});

test('Pointing at an empty bridge folder shows a not-running error, writes no request', async () => {
  const empty = path.join(ws, 'nobridge');
  fs.mkdirSync(empty);
  await vscode.workspace.getConfiguration('ma3').update('bridge.dir', empty, vscode.ConfigurationTarget.Global);
  try {
    popups.length = 0;
    await openLua('off.lua', 'return 1\n');
    await vscode.commands.executeCommand('ma3.runOnConsole');
    await until(() => popups.find((p) => p[0] === 'showErrorMessage'), 'error popup');
    assert.match(popups.find((p) => p[0] === 'showErrorMessage')[1], /isn't running/);
    assert.deepStrictEqual(fs.readdirSync(empty), []);
  } finally {
    await vscode.workspace.getConfiguration('ma3').update('bridge.dir', undefined, vscode.ConfigurationTarget.Global);
  }
});

test('Run on a non-Lua editor warns instead of running', async () => {
  const file = path.join(ws, 'note.txt');
  fs.writeFileSync(file, 'hi');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
  popups.length = 0;
  await vscode.commands.executeCommand('ma3.runOnConsole');
  await until(() => popups.length, 'warning popup');
  assert.strictEqual(popups[0][0], 'showWarningMessage');
});

// Visual mode: stage a state, ask the launcher (CDP) for a screenshot, wait for it.
async function visual() {
  const dir = process.env.MA3DEV_UI_SHOTS;
  const shot = async (name) => {
    await sleep(700);
    fs.writeFileSync(path.join(dir, name + '.ready'), '');
    await until(() => fs.existsSync(path.join(dir, name + '.done')), 'screenshot ' + name, 15000);
  };
  await vscode.extensions.getExtension('badasslighting.grandma-devkit').activate();
  await openLua('ok.lua', 'Printf("ui-test-hello")\nreturn 6*7\n');
  await vscode.commands.executeCommand('ma3.runOnConsole');
  await until(() => /cpu_ms/.test(outputText()), 'output');
  await shot('1-run-ok');
  const { doc } = await openLua('bad.lua', 'local a = 1\nlocal b = nil\nreturn b.x\n');
  await vscode.commands.executeCommand('ma3.runOnConsole');
  await until(() => runDiags(doc).length, 'error marker');
  await shot('2-run-error-output');
  await vscode.commands.executeCommand('workbench.actions.view.problems');
  await shot('3-run-error-problems');
  await vscode.commands.executeCommand('editor.action.marker.next');
  await vscode.commands.executeCommand('workbench.action.closePanel');
  await shot('4-run-error-hover');
}

async function run() {
  if (process.env.MA3DEV_UI_SHOTS) {
    try { await visual(); } catch (e) { fs.writeFileSync(path.join(process.env.MA3DEV_UI_SHOTS, 'error.txt'), String(e && e.message)); }
    fs.writeFileSync(process.env.MA3DEV_UI_RESULT, JSON.stringify({ tests: [] }));
    return;
  }
  const results = [];
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ name: t.name, ok: true });
    } catch (e) {
      results.push({ name: t.name, ok: false, error: String(e && e.message).split('\n')[0] });
    }
  }
  fs.writeFileSync(process.env.MA3DEV_UI_RESULT, JSON.stringify({ tests: results }));
}

module.exports = { run };
