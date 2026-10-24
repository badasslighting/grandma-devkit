'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { parseHelpLua } = require('./lib/helpParser');
const { snippetFor, hoverMarkdown, buildIndex, activeCall } = require('./lib/apiModel');
const { findBlockingLoops } = require('./lib/lint');
const { lintRules } = require('./lib/rules');
const { checkManifest } = require('./lib/manifest');
const { SCHEMA, contextAt, valuesFor } = require('./lib/manifestSchema');
const { luaTemplate, xmlTemplate, validName } = require('./lib/templates');
const { defaultPluginsPath, findManifest, deploy, reloadLua } = require('./lib/deploy');
const { stringContext, suggestKeywords } = require('./lib/cmdContext');
const { listLua, parseList } = require('./lib/objectTree');
const { showLua, parseShow, showSuggestions } = require('./lib/showCache');
const bridge = require('./lib/bridge');
const { defaultBridgeDir } = bridge;

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

  // ---- live show contents (cached; refreshed when stale, never when the bridge is down)
  let showCache = { at: 0, data: null, pending: null };
  const SHOW_TTL_MS = 60000;
  function getShow(force) {
    if (!force && Date.now() - showCache.at < SHOW_TTL_MS) return Promise.resolve(showCache.data);
    if (showCache.pending) return showCache.pending;
    const dir = cfg().get('bridge.dir') || defaultBridgeDir();
    if (!cfg().get('liveCompletion') || !dir || !bridge.status(dir).running) return Promise.resolve(showCache.data);
    showCache.pending = bridge
      .run(dir, showLua(), cfg().get('bridge.timeout'))
      .then((r) => {
        if (r.ok) showCache = { at: Date.now(), data: parseShow(r.returns), pending: null };
        else showCache.pending = null;
        return showCache.data;
      })
      .catch(() => {
        showCache.pending = null;
        return showCache.data;
      });
    return showCache.pending;
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.refreshShow', async () => {
      const data = await getShow(true);
      const n = data ? Object.values(data).reduce((a, v) => a + v.length, 0) : 0;
      vscode.window.showInformationMessage(n ? `Loaded ${n} show objects for completion.` : 'No show data (is the LuaBridge plugin running, and ma3.liveCompletion on?).');
    })
  );

  // ---- completion: globals everywhere, object methods after ':'
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      LUA,
      {
        async provideCompletionItems(doc, pos) {
          const before = doc.lineAt(pos).text.slice(0, pos.character);
          if (/--/.test(before)) return [];
          const str = stringContext(before);
          if (str) {
            if (!str.inCmd) return [];
            const partial = (/[^\s]*$/.exec(str.text) || [''])[0];
            const range = new vscode.Range(pos.line, pos.character - partial.length, pos.line, pos.character);
            const items = suggestKeywords(str.text).map((k) => {
              const item = new vscode.CompletionItem(k.name, k.kind === 'modifier' ? vscode.CompletionItemKind.Operator : vscode.CompletionItemKind.Keyword);
              item.detail = k.kind;
              item.documentation = k.doc;
              item.range = range;
              item.sortText = `${k.rank}${k.name}`;
              return item;
            });
            // Real object numbers and labels from the running show, when the bridge is up.
            for (const o of showSuggestions(str.text, await getShow())) {
              const item = new vscode.CompletionItem(o.no, vscode.CompletionItemKind.Value);
              item.detail = `${o.kind}: ${o.name}`;
              item.filterText = `${o.no} ${o.name}`;
              item.range = range;
              item.sortText = `0${o.no.padStart(6, '0')}`;
              items.push(item);
            }
            return items;
          }
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

  // ---- plugin manifest (.xml) completion and hover
  const XML = { language: 'xml' };
  const isManifest = (doc) => /<GMA3\b/.test(doc.getText()) || doc.getText().trim() === '';
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      XML,
      {
        provideCompletionItems(doc, pos) {
          if (!isManifest(doc)) return [];
          const ctx = contextAt(doc.getText(new vscode.Range(0, 0, pos.line, pos.character)));
          const range = (n) => new vscode.Range(pos.line, pos.character - n, pos.line, pos.character);
          if (ctx.kind === 'element') {
            const names = ctx.parent ? (SCHEMA[ctx.parent] || { children: [] }).children : ['GMA3'];
            return names.map((n) => {
              const item = new vscode.CompletionItem(n, vscode.CompletionItemKind.Struct);
              item.documentation = SCHEMA[n].doc;
              item.range = range(ctx.partial.length);
              const attrs = Object.keys(SCHEMA[n].attrs).filter((a) => /^[A-Z]/.test(a) && (n !== 'Plugin' || a !== 'Author'));
              const body = attrs.map((a, i) => `${a}="\${${i + 1}}"`).join(' ');
              const close = SCHEMA[n].children.length ? `>\n\t$0\n</${n}>` : ' />';
              item.insertText = new vscode.SnippetString(`${n}${body ? ' ' + body : ''}${close}`);
              return item;
            });
          }
          if (ctx.kind === 'attribute' && SCHEMA[ctx.element]) {
            return Object.entries(SCHEMA[ctx.element].attrs)
              .filter(([a]) => !ctx.used.includes(a))
              .map(([a, d]) => {
                const item = new vscode.CompletionItem(a, vscode.CompletionItemKind.Property);
                item.documentation = d;
                item.range = range(ctx.partial.length);
                item.insertText = new vscode.SnippetString(`${a}="\${1}"`);
                return item;
              });
          }
          if (ctx.kind === 'value') {
            return valuesFor(ctx.element, ctx.attr).map((v) => {
              const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Value);
              item.range = range(ctx.partial.length);
              return item;
            });
          }
          return [];
        },
      },
      '<',
      ' ',
      '"'
    ),
    vscode.languages.registerHoverProvider(XML, {
      provideHover(doc, pos) {
        if (!isManifest(doc)) return null;
        const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_][\w.-]*/);
        if (!range) return null;
        const word = doc.getText(range);
        const ctx = contextAt(doc.getText(new vscode.Range(0, 0, pos.line, range.end.character)));
        if (ctx.kind === 'element' && SCHEMA[word]) return new vscode.Hover(new vscode.MarkdownString(`**<${word}>** ${SCHEMA[word].doc}`), range);
        if (ctx.kind === 'attribute' && SCHEMA[ctx.element] && SCHEMA[ctx.element].attrs[word])
          return new vscode.Hover(new vscode.MarkdownString(`**${word}** ${SCHEMA[ctx.element].attrs[word]}`), range);
        return null;
      },
    })
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
      const sev = { warning: vscode.DiagnosticSeverity.Warning, hint: vscode.DiagnosticSeverity.Hint };
      for (const f of lintRules(doc.getText(), index.api, { globals: cfg().get('lint.globals') })) {
        const d = new vscode.Diagnostic(lineRange(f.line), f.message, sev[f.severity]);
        d.code = f.rule;
        found.push(d);
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
      return manifest;
    } catch (err) {
      vscode.window.showErrorMessage(`grandMA3 deploy failed: ${err.message}`);
      return null;
    }
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.deployAndRun', async () => {
      const file = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName;
      if (!file) return vscode.window.showWarningMessage('Open a plugin .lua or .xml file first.');
      await vscode.workspace.saveAll(false);
      const manifest = deployFile(file, true);
      if (!manifest) return;
      const slot = cfg().get('deployAndRun.slot');
      if (!slot) return vscode.window.showInformationMessage('Deployed. Set ma3.deployAndRun.slot to also re-import and start the plugin on the console.');
      output.show(true);
      output.appendLine(`> reload ${path.basename(manifest)} into Plugin ${slot}`);
      try {
        const r = await bridge.run(bridgeDir(), reloadLua(path.basename(manifest, path.extname(manifest)), slot), cfg().get('bridge.timeout'));
        output.appendLine(bridge.formatResult(r));
      } catch (err) {
        output.appendLine(`bridge error: ${err.message}`);
        vscode.window.showErrorMessage(`grandMA3 reload failed: ${err.message}`);
      }
    }),
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

  // ---- run on console through the LuaBridge plugin
  const output = vscode.window.createOutputChannel('grandMA3');
  const runDiagnostics = vscode.languages.createDiagnosticCollection('ma3-run');
  context.subscriptions.push(output, runDiagnostics);
  const bridgeDir = () => cfg().get('bridge.dir') || defaultBridgeDir();

  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.runOnConsole', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'lua') return vscode.window.showWarningMessage('Open a Lua file first.');
      const sel = editor.selection;
      const code = sel.isEmpty ? editor.document.getText() : editor.document.getText(sel);
      const offset = sel.isEmpty ? 0 : sel.start.line;
      runDiagnostics.delete(editor.document.uri);
      output.show(true);
      output.appendLine(`> run ${path.basename(editor.document.fileName)}${sel.isEmpty ? '' : ` (lines ${sel.start.line + 1}-${sel.end.line + 1})`}`);
      try {
        const r = await bridge.run(bridgeDir(), code, cfg().get('bridge.timeout'));
        output.appendLine(bridge.formatResult(r));
        const line = r.ok ? null : bridge.errorLine(r.error, offset);
        if (line !== null) {
          const range = editor.document.lineAt(Math.min(line, editor.document.lineCount - 1)).range;
          runDiagnostics.set(editor.document.uri, [new vscode.Diagnostic(range, String(r.error).split('\n')[0], vscode.DiagnosticSeverity.Error)]);
        }
      } catch (err) {
        output.appendLine(`bridge error: ${err.message}`);
        vscode.window.showErrorMessage(`grandMA3 run failed: ${err.message}`);
      }
    }),
    vscode.commands.registerCommand('ma3.bridgeStatus', () => {
      const st = bridge.status(bridgeDir());
      vscode.window.showInformationMessage(st.running ? `LuaBridge running (heartbeat ${st.ageS}s ago).` : `LuaBridge not running. ${st.reason || `Last heartbeat ${st.ageS}s ago.`}`);
    }),
    vscode.commands.registerCommand('ma3.bridgeReset', async () => {
      try {
        await bridge.reset(bridgeDir());
        vscode.window.setStatusBarMessage('LuaBridge globals cleared', 3000);
      } catch (err) {
        vscode.window.showErrorMessage(`grandMA3 reset failed: ${err.message}`);
      }
    })
  );

  // ---- console object browser (tree of Root() through the bridge)
  const treeChanged = new vscode.EventEmitter();
  const luaPath = (p) => `Root()${p.map((i) => `[${i}]`).join('')}`;
  const objectTree = {
    onDidChangeTreeData: treeChanged.event,
    getTreeItem: (el) => el.item,
    async getChildren(el) {
      const path = el ? el.path : [];
      try {
        const r = await bridge.run(bridgeDir(), listLua(path), cfg().get('bridge.timeout'));
        if (!r.ok) throw new Error(String(r.error).split('\n')[0]);
        const { total, items } = parseList(r.returns);
        const nodes = items.map((c) => {
          const item = new vscode.TreeItem(c.name, c.count > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
          item.description = c.addr;
          item.tooltip = `${c.name}\n${luaPath(path.concat(c.index))}\n${c.count} child${c.count === 1 ? '' : 'ren'}`;
          item.contextValue = 'ma3object';
          return { item, path: path.concat(c.index), addr: c.addr };
        });
        const last = items.length ? items[items.length - 1].index : 0;
        if (last < total) {
          const item = new vscode.TreeItem(`${total - last} more not shown`);
          item.description = 'index into it from Lua';
          nodes.push({ item, path });
        }
        return nodes;
      } catch (err) {
        return [{ item: new vscode.TreeItem(`${err.message} (refresh to retry)`), path, error: true }];
      }
    },
  };
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ma3.objects', objectTree),
    vscode.commands.registerCommand('ma3.objects.refresh', () => treeChanged.fire()),
    vscode.commands.registerCommand('ma3.objects.copyPath', async (el) => {
      if (!el || !el.path) return;
      await vscode.env.clipboard.writeText(luaPath(el.path));
      vscode.window.setStatusBarMessage(`Copied ${luaPath(el.path)}`, 3000);
    }),
    vscode.commands.registerCommand('ma3.objects.copyAddress', async (el) => {
      if (!el || !el.addr) return;
      await vscode.env.clipboard.writeText(el.addr);
      vscode.window.setStatusBarMessage(`Copied ${el.addr}`, 3000);
    }),
    vscode.commands.registerCommand('ma3.objects.insertPath', async (el) => {
      const editor = vscode.window.activeTextEditor;
      if (!el || !el.path || !editor) return;
      await editor.edit((b) => b.insert(editor.selection.active, luaPath(el.path)));
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
