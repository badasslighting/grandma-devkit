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
    .filter((d) => d.uri.scheme === 'output' && /grandMA3/i.test(d.uri.path + d.uri.authority + d.uri.query))
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
  await vscode.extensions.getExtension('badasslighting.ma3dev').activate();
  const cmds = await vscode.commands.getCommands(true);
  for (const c of ['ma3.runOnConsole', 'ma3.bridgeStatus', 'ma3.bridgeReset']) assert.ok(cmds.includes(c), `${c} registered`);
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
  await vscode.extensions.getExtension('badasslighting.ma3dev').activate();
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
