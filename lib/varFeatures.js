'use strict';
const fs = require('fs');
const path = require('path');
const V = require('./variables');
const { scanFile, buildKnown, findAll, replacementFor, positionOf } = require('./varIndex');
const { macroKind, commandSegments } = require('./macroFiles');
const { commandStrings, KEYWORD_DOCS, BRACKET_DOC, parseBracket } = require('./conditions');
const { stringContext, suggestKeywords, conditionSuggestions } = require('./cmdContext');
const { unquote } = require('./objectTree');
const { quoteMask } = require('./quoteMask');
const Bank = require('./varBank');

// Variable support for the editor: a workspace index of every definition and use (Lua files and macro files),
// diagnostics, completion, hover, go to definition, references, rename, refactoring commands, and a live view of
// the variables on a running console. The logic lives in variables.js / varIndex.js / macroFiles.js (no VS Code
// there); this file wires it to the editor.

const FILE_GLOB = '**/*.{lua,gma2macro,gma3macro,xml}';
const IDENT = /^[A-Za-z_]\w*$/;
const MAX_FILE = 2 * 1024 * 1024;
const SCOPE_LABEL = { global: 'global', user: 'user', plugin: 'plugin', addon: 'addon', unknown: '' };

function register(deps) {
  const { vscode, context, cfg, targetOf, targetOfFile, bridge, bridgeDirFor, openSession, telnetOptions, onChange } = deps;
  const out = vscode.window.createOutputChannel('grandMA Variables');
  context.subscriptions.push(out);
  const bankChanged = new vscode.EventEmitter();

  // ---- the index ----------------------------------------------------------------------------------
  const docScans = new Map(); // uri -> {version, scan, target}
  const fileScans = new Map(); // fsPath -> {text, scan}
  let generation = 0;
  let knownCache = { generation: -1, ma2: null, ma3: null };

  const isMacroDoc = (doc) => !!macroKind(doc.fileName, doc.languageId === 'xml' || /macro$/.test(doc.languageId) ? doc.getText() : '');
  const kindOf = (doc) => (doc.languageId === 'lua' ? 'lua' : isMacroDoc(doc) ? 'macro' : null);

  function scanOf(doc) {
    const key = doc.uri.toString();
    const hit = docScans.get(key);
    if (hit && hit.version === doc.version) return hit.scan;
    const kind = kindOf(doc);
    if (!kind) return null;
    const scan = scanFile(doc.getText(), doc.fileName, doc.languageId, kind === 'lua' ? targetOf(doc) : undefined);
    docScans.set(key, { version: doc.version, scan });
    generation++;
    return scan;
  }

  async function indexFile(uri) {
    if (uri.scheme !== 'file') return;
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) return;
    try {
      const stat = fs.statSync(uri.fsPath);
      if (!stat.isFile() || stat.size > MAX_FILE) return;
      const text = fs.readFileSync(uri.fsPath, 'utf8');
      const lua = /\.lua$/i.test(uri.fsPath);
      if (!lua && !macroKind(uri.fsPath, text)) return fileScans.delete(uri.fsPath);
      const scan = scanFile(text, uri.fsPath, lua ? 'lua' : '', lua ? targetOfFile(text, uri.fsPath) : undefined);
      fileScans.set(uri.fsPath, { text, scan });
      generation++;
    } catch (_) {
      fileScans.delete(uri.fsPath);
    }
  }
  async function indexWorkspace() {
    if (!vscode.workspace.workspaceFolders) return;
    const files = await vscode.workspace.findFiles(FILE_GLOB, '{**/node_modules/**,**/.git/**,**/dist/**}', 3000);
    for (const f of files) await indexFile(f);
    notify();
  }
  let notifyTimer = null;
  function notify() {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      if (onChange) onChange();
      bankChanged.fire();
    }, 300);
  }
  const watcher = vscode.workspace.createFileSystemWatcher(FILE_GLOB);
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate((u) => indexFile(u).then(notify)),
    watcher.onDidChange((u) => indexFile(u).then(notify)),
    watcher.onDidDelete((u) => {
      fileScans.delete(u.fsPath);
      generation++;
      notify();
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      docScans.delete(d.uri.toString());
      indexFile(d.uri);
    })
  );
  indexWorkspace().catch(() => {});

  // [{file, uri, doc?, text, scan}] for every indexed file; an open document wins over the disk copy.
  function entries() {
    const list = [];
    const open = new Set();
    for (const d of vscode.workspace.textDocuments) {
      if (d.uri.scheme !== 'file' && d.uri.scheme !== 'untitled') continue;
      const scan = scanOf(d);
      if (!scan) continue;
      open.add(d.uri.fsPath);
      list.push({ file: d.uri.fsPath, uri: d.uri, doc: d, text: d.getText(), scan });
    }
    for (const [file, e] of fileScans) if (!open.has(file)) list.push({ file, uri: vscode.Uri.file(file), text: e.text, scan: e.scan });
    return list;
  }
  function known(target) {
    if (knownCache.generation !== generation) knownCache = { generation, ma2: null, ma3: null };
    if (!knownCache[target]) knownCache[target] = buildKnown(entries(), target);
    return knownCache[target];
  }
  const targetFor = (doc, scan) => (scan && scan.target) || (doc ? targetOf(doc) : 'ma3');
  const rangeOf = (e, start, len) => {
    if (e.doc) return new vscode.Range(e.doc.positionAt(start), e.doc.positionAt(start + len));
    const a = positionOf(e.text, start);
    const b = positionOf(e.text, start + len);
    return new vscode.Range(a.line, a.character, b.line, b.character);
  };
  const literalOf = (o) => {
    if (o.valueText === undefined) return undefined;
    const v = V.unquoteValue(o.valueText);
    return v === '' ? undefined : v;
  };

  // ---- diagnostics --------------------------------------------------------------------------------
  // [{range, message, severity, code, fix?}] for one document: the variable rules, and for a macro file also the
  // command-line rules of conditions.js (a Lua file gets those from the lint rules).
  function findings(doc) {
    const scan = scanOf(doc);
    if (!scan) return [];
    const target = targetFor(doc, scan);
    const list = V.lintVariables(scan.occ, { target, known: known(target) }).concat(scan.issues);
    return list.map((f) => ({
      start: f.offset,
      len: f.len,
      range: new vscode.Range(doc.positionAt(f.offset), doc.positionAt(f.offset + Math.max(0, f.len))),
      message: f.message,
      severity: f.severity === 'hint' ? vscode.DiagnosticSeverity.Hint : vscode.DiagnosticSeverity.Warning,
      code: f.rule,
      fix: f.fix,
    }));
  }

  // ---- what the document says at a position -------------------------------------------------------
  function occurrenceAt(doc, pos) {
    const scan = scanOf(doc);
    if (!scan) return null;
    const offset = doc.offsetAt(pos);
    const o = scan.occ.find((x) => offset >= x.start - (x.form === 'dollar' ? 1 : 0) && offset <= x.start + x.len);
    return o ? { o, scan, target: targetFor(doc, scan) } : null;
  }

  function describe(name, target) {
    const key = V.keyOf(name, target);
    const defs = [];
    let uses = 0;
    for (const e of entries()) {
      if (e.scan.target !== target) continue;
      for (const o of e.scan.occ) {
        if (o.kind === 'qref' || V.keyOf(o.name, target) !== key) continue;
        if (o.kind === 'def') defs.push({ e, o });
        else uses++;
      }
    }
    return { defs, uses };
  }

  const liveCache = { ma2: { at: 0, vars: [] }, ma3: { at: 0, vars: [] } };
  const liveValue = (target, name, scope) => {
    const key = V.keyOf(name, target);
    const list = liveCache[target].vars.filter((v) => V.keyOf(v.name, target) === key);
    return (scope && list.find((v) => v.scope === scope)) || list[0];
  };

  function hoverFor(doc, pos) {
    const hit = occurrenceAt(doc, pos);
    if (!hit) return null;
    const { o, target } = hit;
    const lines = [];
    const consoleName = target === 'ma2' ? 'grandMA2' : 'grandMA3';
    if (o.kind === 'qref') {
      lines.push(`**$${o.name}** is inside quotes: ${target === 'ma3' ? 'grandMA3 drops the "$" and leaves the name' : 'grandMA2 does not expand it (illegal name)'}. Write it outside the quotes.`);
    } else {
      const sys = V.isSystemVar(o.name, target);
      const d = describe(o.name, target);
      lines.push(sys ? `**$${o.name}**: ${consoleName} system variable. ${V.MA2_SYSTEM_VARS[o.name.toUpperCase()]}` : `**$${o.name}**: ${consoleName} variable${o.scope && SCOPE_LABEL[o.scope] ? ` (${SCOPE_LABEL[o.scope]})` : ''}`);
      if (d.defs.length) {
        const shown = d.defs.slice(0, 6).map(({ e, o: def }) => {
          const p = e.doc ? e.doc.positionAt(def.start) : positionOf(e.text, def.start);
          const lit = literalOf(def);
          return `- ${path.basename(e.file)}:${(p.line || 0) + 1}, ${def.scope}${lit !== undefined ? `, value \`${lit}\`` : ''}`;
        });
        lines.push('Set in:', ...shown, d.defs.length > 6 ? `- and ${d.defs.length - 6} more` : '');
      } else if (!sys) lines.push('Not set anywhere in this workspace.');
      lines.push(`${d.uses} use${d.uses === 1 ? '' : 's'}.`);
      const lv = liveValue(target, o.name, o.scope === 'unknown' ? undefined : o.scope);
      if (lv) lines.push(`Console now: \`${lv.value}\`${lv.scope ? ` (${lv.scope})` : ''}`);
      if (target === 'ma3') lines.push('_Names are case-sensitive on grandMA3._');
    }
    const start = o.start - (o.form === 'dollar' ? 1 : 0);
    return new vscode.Hover(new vscode.MarkdownString(lines.filter(Boolean).join('\n\n')), new vscode.Range(doc.positionAt(start), doc.positionAt(o.start + o.len)));
  }

  // The text of the command line the cursor is in, for macro files (the line) and Lua (the Cmd string).
  function commandAt(doc, pos) {
    const offset = doc.offsetAt(pos);
    if (doc.languageId === 'lua') {
      const s = commandStrings(doc.getText()).find((c) => offset >= c.offset && offset <= c.offset + c.text.length);
      return s ? { text: s.text, offset: s.offset, quote: s.quote, dynamic: s.dynamic } : null;
    }
    const macro = commandSegments(doc.getText(), doc.fileName);
    for (const seg of macro.segments) {
      if (offset >= seg.start && offset <= seg.start + (seg.map ? seg.map[seg.map.length - 1] : seg.text.length)) return { text: seg.text, offset: seg.start, segment: seg, target: macro.target };
    }
    return null;
  }

  function macroHover(doc, pos) {
    if (!isMacroDoc(doc)) return null;
    const cmd = commandAt(doc, pos);
    if (!cmd) return null;
    const target = macroKind(doc.fileName, doc.getText()).target;
    const word = doc.getWordRangeAtPosition(pos, /[A-Za-z_]\w*/);
    const b = target === 'ma2' ? parseBracket(cmd.text) : null;
    const rel = doc.offsetAt(pos) - cmd.offset;
    if (b && rel >= b.start && rel <= (b.end < 0 ? cmd.text.length : b.end)) return new vscode.Hover(new vscode.MarkdownString(BRACKET_DOC));
    const doc2 = word && KEYWORD_DOCS[doc.getText(word).toLowerCase()];
    return doc2 ? new vscode.Hover(new vscode.MarkdownString(`**${doc.getText(word)}**: ${doc2}`), word) : null;
  }

  // ---- completion ---------------------------------------------------------------------------------
  const API_NAME = [
    /\b(?:GetVar|SetVar|DelVar)\s*\(\s*(?:\w+\s*\([^()]*\)|\w+)\s*,\s*(["'])([A-Za-z_]\w*)?$/,
    /\bgma\.(?:show|user)\.(?:getvar|setvar)\s*\(\s*(["'])([A-Za-z_]\w*)?$/,
  ];
  const CMD_NAME = /\b(?:SetUserVariable|SetGlobalVariable|AddUserVariable|AddGlobalVariable)\s+\\?"([A-Za-z_]\w*)?$/i;

  // -> {mode: 'dollar' | 'name', partial, target} or null
  function variableContext(doc, pos, target) {
    const before = doc.lineAt(pos).text.slice(0, pos.character);
    if (doc.languageId === 'lua') {
      for (const re of API_NAME) {
        const m = re.exec(before);
        if (m) return { mode: 'name', partial: m[2] || '', target };
      }
      const str = stringContext(before);
      if (!str || !str.inCmd) return null;
      let m = /\$([A-Za-z_]\w*)?$/.exec(str.text);
      if (m && !quoteMask(str.text)[str.text.length - m[0].length]) return { mode: 'dollar', partial: m[1] || '', target };
      if ((m = CMD_NAME.exec(str.text))) return { mode: 'name', partial: m[1] || '', target };
      return null;
    }
    let m = /\$([A-Za-z_]\w*)?$/.exec(before);
    if (m && !quoteMask(before)[before.length - m[0].length]) return { mode: 'dollar', partial: m[1] || '', target };
    if ((m = CMD_NAME.exec(before))) return { mode: 'name', partial: m[1] || '', target };
    return null;
  }

  function variableItems(ctx, pos) {
    const { target, partial } = ctx;
    const range = new vscode.Range(pos.line, pos.character - partial.length, pos.line, pos.character);
    const items = new Map();
    const add = (name, detail, doc, sort) => {
      const key = V.keyOf(name, target);
      if (items.has(key)) return;
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
      item.detail = detail;
      if (doc) item.documentation = new vscode.MarkdownString(doc);
      item.range = range;
      item.sortText = `${sort}${name}`;
      items.set(key, item);
    };
    favorites().filter((f) => f.target === target).forEach((f) => add(f.name, `★ favorite, ${f.scope}${f.value !== '' ? ` = ${f.value}` : ''}`, f.note || 'One of your favorite variables.', '0'));
    const ranked = Bank.usageStats(entries(), target);
    ranked.forEach((st, i) => add(st.name, `${st.scopes.join('/') || 'used'}${st.value !== undefined ? ` = ${st.value}` : ''}  (${Bank.describeUsage(st)})`, 'Ranked by how often the files in this workspace use it.', `1${String(i).padStart(5, '0')}`));
    for (const v of liveCache[target].vars) add(v.name, `${v.scope} = ${v.value}${v.system ? ' (system)' : ''}`, 'Read from the running console.', v.system ? '3' : '2');
    if (target === 'ma2' && ctx.mode === 'dollar') for (const [n, d] of Object.entries(V.MA2_SYSTEM_VARS)) add(n, 'system', d, '4');
    return [...items.values()];
  }

  // ---- values for previews ------------------------------------------------------------------------
  function valueMap(target) {
    const m = new Map();
    for (const e of entries()) {
      if (e.scan.target !== target) continue;
      for (const o of e.scan.occ) {
        if (o.kind !== 'def') continue;
        const lit = literalOf(o);
        if (lit !== undefined) m.set(V.keyOf(o.name, target), lit);
      }
    }
    for (const v of liveCache[target].vars) m.set(V.keyOf(v.name, target), v.value);
    return m;
  }

  // ---- live console variables ---------------------------------------------------------------------
  const runBridge = async (target, lua) => {
    const dir = bridgeDirFor(target);
    if (!dir || !bridge.status(dir).running) throw new Error(`The LuaBridge isn't running on the ${target === 'ma2' ? 'grandMA2' : 'grandMA3'} console.`);
    const r = await bridge.run(dir, lua, cfg().get('bridge.timeout'));
    if (!r.ok) throw new Error(String(r.error).split('\n')[0]);
    return unquote((r.returns && r.returns[0]) || '');
  };

  async function ma2Send(commands) {
    const session = await openSession(await telnetOptions());
    try {
      const replies = [];
      for (const c of commands) replies.push(await session.send(c, { quietMs: 900 }));
      return replies;
    } finally {
      session.close();
    }
  }

  // The variables on a console, newest reading kept in liveCache. grandMA2 is listed with ListVar over Telnet (the
  // bridge can only read names it is given); grandMA3 cannot be listed at all, so only names the workspace knows are read.
  // quiet: a background read for completion; it never opens a Telnet session and, once it fails, waits a minute.
  async function refreshLive(target, extraNames = [], { quiet = false } = {}) {
    if (quiet && Date.now() - (liveCache[target].failedAt || 0) < 60000) return liveCache[target].vars;
    let list;
    if (target === 'ma2') {
      try {
        if (quiet) throw new Error('quiet');
        const [r] = await ma2Send(['ListVar']);
        list = V.parseListVar(r.lines);
      } catch (telnetErr) {
        const names = [...new Set([...known('ma2').values()].map((d) => d[0].name).concat(extraNames))];
        try {
          list = V.parseVarValues(await runBridge('ma2', V.ma2VarsLua(names)));
        } catch (_) {
          throw telnetErr;
        }
      }
    } else {
      const names = [...new Set([...known('ma3').values()].map((d) => d[0].name).concat(extraNames))];
      list = V.parseVarValues(await runBridge('ma3', V.ma3VarsLua(names)));
    }
    liveCache[target] = { at: Date.now(), vars: list };
    return list;
  }

  async function setLive(target, scope, name, value) {
    if (target === 'ma2') {
      await ma2Send([V.ma2SetCommand(scope, name, value)]);
    } else {
      await runBridge('ma3', V.ma3SetLua(scope, name, value));
    }
    liveCache[target].vars = liveCache[target].vars.filter((v) => !(v.scope === scope && V.keyOf(v.name, target) === V.keyOf(name, target)));
    if (value !== null && value !== undefined && value !== '') liveCache[target].vars.push({ scope, name, value: String(value), type: V.isNumber(value) ? 'number' : 'string' });
  }

  // ---- the variables view -------------------------------------------------------------------------
  const treeChanged = new vscode.EventEmitter();
  const extraNames = { ma2: new Set(), ma3: new Set() };
  const varTree = {
    onDidChangeTreeData: treeChanged.event,
    getTreeItem: (n) => n.item,
    async getChildren(el) {
      if (!el) {
        return ['ma2', 'ma3'].map((target) => {
          const item = new vscode.TreeItem(target === 'ma2' ? 'grandMA2' : 'grandMA3', vscode.TreeItemCollapsibleState.Collapsed);
          item.description = target === 'ma2' ? 'ListVar over Telnet' : 'names from this workspace';
          item.contextValue = 'ma3varconsole';
          return { item, target, kind: 'console' };
        });
      }
      if (el.kind === 'console') {
        try {
          const list = await refreshLive(el.target, [...extraNames[el.target]]);
          return ['global', 'user', 'system'].map((scope) => {
            const n = list.filter((v) => (scope === 'system' ? v.system : v.scope === scope && !v.system)).length;
            const item = new vscode.TreeItem(scope[0].toUpperCase() + scope.slice(1), n ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
            item.description = String(n);
            return { item, target: el.target, kind: 'group', scope, list };
          });
        } catch (err) {
          const item = new vscode.TreeItem(err.message);
          item.tooltip = 'Refresh to retry.';
          return [{ item, error: true }];
        }
      }
      if (el.kind === 'group') {
        return el.list
          .filter((v) => (el.scope === 'system' ? v.system : v.scope === el.scope && !v.system))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((v) => {
            const item = new vscode.TreeItem(`$${v.name}`);
            item.description = String(v.value);
            item.tooltip = `$${v.name} = ${v.value}\n${v.scope}${v.type ? `, ${v.type}` : ''}${v.system ? ', system' : ''}`;
            item.contextValue = v.system ? 'ma3varsystem' : 'ma3var';
            return { item, target: el.target, kind: 'var', var: v };
          });
      }
      return [];
    },
  };
  const varView = vscode.window.createTreeView('ma3.vars', { treeDataProvider: varTree });
  context.subscriptions.push(varView);

  // ---- watching, snapshots ------------------------------------------------------------------------
  let watchTimer = null;
  let watchState = null;
  function stopWatch() {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = null;
    watchState = null;
  }
  context.subscriptions.push({ dispose: stopWatch });
  const fmt = (v) => `${v.scope === 'user' ? 'user ' : ''}$${v.name} = ${v.value}`;

  async function snapshotOf(target) {
    const list = await refreshLive(target, [...extraNames[target]]);
    return list.map((v) => ({ scope: v.scope, name: v.name, value: String(v.value) }));
  }

  // ---- commands -----------------------------------------------------------------------------------
  const activeDoc = () => vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
  const cmd = (name, fn) => context.subscriptions.push(vscode.commands.registerCommand(name, fn));
  const scopeOfFor = (target) => (name) => {
    const defs = known(target).get(V.keyOf(name, target)) || [];
    return defs.length && defs.every((d) => d.scope === 'user') ? 'user' : 'global';
  };

  // Applies [{start, len, newText}] (offsets in one entry's text) to an entry through a WorkspaceEdit.
  function addEdits(edit, e, list, occByStart, meta) {
    for (const x of list) edit.replace(e.uri, rangeOf(e, x.start, x.len), occByStart && occByStart.get(x.start) ? replacementFor(occByStart.get(x.start), x.newText) : x.newText, meta);
  }

  cmd('ma3.vars.replaceRange', async (args) => {
    args = args && typeof args === 'object' && !args.fsPath ? args : {};
    const doc = args.uri ? await vscode.workspace.openTextDocument(vscode.Uri.parse(args.uri)) : activeDoc();
    const sel = vscode.window.activeTextEditor && vscode.window.activeTextEditor.selection;
    const seed = sel && !sel.isEmpty && doc ? doc.getText(sel).trim() : '';
    const rangeText = args.range !== undefined ? args.range : await vscode.window.showInputBox({ title: 'Replace variables across a range', prompt: 'The variables, for example $color1 thru $color5', value: /thru|\.\./i.test(seed) ? seed : '', ignoreFocusOut: true });
    if (!rangeText) return null;
    const range = V.parseRange(rangeText);
    if (range.error) {
      if (args.range === undefined) vscode.window.showWarningMessage(range.error);
      return { error: range.error };
    }
    const tpl = args.template !== undefined ? args.template : await vscode.window.showInputBox({ title: 'Replace with', prompt: `New names; {n} is the number, {n+10} an offset, {n:2} zero padded. ${range.names.length} variables: ${range.names[0]} ... ${range.names[range.names.length - 1]}`, value: `${range.prefix}{n}`, ignoreFocusOut: true });
    if (!tpl) return null;
    const scope = args.scope || ((await vscode.window.showQuickPick([{ label: 'This file', value: 'file' }, { label: 'Selection', value: 'selection' }, { label: 'Whole workspace', value: 'workspace' }], { title: 'Where?' })) || {}).value;
    if (!scope) return null;
    const edit = new vscode.WorkspaceEdit();
    let total = 0;
    const files = new Set();
    const targets = scope === 'workspace' ? entries() : entries().filter((e) => doc && e.file === doc.uri.fsPath);
    for (const e of targets) {
      const target = e.scan.target || 'ma3';
      let occ = e.scan.occ;
      if (scope === 'selection' && sel && doc) {
        const a = doc.offsetAt(sel.start);
        const z = doc.offsetAt(sel.end);
        occ = occ.filter((o) => o.start >= a && o.start + o.len <= z);
      }
      const plan = V.planRangeRename(occ, range, tpl, target);
      if (plan.error) {
        if (args.range === undefined) vscode.window.showWarningMessage(plan.error);
        return { error: plan.error };
      }
      if (!plan.edits.length) continue;
      const byStart = new Map(e.scan.occ.map((o) => [o.start, o]));
      addEdits(edit, e, plan.edits, byStart, args.range === undefined && scope === 'workspace' ? { label: 'Rename variable', needsConfirmation: true } : undefined);
      total += plan.edits.length;
      files.add(e.file);
    }
    if (!total) {
      if (args.range === undefined) vscode.window.showInformationMessage('No variable of that range is used here.');
      return { edits: 0, files: 0 };
    }
    const ok = await vscode.workspace.applyEdit(edit);
    if (args.range === undefined) vscode.window.setStatusBarMessage(`Renamed ${total} place${total === 1 ? '' : 's'} in ${files.size} file${files.size === 1 ? '' : 's'}`, 4000);
    return { edits: total, files: files.size, applied: ok, names: range.names };
  });

  cmd('ma3.vars.preview', async (args) => {
    const doc = args && args.uri ? await vscode.workspace.openTextDocument(vscode.Uri.parse(args.uri)) : activeDoc();
    if (!doc) return null;
    const editor = vscode.window.activeTextEditor;
    const pos = args && args.line !== undefined ? new vscode.Position(args.line, args.character || 0) : editor ? editor.selection.active : new vscode.Position(0, 0);
    const c = commandAt(doc, pos);
    if (!c) {
      if (!args) vscode.window.showInformationMessage('Put the cursor in a console command (a Cmd string or a macro line).');
      return null;
    }
    const target = c.target || targetOf(doc);
    const values = valueMap(target);
    const ev = target === 'ma2' ? V.evalLine(c.text, values) : { runs: !/^\s*\[/.test(c.text), command: c.text, conditions: [] };
    const ex = V.expandCommand(ev.command, values, target);
    const lines = [`${c.text}`, `  ->  ${ex.text}`];
    if (target === 'ma2' && ev.conditions.length) lines.push(`  condition [${ev.conditions[ev.conditions.length - 1]}] is ${ev.runs ? 'true: the command runs' : 'false: the command does not run'}`);
    if (target === 'ma3' && /^\s*\[/.test(c.text)) lines.push('  grandMA3 does not run a command that starts with [condition]');
    for (const p of ex.problems) lines.push(`  ! ${p}`);
    out.clear();
    out.appendLine(`Values from this workspace${liveCache[target].vars.length ? ' and the last console reading' : ''}; the real values may differ.`);
    lines.forEach((l) => out.appendLine(l));
    if (!args) out.show(true);
    return { text: ex.text, runs: ev.runs, problems: ex.problems, conditions: ev.conditions };
  });

  cmd('ma3.vars.inline', async (args) => {
    const doc = args && args.uri ? await vscode.workspace.openTextDocument(vscode.Uri.parse(args.uri)) : activeDoc();
    if (!doc) return null;
    const editor = vscode.window.activeTextEditor;
    const hit = args && args.name ? null : occurrenceAt(doc, editor.selection.active);
    const scan = scanOf(doc);
    if (!scan) return null;
    const target = targetFor(doc, scan);
    const name = (args && args.name) || (hit && hit.o.name);
    if (!name) return null;
    let value = args && args.value;
    if (value === undefined) {
      const defs = describe(name, target).defs.map(({ o }) => literalOf(o)).filter((v) => v !== undefined);
      const lv = liveValue(target, name);
      value = defs.length ? defs[defs.length - 1] : lv && lv.value;
      if (value === undefined) value = await vscode.window.showInputBox({ prompt: `Value to write in place of $${name}`, ignoreFocusOut: true });
    }
    if (value === undefined || value === '') return null;
    const plan = V.planInline(scan.occ, name, value, target);
    if (plan.error) {
      if (!args) vscode.window.showWarningMessage(plan.error);
      return { error: plan.error };
    }
    const edit = new vscode.WorkspaceEdit();
    const e = { doc, uri: doc.uri, text: doc.getText() };
    const byStart = new Map(scan.occ.map((o) => [o.start - 1, o]));
    for (const x of plan.edits) edit.replace(doc.uri, rangeOf(e, x.start, x.len), byStart.get(x.start) ? replacementFor(byStart.get(x.start), x.newText) : x.newText);
    await vscode.workspace.applyEdit(edit);
    return { edits: plan.edits.length, value };
  });

  cmd('ma3.vars.extract', async (args) => {
    const doc = args && args.uri ? await vscode.workspace.openTextDocument(vscode.Uri.parse(args.uri)) : activeDoc();
    const editor = vscode.window.activeTextEditor;
    if (!doc) return null;
    const range = args && args.range ? new vscode.Range(args.range[0], args.range[1], args.range[2], args.range[3]) : editor && editor.selection;
    if (!range || range.isEmpty) {
      if (!args) vscode.window.showInformationMessage('Select the value to turn into a variable.');
      return null;
    }
    const scan = scanOf(doc);
    const target = targetFor(doc, scan);
    const c = commandAt(doc, range.start);
    if (!c) {
      if (!args) vscode.window.showInformationMessage('The selection is not inside a console command.');
      return null;
    }
    const literal = doc.getText(range);
    const name = (args && args.name) || (await vscode.window.showInputBox({ prompt: `Name of the variable that will hold ${literal}`, validateInput: (v) => (IDENT.test(v) ? undefined : 'Letters, digits and _, not starting with a digit'), ignoreFocusOut: true }));
    if (!name) return null;
    if (!IDENT.test(name)) return { error: 'invalid name' };
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, range, `$${name}`);
    const line = doc.lineAt(range.start.line);
    const indent = /^\s*/.exec(line.text)[0];
    let def;
    if (doc.languageId === 'lua') def = target === 'ma2' ? `gma.show.setvar('${name}', '${literal.replace(/'/g, "\\'")}')` : `SetVar(GlobalVars(), '${name}', ${V.isNumber(literal) ? literal : `'${literal.replace(/'/g, "\\'")}'`})`;
    else if (macroKind(doc.fileName, doc.getText()).kind === 'xml') def = null;
    else def = V.convertCommand(`SetVar $${name} = ${literal}`, 'ma2', target === 'ma3' ? 'ma3' : 'ma2').text;
    if (def) edit.insert(doc.uri, new vscode.Position(range.start.line, 0), `${indent}${def}${doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'}`);
    await vscode.workspace.applyEdit(edit);
    return { name, definition: def };
  });

  // The other console's version of a file, opened beside as an untitled document.
  async function convertDocument(doc) {
    const scan = scanOf(doc);
    if (!scan) return null;
    const from = targetFor(doc, scan);
    const to = from === 'ma2' ? 'ma3' : 'ma2';
    const text = doc.getText();
    const notes = [];
    const edits = [];
    const kind = kindOf(doc);
    if (kind === 'lua') {
      const lua = V.convertLua(text, from, to);
      lua.notes.forEach((n) => notes.push(n));
      let result = lua.text;
      // command strings inside Cmd(...)
      const strings = commandStrings(result).sort((a, b) => b.offset - a.offset);
      for (const s of strings) {
        const whole = /^\s*(?:Cmd|gma\.cmd)\s*\(\s*(["'])/.exec(result.slice(Math.max(0, result.lastIndexOf('\n', s.offset) + 1), s.offset));
        let replacement = null;
        if (from === 'ma2' && to === 'ma3' && /^\s*\[/.test(s.text) && whole) {
          const lineStart = result.lastIndexOf('\n', s.offset) + 1;
          const lineEnd = result.indexOf('\n', s.offset) < 0 ? result.length : result.indexOf('\n', s.offset);
          const lineText = result.slice(lineStart, lineEnd);
          const m = /^(\s*)(?:Cmd|gma\.cmd)\s*\(\s*(["'])(.*)\2\s*\)\s*$/.exec(lineText);
          const b = m && V.bracketLineToLua(m[3].replace(/\\(["'])/g, '$1'), scopeOfFor('ma2'));
          if (b) {
            result = result.slice(0, lineStart) + m[1] + b.lua + result.slice(lineEnd);
            continue;
          }
          notes.push(`Left as it was (not a single plain comparison): ${s.text.trim().slice(0, 60)}`);
        }
        const c = V.convertCommand(s.text, from, to);
        c.notes.forEach((n) => notes.push(n));
        // the new text sits inside the Lua string literal the old one was in
        replacement = c.text === s.text ? c.text : c.text.replace(new RegExp(`(?<!\\\\)${s.quote === '"' ? '"' : "'"}`, 'g'), `\\${s.quote}`);
        if (replacement !== s.text) result = result.slice(0, s.offset) + replacement + result.slice(s.offset + s.text.length);
      }
      return { to, text: result, notes, language: 'lua' };
    }
    const macro = commandSegments(text, doc.fileName);
    let result = text;
    for (const seg of macro.segments.slice().sort((a, b) => b.start - a.start)) {
      if (seg.map) {
        notes.push('Exported XML is not converted: use the text format (.gma2macro / .gma3macro).');
        return { to, text, notes, language: doc.languageId };
      }
      let c = V.convertCommand(seg.text, from, to);
      let t = c.text;
      c.notes.forEach((n) => notes.push(n));
      if (from === 'ma2' && to === 'ma3' && /^\s*\[/.test(seg.text)) notes.push(`grandMA3 does not run a macro line that starts with [condition]; rewrite as Lua: ${seg.text.trim().slice(0, 60)}`);
      result = result.slice(0, seg.start) + t + result.slice(seg.start + seg.text.length);
    }
    return { to, text: result, notes, language: to === 'ma2' ? 'gma2macro' : 'gma3macro' };
  }
  cmd('ma3.vars.convert', async (args) => {
    const doc = args && args.uri ? await vscode.workspace.openTextDocument(vscode.Uri.parse(args.uri)) : activeDoc();
    if (!doc) return null;
    const r = await convertDocument(doc);
    if (!r) return null;
    if (!args || args.open !== false) {
      const header = r.notes.length ? [`${doc.languageId === 'lua' ? '--' : '#'} Notes from the conversion to ${r.to === 'ma2' ? 'grandMA2' : 'grandMA3'}:`, ...r.notes.map((n) => `${doc.languageId === 'lua' ? '--' : '#'} - ${n}`), ''].join('\n') : '';
      const opened = await vscode.workspace.openTextDocument({ content: header + r.text, language: r.language });
      await vscode.window.showTextDocument(opened, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    }
    return r;
  });

  // -- live view commands
  cmd('ma3.vars.refresh', () => treeChanged.fire());
  const pickConsole = async (arg) => arg || (await vscode.window.showQuickPick(['ma2', 'ma3'].map((t) => ({ label: t === 'ma2' ? 'grandMA2' : 'grandMA3', value: t })), { title: 'Console' }));
  cmd('ma3.vars.copyName', async (el) => {
    if (!el || !el.var) return;
    await vscode.env.clipboard.writeText(`$${el.var.name}`);
    vscode.window.setStatusBarMessage(`Copied $${el.var.name}`, 3000);
  });
  const confirmed = async (args, message) => (args && args.confirmed) || (await vscode.window.showWarningMessage(message, { modal: true }, 'Do it')) === 'Do it';
  cmd('ma3.vars.set', async (el) => {
    const a = el && el.target && !el.var ? el : {};
    const v = el && el.var ? el.var : null;
    const target = (el && el.target) || ((await pickConsole()) || {}).value;
    if (!target) return null;
    const scope = a.scope || (v && v.scope) || ((await vscode.window.showQuickPick(['global', 'user'], { title: 'Scope' })) || null);
    const name = a.name || (v && v.name) || (await vscode.window.showInputBox({ prompt: 'Variable name', validateInput: (x) => (IDENT.test(x) ? undefined : 'Letters, digits and _'), ignoreFocusOut: true }));
    if (!name || !scope) return null;
    const value = a.value !== undefined ? a.value : await vscode.window.showInputBox({ prompt: `New value of $${name}`, value: v ? String(v.value) : '', ignoreFocusOut: true });
    if (value === undefined) return null;
    if (!(await confirmed(a, `Set $${name} on the ${target === 'ma2' ? 'grandMA2' : 'grandMA3'} console?`))) return null;
    if (target === 'ma3') extraNames.ma3.add(name);
    await setLive(target, scope, name, value);
    treeChanged.fire();
    return { target, scope, name, value };
  });
  cmd('ma3.vars.add', (a) => vscode.commands.executeCommand('ma3.vars.set', a && a.target ? a : undefined));
  cmd('ma3.vars.delete', async (el) => {
    const v = el && el.var;
    if (!v) return null;
    if (v.system) return vscode.window.showWarningMessage('System variables are read-only.');
    if (!(await confirmed(el, `Delete $${v.name} on the ${el.target === 'ma2' ? 'grandMA2' : 'grandMA3'} console?`))) return null;
    await setLive(el.target, v.scope, v.name, null);
    treeChanged.fire();
    return { deleted: v.name };
  });
  cmd('ma3.vars.watch', async (args) => {
    stopWatch();
    const target = (args && args.target) || ((await pickConsole()) || {}).value;
    if (!target) return null;
    out.show(true);
    watchState = await snapshotOf(target);
    out.appendLine(`Watching ${target === 'ma2' ? 'grandMA2' : 'grandMA3'} variables (${watchState.length} now${target === 'ma3' ? '; only names this workspace knows' : ''}). Stop with "grandMA: Stop Watching Variables".`);
    const every = Math.max(500, (args && args.intervalMs) || cfg().get('vars.watchIntervalMs') || 2000);
    watchTimer = setInterval(async () => {
      try {
        const now = await snapshotOf(target);
        const d = V.diffVars(watchState, now, target);
        const stamp = new Date().toLocaleTimeString();
        d.added.forEach((v) => out.appendLine(`${stamp}  + ${fmt(v)}`));
        d.removed.forEach((v) => out.appendLine(`${stamp}  - ${fmt(v)}`));
        d.changed.forEach((c) => out.appendLine(`${stamp}  ~ ${c.scope === 'user' ? 'user ' : ''}$${c.name}: ${c.from} -> ${c.to}`));
        watchState = now;
        if (d.added.length + d.removed.length + d.changed.length) treeChanged.fire();
      } catch (err) {
        out.appendLine(`watch stopped: ${err.message}`);
        stopWatch();
      }
    }, every);
    return { watching: true, count: watchState.length };
  });
  cmd('ma3.vars.stopWatch', () => {
    const was = !!watchTimer;
    stopWatch();
    if (was) out.appendLine('Stopped watching.');
    return { stopped: was };
  });
  cmd('ma3.vars.snapshot', async (args) => {
    const target = (args && args.target) || ((await pickConsole()) || {}).value;
    if (!target) return null;
    const vars = await snapshotOf(target);
    await context.globalState.update(`ma3.vars.snapshot.${target}`, { at: Date.now(), vars });
    if (!args) vscode.window.setStatusBarMessage(`Saved a snapshot of ${vars.length} variables`, 4000);
    return { count: vars.length };
  });
  cmd('ma3.vars.diff', async (args) => {
    const target = (args && args.target) || ((await pickConsole()) || {}).value;
    if (!target) return null;
    const snap = context.globalState.get(`ma3.vars.snapshot.${target}`);
    if (!snap) {
      if (!args) vscode.window.showInformationMessage('No snapshot yet: run "grandMA: Snapshot Console Variables" first.');
      return null;
    }
    const now = await snapshotOf(target);
    const d = V.diffVars(snap.vars, now, target);
    out.clear();
    out.appendLine(`Variables now compared with the snapshot from ${new Date(snap.at).toLocaleString()}:`);
    d.added.forEach((v) => out.appendLine(`  + ${fmt(v)}`));
    d.removed.forEach((v) => out.appendLine(`  - ${fmt(v)}`));
    d.changed.forEach((c) => out.appendLine(`  ~ ${c.scope === 'user' ? 'user ' : ''}$${c.name}: ${c.from} -> ${c.to}`));
    if (!d.added.length && !d.removed.length && !d.changed.length) out.appendLine('  no differences');
    if (!args) out.show(true);
    return d;
  });
  cmd('ma3.vars.restore', async (args) => {
    const target = (args && args.target) || ((await pickConsole()) || {}).value;
    if (!target) return null;
    const snap = context.globalState.get(`ma3.vars.snapshot.${target}`);
    if (!snap) return null;
    const now = await snapshotOf(target);
    const plan = V.restorePlan(snap.vars, now, target);
    if (!plan.set.length && !plan.clear.length) return { set: 0, cleared: 0 };
    if (!(await confirmed(args, `Restore the snapshot: set ${plan.set.length} variable(s) and clear ${plan.clear.length} on the ${target === 'ma2' ? 'grandMA2' : 'grandMA3'} console?`))) return null;
    for (const v of plan.set) await setLive(target, v.scope, v.name, v.value);
    for (const v of plan.clear) await setLive(target, v.scope, v.name, null);
    treeChanged.fire();
    return { set: plan.set.length, cleared: plan.clear.length };
  });

  // ---- language features --------------------------------------------------------------------------
  // ---- the variable bank: ranked usage, stock variables, and the user's favorites ---------------------
  const FAV_KEY = 'ma3.vars.favorites';
  if (context.globalState.setKeysForSync) context.globalState.setKeysForSync([FAV_KEY]);
  const favorites = () => context.globalState.get(FAV_KEY, []);
  async function saveFavorites(list) {
    await context.globalState.update(FAV_KEY, list);
    bankChanged.fire();
  }
  const consoleName = (t) => (t === 'ma2' ? 'grandMA2' : 'grandMA3');
  const tag = (t) => (t === 'ma2' ? 'MA2' : 'MA3');

  const bankTree = {
    onDidChangeTreeData: bankChanged.event,
    getTreeItem: (n) => n.item,
    getChildren(el) {
      if (!el) {
        const favs = favorites();
        const stats = Bank.usageStats(entries());
        const group = (label, n, kind, note) => {
          const item = new vscode.TreeItem(label, n ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
          item.description = note || String(n);
          return { item, kind };
        };
        return [
          group('Favorites', favs.length, 'favorites', favs.length ? String(favs.length) : 'none yet: star a variable'),
          group('In use', stats.length, 'inuse', stats.length ? `${stats.length}, most used first` : 'no variables in this workspace'),
          group('Stock grandMA2', Bank.stockVars('ma2').length, 'stock2'),
          group('Stock grandMA3', 0, 'stock3', 'none found'),
        ];
      }
      if (el.kind === 'favorites') {
        return favorites().map((f) => {
          const item = new vscode.TreeItem(`$${f.name}`);
          item.description = `${tag(f.target)} ${f.scope}${f.value !== '' ? ` = ${f.value}` : ''}${f.note ? `  ${f.note}` : ''}`;
          item.iconPath = new vscode.ThemeIcon('star-full');
          item.contextValue = 'ma3bankfav';
          item.tooltip = `${consoleName(f.target)} ${f.scope} variable${f.note ? `\n${f.note}` : ''}`;
          return { item, kind: 'fav', fav: f };
        });
      }
      if (el.kind === 'inuse') {
        const favs = favorites();
        return Bank.usageStats(entries()).map((s) => {
          const item = new vscode.TreeItem(`$${s.name}`);
          item.description = `${Bank.describeUsage(s)}  ${tag(s.target)}${s.scopes.length ? ` ${s.scopes.join('/')}` : ''}${s.value !== undefined ? ` = ${s.value}` : ''}`;
          item.iconPath = Bank.isFavorite(favs, s.name, s.target) ? new vscode.ThemeIcon('star-full') : undefined;
          item.contextValue = 'ma3bankvar';
          item.command = { command: 'ma3.bank.reveal', title: 'Show where it is used', arguments: [{ kind: 'var', stat: s }] };
          return { item, kind: 'var', stat: s };
        });
      }
      if (el.kind === 'stock2') {
        return Bank.stockVars('ma2').map((v) => {
          const item = new vscode.TreeItem(`$${v.name}`);
          item.description = v.doc;
          item.contextValue = 'ma3bankstock';
          return { item, kind: 'stock', stock: v };
        });
      }
      return [];
    },
  };
  const bankView = vscode.window.createTreeView('ma3.varbank', { treeDataProvider: bankTree });
  context.subscriptions.push(bankView);

  // The variable under the cursor, or one given as a tree element or in the arguments -> {name, target, scope, value}.
  function variableFrom(arg) {
    if (arg && arg.stat) return { name: arg.stat.name, target: arg.stat.target, scope: arg.stat.scopes[0] || 'global', value: arg.stat.value };
    if (arg && arg.fav) return { ...arg.fav };
    if (arg && arg.stock) return { name: arg.stock.name, target: 'ma2', scope: 'global', value: '' };
    if (arg && arg.name) return { target: 'ma2', scope: 'global', ...arg };
    const doc = activeDoc();
    const ed = vscode.window.activeTextEditor;
    const hit = doc && ed && occurrenceAt(doc, ed.selection.active);
    if (hit && hit.o.kind !== 'qref') {
      const lit = describe(hit.o.name, hit.target).defs.map(({ o }) => literalOf(o)).filter((v) => v !== undefined).pop();
      return { name: hit.o.name, target: hit.target, scope: hit.o.scope === 'user' ? 'user' : 'global', value: lit };
    }
    return null;
  }

  cmd('ma3.bank.refresh', () => bankChanged.fire());
  cmd('ma3.bank.favorite', async (arg) => {
    let v = variableFrom(arg);
    if (!v) {
      const name = await vscode.window.showInputBox({ prompt: 'Variable name to keep in your favorites', ignoreFocusOut: true });
      if (!name) return null;
      const target = ((await pickConsole()) || {}).value;
      if (!target) return null;
      v = { name, target, scope: 'global' };
    }
    const list = Bank.addFavorite(favorites(), v);
    await saveFavorites(list);
    return { count: list.length, name: v.name };
  });
  cmd('ma3.bank.unfavorite', async (arg) => {
    const v = variableFrom(arg);
    if (!v) return null;
    const list = Bank.removeFavorite(favorites(), v);
    await saveFavorites(list);
    return { count: list.length };
  });
  cmd('ma3.bank.editFavorite', async (arg) => {
    const v = variableFrom(arg);
    if (!v) return null;
    const cur = favorites().find((f) => f.target === v.target && V.keyOf(f.name, f.target) === V.keyOf(v.name, v.target)) || v;
    const value = arg && arg.value !== undefined ? arg.value : await vscode.window.showInputBox({ prompt: `Value of $${cur.name} (empty for none; it is set on the console by "Apply Favorites")`, value: cur.value || '', ignoreFocusOut: true });
    if (value === undefined) return null;
    const note = arg && arg.note !== undefined ? arg.note : await vscode.window.showInputBox({ prompt: `Note for $${cur.name}`, value: cur.note || '', ignoreFocusOut: true });
    if (note === undefined) return null;
    const list = Bank.addFavorite(favorites(), { ...cur, value, note });
    await saveFavorites(list);
    return { count: list.length };
  });
  cmd('ma3.bank.reveal', async (arg) => {
    const s = arg && arg.stat;
    if (!s) return null;
    const hits = findAll(entries(), s.name, s.target);
    const first = hits.find((h) => h.occ.kind === 'def') || hits[0];
    if (!first) return null;
    const e = entries().find((x) => x.file === first.file);
    const doc = await vscode.workspace.openTextDocument(e.uri);
    const r = rangeOf(e, first.occ.start, first.occ.len);
    await vscode.window.showTextDocument(doc, { selection: r, preview: true });
    return { file: first.file };
  });
  cmd('ma3.bank.insert', async (args) => {
    const favs = favorites();
    const stats = Bank.usageStats(entries());
    let pick = args && args.name ? { name: args.name } : null;
    if (!pick) {
      const items = [
        ...favs.map((f) => ({ label: `$${f.name}`, description: `★ ${tag(f.target)} ${f.scope}${f.value !== '' ? ` = ${f.value}` : ''}`, detail: f.note, name: f.name })),
        ...stats.map((s) => ({ label: `$${s.name}`, description: `${Bank.describeUsage(s)}  ${tag(s.target)}`, name: s.name })),
        ...Bank.stockVars('ma2').map((v) => ({ label: `$${v.name}`, description: 'stock grandMA2', detail: v.doc, name: v.name })),
      ];
      pick = await vscode.window.showQuickPick(items, { title: 'Insert a variable', matchOnDescription: true, matchOnDetail: true });
      if (!pick) return null;
    }
    const ed = vscode.window.activeTextEditor;
    if (!ed) return null;
    const ctx = variableContext(ed.document, ed.selection.active, targetFor(ed.document, scanOf(ed.document)));
    // inside a name or after a $, the part already typed is replaced; elsewhere a whole $name goes in
    const text = ctx ? pick.name : '$' + pick.name;
    const at = ed.selection.active;
    await ed.edit((b) => b.replace(new vscode.Range(at.line, at.character - (ctx ? ctx.partial.length : 0), at.line, at.character), text));
    return { text, mode: ctx ? ctx.mode : null, partial: ctx ? ctx.partial : null, cursor: at.character };
  });
  cmd('ma3.bank.export', async (args) => {
    const file = (args && args.path) || ((await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join((vscode.workspace.workspaceFolders || [{ uri: { fsPath: '.' } }])[0].uri.fsPath, 'grandma-variables.json')), filters: { JSON: ['json'] } })) || {}).fsPath;
    if (!file) return null;
    fs.writeFileSync(file, Bank.exportFavorites(favorites()));
    return { path: file, count: favorites().length };
  });
  cmd('ma3.bank.import', async (args) => {
    const file = (args && args.path) || (((await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] } })) || [])[0] || {}).fsPath;
    if (!file) return null;
    let r;
    try {
      r = Bank.importFavorites(fs.readFileSync(file, 'utf8'), favorites());
    } catch (err) {
      if (!args) vscode.window.showErrorMessage(err.message);
      return { error: err.message };
    }
    const before = favorites().length;
    await saveFavorites(r.list);
    return { added: r.list.length - before, skipped: r.skipped, count: r.list.length };
  });
  cmd('ma3.bank.applyFavorites', async (args) => {
    const target = (args && args.target) || ((await pickConsole()) || {}).value;
    if (!target) return null;
    const todo = favorites().filter((f) => f.target === target && f.value !== '');
    if (!todo.length) {
      if (!args) vscode.window.showInformationMessage(`None of your ${consoleName(target)} favorites has a value to set.`);
      return { set: 0 };
    }
    if (!(await confirmed(args, `Set ${todo.length} favorite variable(s) on the ${consoleName(target)} console?`))) return null;
    for (const f of todo) await setLive(target, f.scope, f.name, f.value);
    treeChanged.fire();
    return { set: todo.length };
  });

  const SELECTOR = [{ language: 'lua' }, { language: 'gma2macro' }, { language: 'gma3macro' }, { language: 'xml' }];
  const active = (doc) => !!kindOf(doc);
  const declared = (doc, pos) => {
    const hit = occurrenceAt(doc, pos);
    return hit && hit.o.kind !== 'qref' ? hit : null;
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      SELECTOR,
      {
        provideCompletionItems(doc, pos) {
          if (!active(doc)) return [];
          const scan = scanOf(doc);
          const target = targetFor(doc, scan);
          const ctx = variableContext(doc, pos, target);
          if (ctx) {
            if (Date.now() - liveCache[target].at > 15000 && cfg().get('liveCompletion')) refreshLive(target, [], { quiet: true }).catch(() => { liveCache[target].failedAt = Date.now(); });
            return variableItems(ctx, pos);
          }
          if (doc.languageId === 'lua' || !isMacroDoc(doc)) return [];
          // a macro line: command words, the opening of a [condition], and what goes inside one
          const line = doc.lineAt(pos).text;
          const before = line.slice(0, pos.character);
          if (/^\s*(#|\/\/|@)/.test(before)) return [];
          const cond = conditionSuggestions(before.trim(), target);
          if (cond) {
            const typed = (/[<>=]*$/.exec(before) || [''])[0];
            return cond.map((c) => {
              const item = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Operator);
              item.documentation = c.doc;
              item.insertText = c.insert;
              item.range = new vscode.Range(pos.line, pos.character - typed.length, pos.line, pos.character);
              return item;
            });
          }
          const partial = (/[^\s]*$/.exec(before) || [''])[0];
          const range = new vscode.Range(pos.line, pos.character - partial.length, pos.line, pos.character);
          const items = suggestKeywords(before).map((k) => {
            const item = new vscode.CompletionItem(k.name, k.kind === 'modifier' ? vscode.CompletionItemKind.Operator : vscode.CompletionItemKind.Keyword);
            item.detail = k.kind;
            item.documentation = k.doc;
            item.range = range;
            item.sortText = `${k.rank}${k.name}`;
            return item;
          });
          if (target === 'ma2' && !before.trim()) {
            const item = new vscode.CompletionItem('[condition]', vscode.CompletionItemKind.Snippet);
            item.detail = 'run the rest of the line only if true (grandMA2)';
            item.insertText = new vscode.SnippetString('[\\$${1:var}==${2:value}] $0');
            item.sortText = '0';
            items.push(item);
          }
          return items;
        },
      },
      '$',
      '"',
      "'"
    ),
    vscode.languages.registerHoverProvider(SELECTOR, {
      provideHover(doc, pos) {
        if (!active(doc)) return null;
        return hoverFor(doc, pos) || macroHover(doc, pos);
      },
    }),
    vscode.languages.registerDefinitionProvider(SELECTOR, {
      provideDefinition(doc, pos) {
        if (!active(doc)) return null;
        const hit = declared(doc, pos);
        if (!hit) return null;
        return describe(hit.o.name, hit.target).defs.map(({ e, o }) => new vscode.Location(e.uri, rangeOf(e, o.start, o.len)));
      },
    }),
    vscode.languages.registerReferenceProvider(SELECTOR, {
      provideReferences(doc, pos, rc) {
        if (!active(doc)) return null;
        const hit = declared(doc, pos);
        if (!hit) return null;
        const all = entries();
        return findAll(all, hit.o.name, hit.target)
          .filter((h) => rc.includeDeclaration || h.occ.kind !== 'def')
          .map((h) => {
            const e = all.find((x) => x.file === h.file);
            return new vscode.Location(e.uri, rangeOf(e, h.occ.start, h.occ.len));
          });
      },
    }),
    vscode.languages.registerDocumentHighlightProvider(SELECTOR, {
      provideDocumentHighlights(doc, pos) {
        if (!active(doc)) return null;
        const hit = declared(doc, pos);
        if (!hit) return null;
        const scan = scanOf(doc);
        return scan.occ
          .filter((o) => o.kind !== 'qref' && V.keyOf(o.name, hit.target) === V.keyOf(hit.o.name, hit.target))
          .map((o) => new vscode.DocumentHighlight(new vscode.Range(doc.positionAt(o.start), doc.positionAt(o.start + o.len)), o.kind === 'def' || o.kind === 'del' ? vscode.DocumentHighlightKind.Write : vscode.DocumentHighlightKind.Read));
      },
    }),
    vscode.languages.registerRenameProvider(SELECTOR, {
      prepareRename(doc, pos) {
        const hit = active(doc) && declared(doc, pos);
        if (!hit) throw new Error('Put the cursor on a variable name.');
        if (V.isSystemVar(hit.o.name, hit.target) && !describe(hit.o.name, hit.target).defs.length) throw new Error('System variables cannot be renamed.');
        return new vscode.Range(doc.positionAt(hit.o.start), doc.positionAt(hit.o.start + hit.o.len));
      },
      provideRenameEdits(doc, pos, newName) {
        const hit = declared(doc, pos);
        if (!hit) throw new Error('Put the cursor on a variable name.');
        if (!IDENT.test(newName)) throw new Error('A variable name is letters, digits and _, and does not start with a digit.');
        const { target } = hit;
        if (V.keyOf(newName, target) !== V.keyOf(hit.o.name, target) && (known(target).has(V.keyOf(newName, target)) || V.isSystemVar(newName, target))) throw new Error(`$${newName} is already used; renaming would merge two variables.`);
        const edit = new vscode.WorkspaceEdit();
        const all = entries();
        for (const h of findAll(all, hit.o.name, target)) {
          const e = all.find((x) => x.file === h.file);
          edit.replace(e.uri, rangeOf(e, h.occ.start, h.occ.len), replacementFor(h.occ, newName));
        }
        return edit;
      },
    }),
    vscode.languages.registerCodeActionsProvider(
      SELECTOR,
      {
        provideCodeActions(doc, range, ctx) {
          if (!active(doc)) return [];
          const actions = [];
          const mine = findings(doc);
          for (const d of ctx.diagnostics) {
            const f = mine.find((x) => x.code === d.code && x.range.start.isEqual(d.range.start));
            if (f && f.fix && f.fix.kind === 'replace') {
              const r = f.fix.from !== undefined ? new vscode.Range(doc.positionAt(f.fix.from), doc.positionAt(f.fix.to)) : d.range;
              const edit = new vscode.WorkspaceEdit();
              edit.replace(doc.uri, r, f.fix.text);
              const a = new vscode.CodeAction(`Replace with ${f.fix.text}`, vscode.CodeActionKind.QuickFix);
              a.edit = edit;
              a.diagnostics = [d];
              a.isPreferred = true;
              actions.push(a);
            }
            if (d.code === 'bracket-operator' && doc.getText(d.range) === '!=') {
              const edit = new vscode.WorkspaceEdit();
              edit.replace(doc.uri, d.range, '==');
              const a = new vscode.CodeAction('Write == (that is what grandMA2 does with !=)', vscode.CodeActionKind.QuickFix);
              a.edit = edit;
              a.diagnostics = [d];
              actions.push(a);
            }
            if (d.code === 'bracket-ma3' && doc.languageId === 'lua') {
              const line = doc.lineAt(d.range.start.line);
              const m = /^(\s*)(?:Cmd|gma\.cmd)\s*\(\s*(["'])(.*)\2\s*\)\s*$/.exec(line.text);
              const b = m && V.bracketLineToLua(m[3].replace(/\\(["'])/g, '$1'), scopeOfFor('ma3'));
              if (b) {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(doc.uri, line.range, m[1] + b.lua);
                const a = new vscode.CodeAction('Rewrite as a Lua if', vscode.CodeActionKind.QuickFix);
                a.edit = edit;
                a.diagnostics = [d];
                a.isPreferred = true;
                actions.push(a);
              }
            }
          }
          const hit = declared(doc, range.start);
          if (hit && hit.o.kind === 'ref') {
            const a = new vscode.CodeAction(`Replace $${hit.o.name} with its value`, vscode.CodeActionKind.RefactorInline);
            a.command = { command: 'ma3.vars.inline', title: 'Replace variable with its value' };
            actions.push(a);
          }
          if (!range.isEmpty && commandAt(doc, range.start)) {
            const a = new vscode.CodeAction('Extract to a variable', vscode.CodeActionKind.RefactorExtract);
            a.command = { command: 'ma3.vars.extract', title: 'Extract to a variable' };
            actions.push(a);
          }
          return actions;
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorInline, vscode.CodeActionKind.RefactorExtract] }
    )
  );

  return { findings, scanOf, entries, known, indexWorkspace, isMacroDoc, kindOf, refreshLive, setLive, valueMap, convertDocument, liveCache, commandAt, treeChanged };
}

module.exports = { register, FILE_GLOB };
