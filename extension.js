'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { parseHelpLua } = require('./lib/helpParser');
const { snippetFor, hoverMarkdown, buildIndex, activeCall } = require('./lib/apiModel');
const { findBlockingLoops } = require('./lib/lint');
const { checkManifest } = require('./lib/manifest');
const { luaTemplate, xmlTemplate, validName } = require('./lib/templates');
const { defaultPluginsPath, findManifest, deploy } = require('./lib/deploy');

const LUA = { language: 'lua' };
const cfg = () => vscode.workspace.getConfiguration('ma3');
const pluginsFolder = () => cfg().get('pluginsPath') || defaultPluginsPath();

function loadApi(context) {
  const custom = path.join(context.globalStorageUri.fsPath, 'api.json');
  const file = fs.existsSync(custom) ? custom : path.join(context.extensionPath, 'data', 'api.json');
  return buildIndex(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function activate(context) {
  let index = loadApi(context);
  const diagnostics = vscode.languages.createDiagnosticCollection('ma3');
  context.subscriptions.push(diagnostics);

  // ---- completion: globals everywhere, object methods after ':'
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      LUA,
      {
        provideCompletionItems(doc, pos) {
          const before = doc.lineAt(pos).text.slice(0, pos.character);
          if (/--/.test(before)) return [];
          const isMethod = /:\s*[A-Za-z_]*$/.test(before);
          const isMember = /\.\s*[A-Za-z_]*$/.test(before);
          if (isMember) return [];
          const entries = isMethod ? index.api.object : index.api.global;
          return entries.map((fn) => {
            const item = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
            item.detail = fn.signature;
            item.documentation = new vscode.MarkdownString(hoverMarkdown(fn, isMethod ? 'object' : 'global'));
            item.insertText = new vscode.SnippetString(snippetFor(fn, isMethod));
            return item;
          });
        },
      },
      ':'
    )
  );

  // ---- hover
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(LUA, {
      provideHover(doc, pos) {
        const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_]\w*/);
        if (!range) return null;
        const word = doc.getText(range);
        const before = doc.lineAt(pos).text.slice(0, range.start.character);
        const isMethod = /:\s*$/.test(before);
        const fn = isMethod ? index.object.get(word) : index.global.get(word);
        return fn ? new vscode.Hover(new vscode.MarkdownString(hoverMarkdown(fn, isMethod ? 'object' : 'global')), range) : null;
      },
    })
  );

  // ---- signature help
  context.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      LUA,
      {
        provideSignatureHelp(doc, pos) {
          const before = doc.lineAt(pos).text.slice(0, pos.character);
          const call = activeCall(before);
          if (!call) return null;
          const isMethod = new RegExp(`:\\s*${call.name}\\s*\\(`).test(before);
          const fn = isMethod ? index.object.get(call.name) : index.global.get(call.name);
          if (!fn) return null;
          const sig = new vscode.SignatureInformation(fn.signature, new vscode.MarkdownString(fn.returns ? `Returns ${fn.returns}` : ''));
          sig.parameters = fn.params.map((p) => new vscode.ParameterInformation(p.label));
          const help = new vscode.SignatureHelp();
          help.signatures = [sig];
          help.activeSignature = 0;
          help.activeParameter = Math.min(call.argIndex + (isMethod ? 1 : 0), Math.max(0, fn.params.length - 1));
          return help;
        },
      },
      '(',
      ','
    )
  );

  // ---- diagnostics
  function refresh(doc) {
    if (!cfg().get('diagnostics')) return diagnostics.delete(doc.uri);
    const found = [];
    const lineRange = (line) => doc.lineAt(Math.min(line, doc.lineCount - 1)).range;
    if (doc.languageId === 'lua') {
      for (const f of findBlockingLoops(doc.getText())) {
        found.push(
          new vscode.Diagnostic(
            lineRange(f.line),
            'Loop never yields, breaks or returns; it will freeze the console. Add coroutine.yield(seconds) or use Timer().',
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    } else if (doc.fileName.toLowerCase().endsWith('.xml')) {
      for (const p of checkManifest(doc.getText(), path.dirname(doc.fileName))) {
        found.push(
          new vscode.Diagnostic(lineRange(p.line), p.message, p.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning)
        );
      }
    }
    diagnostics.set(doc.uri, found);
  }
  vscode.workspace.textDocuments.forEach(refresh);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => diagnostics.delete(d.uri))
  );

  // ---- deploy
  function deployFile(file, quiet) {
    try {
      const manifest = findManifest(file);
      if (!manifest) throw new Error('No XML manifest in this folder names this file.');
      const copied = deploy(manifest, pluginsFolder());
      const msg = `Deployed ${copied.length} file(s) to ${path.dirname(copied[0])}`;
      if (quiet) vscode.window.setStatusBarMessage(msg, 3000);
      else vscode.window.showInformationMessage(msg);
    } catch (err) {
      vscode.window.showErrorMessage(`grandMA3 deploy failed: ${err.message}`);
    }
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.deploy', (uri) => {
      const file = (uri && uri.fsPath) || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName);
      if (!file) return vscode.window.showWarningMessage('Open a plugin .lua or .xml file first.');
      deployFile(file, false);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (cfg().get('deployOnSave') && /\.(lua|xml)$/i.test(doc.fileName)) {
        try {
          if (findManifest(doc.fileName)) deployFile(doc.fileName, true);
        } catch (_) {
          /* unrelated file */
        }
      }
    })
  );

  // ---- new plugin
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.newPlugin', async (nameArg) => {
      const name =
        typeof nameArg === 'string'
          ? nameArg
          : await vscode.window.showInputBox({
              prompt: 'Plugin name (letters, digits, _ and -; becomes the file name)',
              validateInput: (v) => (validName(v) ? null : 'Start with a letter; use only letters, digits, _ or -.'),
            });
      if (!name) return;
      if (!validName(name)) return vscode.window.showErrorMessage(`"${name}" is not a valid plugin name.`);
      const root = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
      if (!root) return vscode.window.showWarningMessage('Open a folder first.');
      const dir = vscode.Uri.joinPath(root.uri, name);
      const luaUri = vscode.Uri.joinPath(dir, `${name}.lua`);
      const xmlUri = vscode.Uri.joinPath(dir, `${name}.xml`);
      try {
        await vscode.workspace.fs.stat(dir);
        return vscode.window.showErrorMessage(`${name} already exists in this workspace.`);
      } catch (_) {
        /* does not exist: good */
      }
      const enc = new TextEncoder();
      await vscode.workspace.fs.createDirectory(dir);
      await vscode.workspace.fs.writeFile(luaUri, enc.encode(luaTemplate(name)));
      await vscode.workspace.fs.writeFile(xmlUri, enc.encode(xmlTemplate(name, cfg().get('dataVersion'))));
      await vscode.window.showTextDocument(luaUri);
    })
  );

  // ---- import command helper
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.copyImportCommand', async (slotArg) => {
      const file = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName;
      const manifest = file && findManifest(file);
      if (!manifest) return vscode.window.showWarningMessage('Open a plugin .lua or .xml file first.');
      const lib = path.basename(manifest, path.extname(manifest));
      const slot =
        slotArg !== undefined
          ? String(slotArg)
          : await vscode.window.showInputBox({ prompt: 'Plugin pool slot', value: '1', validateInput: (v) => (/^\d+$/.test(v) ? null : 'Number') });
      if (!slot) return;
      if (!/^\d+$/.test(slot)) return vscode.window.showErrorMessage('Plugin pool slot must be a number.');
      // The Library form creates a real plugin; plain `Import "x" At Plugin` makes an empty UserPlugin.
      await vscode.env.clipboard.writeText(`Import Plugin Library "${lib}" At Plugin ${slot} /nc`);
      vscode.window.showInformationMessage('Import command copied. Paste it into the console command line.');
    })
  );

  // ---- refresh API from a HelpLua dump
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.importHelpLua', async (fileArg) => {
      const pick =
        typeof fileArg === 'string'
          ? [vscode.Uri.file(fileArg)]
          : await vscode.window.showOpenDialog({
              canSelectMany: false,
              defaultUri: vscode.Uri.file(path.join(path.dirname(path.dirname(path.dirname(pluginsFolder() || '.'))), 'grandMA3_lua_functions.txt')),
              filters: { Text: ['txt'] },
              title: 'grandMA3_lua_functions.txt (run HelpLua on the console to create it)',
            });
      if (!pick) return;
      const api = parseHelpLua(fs.readFileSync(pick[0].fsPath, 'utf8'));
      if (api.global.length === 0) return vscode.window.showErrorMessage('No API functions found in that file.');
      fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
      fs.writeFileSync(path.join(context.globalStorageUri.fsPath, 'api.json'), JSON.stringify(api));
      index = buildIndex(api);
      vscode.window.showInformationMessage(`Loaded ${api.global.length} global and ${api.object.length} object functions.`);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
