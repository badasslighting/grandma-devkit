'use strict';
// Runs inside VS Code's extension host for test/ui/drive.js. It opens the designer panels and then waits for the
// driver (which clicks inside the webviews over the DevTools protocol) before it reads back what changed in the
// editor and on the clipboard. Protocol: this side writes <step>.ready, the driver writes <step>.done.
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const sync = process.env.MA3DEV_UI_DRIVE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, what, ms = 60000) {
  const t = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`timed out: ${what}`);
    await sleep(150);
  }
}
const step = async (name) => {
  fs.writeFileSync(path.join(sync, `${name}.ready`), '');
  await until(() => fs.existsSync(path.join(sync, `${name}.done`)), `driver step ${name}`);
};
const webviewTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input && t.input.viewType !== undefined && /ma3\./.test(t.input.viewType));

async function run() {
  const out = { steps: {} };
  const write = () => fs.writeFileSync(process.env.MA3DEV_UI_RESULT, JSON.stringify(out, null, 2));
  try {
    await vscode.extensions.getExtension('badasslighting.grandma-devkit').activate();
    const cmds = await vscode.commands.getCommands(true);
    out.commands = ['ma3.dialogDesigner.open', 'ma3.overlayDesigner.open'].map((c) => [c, cmds.includes(c)]);

    // A Lua file with a literal MessageBox call to import, and an empty one to insert into.
    const ws = process.env.MA3DEV_UI_WORKSPACE;
    const src = path.join(ws, 'source.lua');
    fs.writeFileSync(src, 'local r = MessageBox({ title = "Imported", message = "hello", commands = { { value = 1, name = "Yes", order = 1 }, { value = 2, name = "No", order = 2 } } })\n');
    const dst = path.join(ws, 'target.lua');
    fs.writeFileSync(dst, '-- target\n');

    // ---- dialog designer
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(src));
    await vscode.commands.executeCommand('ma3.dialogDesigner.open');
    await sleep(1500);
    out.dialogTabs = webviewTabs().map((t) => t.label);
    await step('dialog-import'); // driver clicks "Import from editor" while source.lua is the last editor
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(dst));
    await step('dialog-insert'); // driver builds a two-dialog flow and clicks "Insert at cursor"
    await sleep(500);
    out.steps.dialogInserted = (await vscode.workspace.openTextDocument(dst)).getText();
    await vscode.commands.executeCommand('ma3.dialogDesigner.open'); // a second open must reuse the panel
    out.dialogTabsAfterReopen = webviewTabs().map((t) => t.label);
    await step('dialog-copy');
    out.steps.dialogClipboard = await vscode.env.clipboard.readText();

    // ---- overlay designer
    await vscode.commands.executeCommand('ma3.overlayDesigner.open');
    await sleep(1500);
    out.overlayTabs = webviewTabs().map((t) => t.label);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(dst), { preview: false });
    await step('overlay-build'); // driver adds a button and a grid in window mode, then inserts
    await sleep(500);
    out.steps.overlayWindowInserted = (await vscode.workspace.openTextDocument(dst)).getText();
    await step('overlay-screen'); // driver switches to screen mode, adds a button, drags it, copies the Lua
    out.steps.overlayScreenClipboard = await vscode.env.clipboard.readText();
    await step('overlay-import'); // driver clicks Import from editor with the window design in target.lua
    out.done = true;
  } catch (e) {
    out.error = String(e && e.stack || e);
  }
  write();
}

module.exports = { run };
