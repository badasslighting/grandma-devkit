'use strict';
// First-run and everyday ease of use: which console the active file is for (a context key the Command Palette
// filters on), a status-bar connection item, a "Connect to the console" menu, the Get Started walkthrough and one
// menu in front of the variable commands. Everything here only reads state; the commands it runs live elsewhere.

const WALKTHROUGH = 'badasslighting.grandma-devkit#ma3.getStarted';
const POLL_MS = 3000;

// Commands behind "grandMA: Variables..." (kept out of the Command Palette unless asked for, see package.json).
const VAR_ITEMS = [
  { label: 'Replace variables across a range', detail: '$color1 thru $color5 with a template', command: 'ma3.vars.replaceRange' },
  { label: 'Preview what this command line runs', detail: 'The line with its variables replaced', command: 'ma3.vars.preview' },
  { label: 'Replace variable with its value', command: 'ma3.vars.inline' },
  { label: 'Extract selection to a variable', command: 'ma3.vars.extract' },
  { label: 'Convert variables and conditions to the other console', command: 'ma3.vars.convert' },
  { label: 'Set console variable', detail: 'Change a value on the console', command: 'ma3.vars.set' },
  { label: 'Add console variable', command: 'ma3.vars.add' },
  { label: 'Delete console variable', command: 'ma3.vars.delete' },
  { label: 'Watch console variables', detail: 'Print changes as they happen', command: 'ma3.vars.watch' },
  { label: 'Snapshot console variables', command: 'ma3.vars.snapshot' },
  { label: 'Compare console variables with snapshot', command: 'ma3.vars.diff' },
  { label: 'Restore console variables from snapshot', command: 'ma3.vars.restore' },
  { label: 'Insert variable (favorites first)', command: 'ma3.bank.insert' },
  { label: 'Add variable to favorites', command: 'ma3.bank.favorite' },
  { label: 'Export favorite variables to a file', command: 'ma3.bank.export' },
  { label: 'Import favorite variables from a file', command: 'ma3.bank.import' },
  { label: 'Set favorite variables on the console', command: 'ma3.bank.applyFavorites' },
];

// What the connection menu offers for one console. `running` is whether the LuaBridge heartbeat is fresh.
function connectItems(target, running) {
  const ma2 = target === 'ma2';
  const items = [];
  if (running) {
    items.push({ label: '$(play) Run this file on the console', command: 'ma3.runOnConsole' });
    items.push({ label: '$(cloud-upload) Deploy and reload on the console', command: 'ma3.deployAndRun' });
    items.push({ label: '$(terminal) Open the console REPL', command: 'ma3.repl.open' });
    items.push({ label: '$(sync) Clear the Lua globals on the console', command: 'ma3.bridgeReset' });
  } else {
    items.push({
      label: '$(plug) Install the LuaBridge plugin on the console',
      detail: ma2 ? 'Copies it, imports it into a pool slot over Telnet and starts it' : 'Copies it to the plugins folder; importing it needs OSC command input on (next item)',
      command: 'ma3.installBridge',
    });
  }
  if (ma2) {
    items.push({ label: '$(key) Set the Telnet password', detail: 'Only if your Telnet user profile has one', command: 'ma3.telnet.setPassword' });
    items.push({ label: '$(output) Show console messages (System Monitor)', command: 'ma3.telnet.monitor' });
  } else {
    items.push({ label: '$(radio-tower) Switch on OSC command input on the console', detail: 'Needs the LuaBridge running', command: 'ma3.osc.setup' });
  }
  items.push({ label: '$(info) Check the connection', command: 'ma3.bridgeStatus' });
  items.push({ label: '$(folder) Set the console for this project', detail: 'Saved in this project only; hides the other console commands', command: 'ma3.setProjectConsole' });
  items.push({ label: '$(rocket) Open Get Started', command: 'ma3.getStarted' });
  return items;
}

const consoleName = (target) => (target === 'ma2' ? 'grandMA2' : 'grandMA3');
const statusText = (target, running) => `${running ? '$(check)' : '$(debug-disconnect)'} ${consoleName(target)}`;

function register({ vscode, context, cfg, bridge, bridgeDirFor, targetOf, macroKind }) {
  const setContext = (key, value) => vscode.commands.executeCommand('setContext', key, value);

  // The console the active editor is for: '' when it is not a Lua or macro file (then every command stays listed).
  const consoleOf = (ed) => {
    if (!ed) return '';
    const doc = ed.document;
    if (doc.languageId === 'lua') return targetOf(doc);
    const k = macroKind(doc.fileName, doc.getText());
    return k ? k.target : '';
  };
  const running = (target) => {
    try {
      return bridge.status(bridgeDirFor(target)).running;
    } catch (_) {
      return false; // no bridge folder yet
    }
  };
  let lastConsole = 'ma3';
  let current = ''; // the value last given to the ma3.console context key (read by the UI tests)
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  bar.command = 'ma3.connect';
  context.subscriptions.push(bar);

  function update() {
    const fromFile = consoleOf(vscode.window.activeTextEditor);
    if (fromFile) lastConsole = fromFile;
    const forced = cfg().get('target');
    // the palette follows the project's console when no file decides; the status item only shows for a file
    const c = fromFile || (forced === 'ma2' || forced === 'ma3' ? forced : '');
    current = c;
    setContext('ma3.console', c);
    if (!fromFile) return bar.hide();
    const up = running(c);
    bar.text = statusText(c, up);
    bar.tooltip = up
      ? `LuaBridge is running on ${consoleName(c)}. Click for actions.`
      : `Not connected to ${consoleName(c)}: the LuaBridge plugin is not running. Click to connect.`;
    bar.show();
  }
  update();
  const timer = setInterval(update, POLL_MS);
  context.subscriptions.push(
    { dispose: () => clearInterval(timer) },
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('ma3') && update())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.connect', async () => {
      const target = consoleOf(vscode.window.activeTextEditor) || lastConsole;
      const up = running(target);
      const pick = await vscode.window.showQuickPick(connectItems(target, up), {
        title: `${consoleName(target)}: ${up ? 'connected (LuaBridge running)' : 'not connected'}`,
        placeHolder: 'Choose an action',
      });
      if (pick) await vscode.commands.executeCommand(pick.command);
    }),
    vscode.commands.registerCommand('ma3.setProjectConsole', async () => {
      const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
      if (!folder) return vscode.window.showWarningMessage('Open a folder first: the console is remembered for the project (.vscode/settings.json).');
      const now = cfg().inspect('target') || {};
      const cur = now.workspaceFolderValue || now.workspaceValue || 'auto';
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'Auto-detect', detail: 'Decide per file from its manifest, folder and code (default)', value: 'auto' },
          { label: 'grandMA3 project', detail: 'Treat every Lua file here as grandMA3 and hide the grandMA2-only commands', value: 'ma3' },
          { label: 'grandMA2 project', detail: 'Treat every Lua file here as grandMA2 and hide the grandMA3-only commands', value: 'ma2' },
        ].map((i) => ({ ...i, description: i.value === cur ? 'current' : '' })),
        { title: 'Console for this project', placeHolder: 'Saved in this project only' }
      );
      if (!pick) return;
      await cfg().update('target', pick.value === 'auto' ? undefined : pick.value, vscode.ConfigurationTarget.Workspace);
      update();
    }),
    vscode.commands.registerCommand('ma3._consoleContext', () => current),
    vscode.commands.registerCommand('ma3.getStarted', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH, false)),
    vscode.commands.registerCommand('ma3.vars.menu', async () => {
      const pick = await vscode.window.showQuickPick(VAR_ITEMS, { title: 'grandMA: Variables', placeHolder: 'Choose an action', matchOnDetail: true });
      if (pick) await vscode.commands.executeCommand(pick.command);
    })
  );

  // One gentle pointer the first time, never again.
  if (!context.globalState.get('ma3.welcomeShown') && vscode.workspace.workspaceFolders) {
    context.globalState.update('ma3.welcomeShown', true);
    vscode.window.showInformationMessage('New to the grandMA Devkit? A short walkthrough covers choosing your console, connecting and running code.', 'Get Started', 'Not now').then((p) => {
      if (p === 'Get Started') vscode.commands.executeCommand('ma3.getStarted');
    });
  }
}

module.exports = { register, connectItems, statusText, VAR_ITEMS, WALKTHROUGH };
