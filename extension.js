'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { parseHelpLua } = require('./lib/helpParser');
const { snippetFor, hoverMarkdown, buildIndex, activeCall } = require('./lib/apiModel');
const { findBlockingLoops } = require('./lib/lint');
const { lintRules } = require('./lib/rules');
const { checkManifest } = require('./lib/manifest');
const { SCHEMA, SCHEMA_MA2, schemaFor, rootOf, isMa2, contextAt, valuesFor } = require('./lib/manifestSchema');
const { luaTemplate, xmlTemplate, ma2LuaTemplate, ma2XmlTemplate, validName } = require('./lib/templates');
const { defaultPluginsPath, defaultMa2PluginsPath, filesForManifest, findManifest, deploy, reloadLua, reloadLuaMa2, reloadCommands, importCollisions } = require('./lib/deploy');
const { openSession, listen } = require('./lib/telnet');
const { ma3Stubs, ma2Stubs, mergeLuarc } = require('./lib/stubs');
const { pathContext, childrenLua, parseChildren } = require('./lib/objectPath');
const { buildRunLua, parseResults, discoverTests, errorLine } = require('./lib/luaTests');
const { listRemovableDrives, planExport, exportToStick } = require('./lib/usb');
const { ma3ApiLua, parseMa3Api, diffApi, ma2WalkLua, parseMa2Walk, ma2Gaps } = require('./lib/liveApi');
const { ma2TreeLua, parseMa2Tree, ma2Address, ma2ShowLua } = require('./lib/ma2Objects');
const { sendCommands, oscStatusLua, oscSetupLua, oscDisableLua, parseOscStatus } = require('./lib/osc');
const { BY_PATH, members, memberContext, pathAt, activeCallPath } = require('./lib/ma2Api');
const { detectTarget } = require('./lib/target');
const { bumpVersion, zip } = require('./lib/release');
const { stringContext, suggestKeywords, conditionSuggestions, commandHover } = require('./lib/cmdContext');
const { listLua, parseList } = require('./lib/objectTree');
const props = require('./lib/props');
const { showLua, parseShow, showSuggestions } = require('./lib/showCache');
const { enumNamesLua, enumMembersLua, attributeNamesLua, parseNames, parseMembers, enumContext, attributeContext } = require('./lib/liveNames');
const bridge = require('./lib/bridge');
const { defaultBridgeDir, defaultBridgeDirMa2 } = bridge;

const LUA = { language: 'lua' };
const cfg = () => vscode.workspace.getConfiguration('ma3');
const pluginsFolder = () => cfg().get('pluginsPath') || defaultPluginsPath();
const ma2PluginsFolder = () => cfg().get('ma2.pluginsPath') || defaultMa2PluginsPath();
const bridgeDirFor = (target) => (target === 'ma2' ? cfg().get('ma2.bridgeDir') || defaultBridgeDirMa2() : cfg().get('bridge.dir') || defaultBridgeDir());

// Which console a Lua document targets: the ma3.target setting, `gma.` calls in the code, or the
// manifest next to it (looked up at most every few seconds).
const manifestHint = new Map();
function targetOf(doc) {
  const text = doc.getText();
  const setting = cfg().get('target');
  const quick = detectTarget(text, setting);
  if (setting !== 'auto' || quick === 'ma2' || doc.isUntitled) return quick;
  const dir = path.dirname(doc.fileName);
  const hit = manifestHint.get(dir);
  if (!hit || Date.now() - hit.at > 3000) {
    let xml = '';
    try {
      const m = findManifest(doc.fileName);
      xml = m ? fs.readFileSync(m, 'utf8') : '';
    } catch (_) {
      /* no manifest */
    }
    manifestHint.set(dir, { at: Date.now(), xml });
    return detectTarget(text, setting, xml);
  }
  return detectTarget(text, setting, hit.xml);
}
const manifestIsMa2 = (manifest) => {
  try {
    return isMa2(fs.readFileSync(manifest, 'utf8'));
  } catch (_) {
    return false;
  }
};

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
  const showCaches = { ma3: { at: 0, data: null, pending: null }, ma2: { at: 0, data: null, pending: null } };
  const SHOW_TTL_MS = 60000;
  function getShow(force, target = 'ma3') {
    const cache = showCaches[target];
    if (!force && Date.now() - cache.at < SHOW_TTL_MS) return Promise.resolve(cache.data);
    if (cache.pending) return cache.pending;
    const dir = bridgeDirFor(target);
    if (!cfg().get('liveCompletion') || !dir || !bridge.status(dir).running) return Promise.resolve(cache.data);
    cache.pending = bridge
      .run(dir, target === 'ma2' ? ma2ShowLua() : showLua(), cfg().get('bridge.timeout'))
      .then((r) => {
        if (r.ok) Object.assign(cache, { at: Date.now(), data: parseShow(r.returns), pending: null });
        else cache.pending = null;
        return cache.data;
      })
      .catch(() => {
        cache.pending = null;
        return cache.data;
      });
    return cache.pending;
  }
  // Enum and attribute names: static per software version or fixture patch, so cached for ten minutes.
  const nameCache = new Map();
  async function liveFetch(key, lua, parse, ttlMs = 600000) {
    const hit = nameCache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    const dir = bridgeDirFor('ma3');
    if (!cfg().get('liveCompletion') || !dir || !bridge.status(dir).running) return hit ? hit.data : [];
    try {
      const r = await bridge.run(dir, lua, cfg().get('bridge.timeout'));
      if (r.ok) {
        const data = parse(r.returns);
        nameCache.set(key, { at: Date.now(), data });
        return data;
      }
    } catch (_) {
      /* bridge went away: serve what we had */
    }
    return hit ? hit.data : [];
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.refreshShow', async () => {
      nameCache.clear();
      const data = await getShow(true, activeTarget());
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
          // Property names inside Get()/Set() and the enum values Set() accepts, from the bundled object schema;
          // a literal Root() receiver is asked for its class so the list shrinks to that object's properties.
          const pc = props.propContext(before);
          if (pc && targetOf(doc) === 'ma3') {
            let cls = '';
            if (pc.segments) {
              try {
                cls = await liveFetch(`class:${JSON.stringify(pc.segments)}`, props.pathClassLua(pc.segments), props.parseClass, 30000);
              } catch (_) {
                cls = '';
              }
            }
            if (pc.kind === 'value') {
              return props.valueCandidates(pc.prop, cls).map((v) => {
                const item = new vscode.CompletionItem(v.name, vscode.CompletionItemKind.EnumMember);
                item.detail = `${v.enumName} = ${v.value}`;
                return item;
              });
            }
            return props.nameCandidates(cls).map((p) => {
              const item = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Property);
              item.detail = `${p.type}${p.readOnly ? ' (read-only)' : ''}`;
              const vals = p.enumName ? props.enumValues(p.enumName).map((v) => v.name).slice(0, 24) : [];
              item.documentation = new vscode.MarkdownString([cls ? `Property of ${cls}.` : `Used by ${p.classes} object class${p.classes === 1 ? '' : 'es'}.`, vals.length ? `Values: ${vals.join(', ')}` : ''].filter(Boolean).join('\n\n'));
              item.sortText = `${p.readOnly ? 1 : 0}${p.name}`;
              return item;
            });
          }
          const str = stringContext(before);
          if (str && attributeContext(str) && targetOf(doc) === 'ma3') {
            const names = (await liveFetch('attributes', attributeNamesLua(), parseNames)).map((n) => {
              const item = new vscode.CompletionItem(n, vscode.CompletionItemKind.EnumMember);
              item.detail = 'attribute';
              return item;
            });
            if (!str.inCmd) return names;
            str.attributes = names;
          }
          if (str) {
            if (!str.inCmd) return [];
            const cmdTarget = targetOf(doc);
            // Inside an open grandMA2 [condition]: comparison operators, then the closing bracket.
            const cond = conditionSuggestions(str.text, cmdTarget);
            if (cond) {
              const typed = (/[<>=]*$/.exec(str.text) || [''])[0];
              return cond.map((c) => {
                const item = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Operator);
                item.documentation = c.doc;
                item.insertText = c.insert;
                item.range = new vscode.Range(pos.line, pos.character - typed.length, pos.line, pos.character);
                item.filterText = typed + c.name;
                return item;
              });
            }
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
            // Real object numbers and labels from the running show, when the bridge is up (grandMA3 only).
            if (cmdTarget === 'ma2' && !str.text.trim()) {
              const item = new vscode.CompletionItem('[condition]', vscode.CompletionItemKind.Snippet);
              item.detail = 'run the rest of the line only if true (grandMA2)';
              item.insertText = new vscode.SnippetString('[\\$${1:var}==${2:value}] $0');
              item.sortText = '0';
              item.range = range;
              items.push(item);
            }
            const live = await getShow(false, cmdTarget);
            for (const o of showSuggestions(str.text, live)) {
              const item = new vscode.CompletionItem(o.no, vscode.CompletionItemKind.Value);
              item.detail = `${o.kind}: ${o.name}`;
              item.filterText = `${o.no} ${o.name}`;
              item.range = range;
              item.sortText = `0${o.no.padStart(6, '0')}`;
              items.push(item);
            }
            return items.concat(str.attributes || []);
          }
          const en = enumContext(before);
          if (en && targetOf(doc) === 'ma3') {
            if (en.kind === 'enums') {
              return (await liveFetch('enums', enumNamesLua(), parseNames)).map((n) => new vscode.CompletionItem(n, vscode.CompletionItemKind.Enum));
            }
            return (await liveFetch(`enum:${en.name}`, enumMembersLua(en.name), parseMembers)).map((m) => {
              const item = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.EnumMember);
              item.detail = `Enums.${en.name}.${m.name} = ${m.value}`;
              return item;
            });
          }
          const op = pathContext(before);
          if (op && targetOf(doc) === 'ma3') {
            // Children and properties of the object a literal Root()... path reaches, from the console.
            let lua;
            try {
              lua = childrenLua(op.segments);
            } catch (_) {
              return [];
            }
            const found = await liveFetch(`path:${JSON.stringify(op.segments)}`, lua, parseChildren, 30000);
            const items = [];
            for (const n of found.children || []) {
              const item = new vscode.CompletionItem(n, vscode.CompletionItemKind.Module);
              item.detail = 'child object';
              item.sortText = `0${n}`;
              items.push(item);
            }
            for (const n of found.properties || []) {
              const item = new vscode.CompletionItem(n, vscode.CompletionItemKind.Property);
              item.detail = 'property';
              item.sortText = `1${n}`;
              items.push(item);
            }
            return items;
          }
          const ma2 = memberContext(before);
          if (ma2) {
            return members(ma2.prefix).map((m) => {
              const item = new vscode.CompletionItem(m.name, m.fn ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Module);
              if (m.fn) {
                item.detail = m.fn.signature;
                item.documentation = new vscode.MarkdownString(`${m.fn.doc}\n\n_grandMA2 Lua API._`);
                const req = m.fn.params.filter((p) => !p.optional).map((p, i) => `\${${i + 1}:${p.name}}`).join(', ');
                item.insertText = new vscode.SnippetString(`${m.name}(${req})`);
              }
              return item;
            });
          }
          const isMethod = /:\s*[A-Za-z_]*$/.test(before);
          const isMember = /\.\s*[A-Za-z_]*$/.test(before);
          if (isMember) return [];
          if (targetOf(doc) === 'ma2') {
            const g = new vscode.CompletionItem('gma', vscode.CompletionItemKind.Module);
            g.detail = 'grandMA2 Lua API';
            return isMethod ? [] : [g];
          }
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
      ':',
      '.'
    )
  );

  // ---- plugin manifest (.xml) completion and hover
  const XML = { language: 'xml' };
  const isManifest = (doc) => /<(GMA3|MA)\b/.test(doc.getText()) || doc.getText().trim() === '';
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      XML,
      {
        provideCompletionItems(doc, pos) {
          if (!isManifest(doc)) return [];
          const text = doc.getText();
          const schema = schemaFor(text);
          const ctx = contextAt(doc.getText(new vscode.Range(0, 0, pos.line, pos.character)));
          const range = (n) => new vscode.Range(pos.line, pos.character - n, pos.line, pos.character);
          if (ctx.kind === 'element') {
            // A fresh file offers both roots; once a root exists, only that console's elements.
            const empty = text.trim() === '' || !/<(GMA3|MA)\b/.test(text);
            const names = ctx.parent ? (schema[ctx.parent] || { children: [] }).children : empty ? ['GMA3', 'MA'] : [rootOf(text)];
            return names.map((n) => {
              const spec = schema[n] || SCHEMA_MA2[n] || SCHEMA[n] || {};
              const item = new vscode.CompletionItem(n, vscode.CompletionItemKind.Struct);
              item.documentation = spec.doc;
              item.range = range(ctx.partial.length);
              const body = (spec.snippet || []).map((a, i) => `${a}="\${${i + 1}}"`).join(' ');
              const close = (spec.children || []).length ? `>\n\t$0\n</${n}>` : ' />';
              item.insertText = new vscode.SnippetString(`${n}${body ? ' ' + body : ''}${close}`);
              return item;
            });
          }
          if (ctx.kind === 'attribute' && schema[ctx.element]) {
            return Object.entries(schema[ctx.element].attrs)
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
        const schema = schemaFor(doc.getText());
        const ctx = contextAt(doc.getText(new vscode.Range(0, 0, pos.line, range.end.character)));
        if (ctx.kind === 'element' && schema[word]) return new vscode.Hover(new vscode.MarkdownString(`**<${word}>** ${schema[word].doc}`), range);
        if (ctx.kind === 'attribute' && schema[ctx.element] && schema[ctx.element].attrs[word])
          return new vscode.Hover(new vscode.MarkdownString(`**${word}** ${schema[ctx.element].attrs[word]}`), range);
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
        const cmdHover = commandHover(doc.lineAt(pos).text, pos.character, targetOf(doc));
        if (cmdHover) return new vscode.Hover(new vscode.MarkdownString(cmdHover.markdown), new vscode.Range(pos.line, cmdHover.start, pos.line, cmdHover.end));
        const pa = targetOf(doc) === 'ma3' ? props.propAt(doc.lineAt(pos).text, pos.character) : null;
        const pinfo = pa && props.ma3Union().get(pa.name);
        if (pinfo) {
          const vals = pinfo.enumName ? props.enumValues(pinfo.enumName).map((v) => `${v.name} (${v.value})`).slice(0, 24) : [];
          const md = new vscode.MarkdownString([`**${pinfo.name}** \`${pinfo.type}\`${pinfo.readOnly ? ', read-only' : ''}`, `Used by ${pinfo.classes} object class${pinfo.classes === 1 ? '' : 'es'}.`, vals.length ? `Values: ${vals.join(', ')}` : ''].filter(Boolean).join('\n\n'));
          return new vscode.Hover(md, new vscode.Range(pos.line, pa.start, pos.line, pa.end));
        }
        const gmaPath = pathAt(doc.lineAt(pos).text, range.end.character);
        const gmaFn = gmaPath && BY_PATH.get(gmaPath);
        if (gmaFn) {
          const md = new vscode.MarkdownString(['```lua', gmaFn.signature, '```', '', gmaFn.doc, '', '_grandMA2 Lua API._'].join('\n'));
          return new vscode.Hover(md, range);
        }
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
          const gmaCall = activeCallPath(before);
          const gmaFn = gmaCall && BY_PATH.get(gmaCall.path);
          if (gmaFn) {
            const sig = new vscode.SignatureInformation(gmaFn.signature, new vscode.MarkdownString(gmaFn.doc));
            sig.parameters = gmaFn.params.map((p) => new vscode.ParameterInformation(p.optional ? `[${p.name}]` : p.name));
            const help = new vscode.SignatureHelp();
            help.signatures = [sig];
            help.activeSignature = 0;
            help.activeParameter = Math.min(gmaCall.argIndex, Math.max(0, gmaFn.params.length - 1));
            return help;
          }
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
  // Every Lua finding with its span and, where there is one, a fix; diagnostics and quick fixes both come from here.
  function lintDoc(doc) {
    const text = doc.getText();
    const target = targetOf(doc);
    const findings = findBlockingLoops(text).map((f) => ({
      line: f.line,
      rule: 'blocking-loop',
      severity: 'warning',
      message: `Loop never yields, breaks or returns; it will freeze the console. Add ${target === 'ma2' ? 'gma.sleep(seconds)' : 'coroutine.yield(seconds)'} or use a timer.`,
      fix: { kind: 'yield', text: target === 'ma2' ? 'gma.sleep(0.1)' : 'coroutine.yield(0.1)' },
    }));
    return findings.concat(lintRules(text, index.api, { globals: cfg().get('lint.globals'), target }));
  }
  const findingRange = (doc, f) =>
    f.len ? new vscode.Range(f.line, f.col, f.line, f.col + f.len) : doc.lineAt(Math.min(f.line, doc.lineCount - 1)).range;
  function refresh(doc) {
    if (!cfg().get('diagnostics')) return diagnostics.delete(doc.uri);
    const found = [];
    const lineRange = (line) => doc.lineAt(Math.min(line, doc.lineCount - 1)).range;
    if (doc.languageId === 'lua') {
      const sev = { warning: vscode.DiagnosticSeverity.Warning, hint: vscode.DiagnosticSeverity.Hint };
      for (const f of lintDoc(doc)) {
        const d = new vscode.Diagnostic(findingRange(doc, f), f.message, sev[f.severity]);
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
  // Quick fixes: the finding that produced a diagnostic is found again by rule and position.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      LUA,
      {
        provideCodeActions(doc, range, ctx) {
          const actions = [];
          const findings = ctx.diagnostics.length ? lintDoc(doc) : [];
          for (const d of ctx.diagnostics) {
            const f = findings.find((x) => x.rule === d.code && x.line === d.range.start.line && (x.len ? x.col === d.range.start.character : true));
            if (!f || !f.fix) continue;
            const edit = new vscode.WorkspaceEdit();
            let title;
            if (f.fix.kind === 'replace') {
              title = `Replace with "${f.fix.text}"`;
              edit.replace(doc.uri, d.range, f.fix.text);
            } else if (f.fix.kind === 'insert') {
              title = `Insert "${f.fix.text.trim()}"`;
              edit.insert(doc.uri, d.range.start, f.fix.text);
            } else if (f.fix.kind === 'yield') {
              const line = doc.lineAt(f.line);
              if (!/\bdo\s*$/.test(line.text)) continue;
              const indent = /^\s*/.exec(line.text)[0];
              title = `Add ${f.fix.text} to the loop`;
              edit.insert(doc.uri, line.range.end, `\n${indent}    ${f.fix.text}`);
            } else continue;
            const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
            action.edit = edit;
            action.diagnostics = [d];
            action.isPreferred = f.fix.kind === 'replace';
            actions.push(action);
          }
          return actions;
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ma3')) vscode.workspace.textDocuments.forEach(refresh);
    })
  );
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
      const ma2 = manifestIsMa2(manifest);
      const copied = deploy(manifest, ma2 ? ma2PluginsFolder() : pluginsFolder());
      const msg = `Deployed ${copied.length} file(s) to ${path.dirname(copied[0])}`;
      if (quiet) vscode.window.setStatusBarMessage(msg, 3000);
      else vscode.window.showInformationMessage(msg);
      return manifest;
    } catch (err) {
      vscode.window.showErrorMessage(`Deploy failed: ${err.message}`);
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
      const ma2 = manifestIsMa2(manifest);
      const name = path.basename(manifest, path.extname(manifest));
      // grandMA2 can also be driven over Telnet, which works when the bridge isn't running.
      const via = cfg().get('deployAndRun.via');
      if (ma2 && (via === 'telnet' || (via === 'auto' && !bridge.status(bridgeDirFor('ma2')).running))) {
        output.appendLine(`> reload ${path.basename(manifest)} into Plugin ${slot} (grandMA2, Telnet)`);
        warnCollisions(ma2PluginsFolder(), name);
        return sendLines(reloadCommands('ma2', name, slot));
      }
      if (!ma2 && (via === 'osc' || (via === 'auto' && !bridge.status(bridgeDirFor('ma3')).running))) {
        output.appendLine(`> reload ${path.basename(manifest)} into Plugin ${slot} (grandMA3, OSC)`);
        return sendOsc(reloadCommands('ma3', name, slot));
      }
      output.appendLine(`> reload ${path.basename(manifest)} into Plugin ${slot}${ma2 ? ' (grandMA2)' : ''}`);
      try {
        const code = ma2 ? reloadLuaMa2(name, slot) : reloadLua(name, slot);
        const r = await bridge.run(bridgeDirFor(ma2 ? 'ma2' : 'ma3'), code, cfg().get('bridge.timeout'));
        output.appendLine(bridge.formatResult(r));
      } catch (err) {
        output.appendLine(`bridge error: ${err.message}`);
        vscode.window.showErrorMessage(`Reload failed: ${err.message}`);
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

  // ---- copy a plugin onto a USB stick for a hardware console
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.exportToUsb', async (opts = {}) => {
      const file = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName;
      const manifest = file && findManifest(file);
      if (!manifest) return vscode.window.showWarningMessage('Open a plugin .lua or .xml file first.');
      await vscode.workspace.saveAll(false);
      let root = opts.root || cfg().get('usb.path');
      if (!root) {
        const drives = await listRemovableDrives();
        const picked = await vscode.window.showQuickPick(
          drives.map((d) => ({ label: d.label, description: d.root, root: d.root })).concat([{ label: 'Choose a folder...', description: 'any folder or drive root', root: '' }]),
          { placeHolder: drives.length ? 'USB stick to copy the plugin to' : 'No removable drive found; choose a folder' }
        );
        if (!picked) return null;
        root = picked.root;
        if (!root) {
          const dir = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: 'Stick or folder to copy the plugin to' });
          if (!dir) return null;
          root = dir[0].fsPath;
        }
      }
      try {
        const plan = planExport(manifest, root);
        if (plan.existing.length && !opts.yes) {
          const pick = await vscode.window.showWarningMessage(`${plan.existing.join(', ')} already exist in ${plan.dest}. Replace them?`, { modal: true }, 'Replace');
          if (pick !== 'Replace') return null;
        }
        const res = exportToStick(manifest, root);
        if (res.collisions.length) vscode.window.showWarningMessage(`grandMA2 imports every file starting with "${res.libName}", so ${res.collisions.join(', ')} on the stick creates a duplicate plugin. Remove it from the stick.`);
        const cmd = res.ma2 ? `Import "${res.libName}" At Plugin 1 /o /nc` : `Import Plugin Library "${res.libName}" At Plugin 1 /nc`;
        vscode.window.showInformationMessage(`Copied ${res.copied.length} file(s) to ${res.dest}. On the console, plug the stick in and import the plugin.`, 'Copy Import Command').then((pick) => {
          if (pick === 'Copy Import Command') vscode.env.clipboard.writeText(cmd);
        });
        return res;
      } catch (err) {
        vscode.window.showErrorMessage(`Export to USB failed: ${err.message}`);
      }
    })
  );

  // ---- bump version and zip a plugin for sharing
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.packagePlugin', async (partArg) => {
      const file = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName;
      const manifest = file && findManifest(file);
      if (!manifest) return vscode.window.showWarningMessage('Open a plugin .lua or .xml file first.');
      // grandMA2 manifests carry no plugin version, so there is nothing to bump.
      const part = manifestIsMa2(manifest)
        ? 'none'
        : partArg ||
          (await vscode.window.showQuickPick(['patch', 'minor', 'major', 'none'], { placeHolder: 'Bump the plugin version before packaging?' }));
      if (!part) return;
      try {
        await vscode.workspace.saveAll(false);
        let xml = fs.readFileSync(manifest, 'utf8');
        let note = '';
        if (part !== 'none') {
          const bumped = bumpVersion(xml, part);
          xml = bumped.xml;
          fs.writeFileSync(manifest, xml);
          note = ` (version ${bumped.from} -> ${bumped.to})`;
        }
        const version = (/<Plugin\b[^>]*?\bVersion="([^"]*)"/.exec(xml) || [])[1];
        const name = path.basename(manifest, path.extname(manifest));
        const files = filesForManifest(manifest).map((f) => ({ name: path.basename(f), data: fs.readFileSync(f) }));
        const dist = path.join(path.dirname(manifest), 'dist');
        fs.mkdirSync(dist, { recursive: true });
        const out = path.join(dist, `${name}${version ? `-${version}` : ''}.zip`);
        fs.writeFileSync(out, zip(files));
        const pick = await vscode.window.showInformationMessage(`Packaged ${files.length} files${note}: ${path.basename(out)}`, 'Reveal');
        if (pick === 'Reveal') vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(out));
      } catch (err) {
        vscode.window.showErrorMessage(`Package failed: ${err.message}`);
      }
    })
  );

  // ---- new plugin (grandMA3 or grandMA2)
  const newPlugin = (ma2) => async (nameArg) => {
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
    await vscode.workspace.fs.writeFile(luaUri, enc.encode(ma2 ? ma2LuaTemplate(name) : luaTemplate(name)));
    await vscode.workspace.fs.writeFile(xmlUri, enc.encode(ma2 ? ma2XmlTemplate(name, cfg().get('ma2.version')) : xmlTemplate(name, cfg().get('dataVersion'))));
    await vscode.window.showTextDocument(luaUri);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.newPlugin', newPlugin(false)),
    vscode.commands.registerCommand('ma3.newPluginMa2', newPlugin(true))
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
  const output = vscode.window.createOutputChannel('grandMA Devkit');
  const runDiagnostics = vscode.languages.createDiagnosticCollection('ma3-run');
  context.subscriptions.push(output, runDiagnostics);
  const bridgeDir = () => bridgeDirFor('ma3');
  // Status and reset follow the active Lua file's console, and fall back to grandMA3.
  const activeTarget = () => {
    const ed = vscode.window.activeTextEditor;
    return ed && ed.document.languageId === 'lua' ? targetOf(ed.document) : 'ma3';
  };

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
        const r = await bridge.run(bridgeDirFor(targetOf(editor.document)), code, cfg().get('bridge.timeout'));
        output.appendLine(bridge.formatResult(r));
        const line = r.ok ? null : bridge.errorLine(r.error, offset);
        if (line !== null) {
          const range = editor.document.lineAt(Math.min(line, editor.document.lineCount - 1)).range;
          runDiagnostics.set(editor.document.uri, [new vscode.Diagnostic(range, String(r.error).split('\n')[0], vscode.DiagnosticSeverity.Error)]);
        }
      } catch (err) {
        output.appendLine(`bridge error: ${err.message}`);
        vscode.window.showErrorMessage(`Run failed: ${err.message}`);
      }
    }),
    vscode.commands.registerCommand('ma3.bridgeStatus', () => {
      const target = activeTarget();
      const st = bridge.status(bridgeDirFor(target));
      const which = target === 'ma2' ? 'LuaBridge (grandMA2)' : 'LuaBridge';
      vscode.window.showInformationMessage(st.running ? `${which} running (heartbeat ${st.ageS}s ago).` : `${which} not running. ${st.reason || `Last heartbeat ${st.ageS}s ago.`}`);
    }),
    vscode.commands.registerCommand('ma3.bridgeReset', async () => {
      try {
        await bridge.reset(bridgeDirFor(activeTarget()));
        vscode.window.setStatusBarMessage('LuaBridge globals cleared', 3000);
      } catch (err) {
        vscode.window.showErrorMessage(`Reset failed: ${err.message}`);
      }
    })
  );

  // ---- console object browser (tree of Root() through the bridge)
  const treeChanged = new vscode.EventEmitter();
  const luaPath = (p) => `Root()${p.map((i) => `[${i}]`).join('')}`;
  let treeTarget = 'ma3';
  let propsOut = null;
  const ma2Lua = (addr) => `gma.show.getobj.handle("${addr}")`;
  const objectTree = {
    onDidChangeTreeData: treeChanged.event,
    getTreeItem: (el) => el.item,
    async getChildren(el) {
      const path = el ? el.path : [];
      if (treeTarget === 'ma2') {
        try {
          const r = await bridge.run(bridgeDirFor('ma2'), ma2TreeLua(path), cfg().get('bridge.timeout'));
          if (!r.ok) throw new Error(String(r.error).split(String.fromCharCode(10))[0]);
          const { total, items } = parseMa2Tree(r.returns);
          const nodes = items.map((c) => {
            // Under the roots the index is the root number; below them a 0-based slot, and the pool number names the object.
            const parts = (el ? el.parts : []).concat(el ? c.number : c.index);
            const addr = ma2Address(parts);
            const item = new vscode.TreeItem(c.name.trim() || c.cls, c.amount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
            item.description = c.cls;
            const p2 = props.ma2Props(c.cls);
            item.tooltip = new vscode.MarkdownString(`${c.name}\n\n${addr || '(no address: unnumbered object)'}\n\n${c.amount} slot${c.amount === 1 ? '' : 's'}${p2.length ? `\n\n${props.propsMarkdown(c.cls, p2)}` : ''}`);
            item.contextValue = 'ma3object';
            return { item, path: path.concat(c.index), parts, addr, target: 'ma2', cls: c.cls };
          });
          const last = items.length ? items[items.length - 1].index : -1;
          if (el && last + 1 < total) {
            nodes.push({ item: new vscode.TreeItem(`${total - last - 1} more slots not shown`), path, parts: el.parts });
          }
          return nodes;
        } catch (err) {
          return [{ item: new vscode.TreeItem(`${err.message} (refresh to retry)`), path, error: true }];
        }
      }
      try {
        const r = await bridge.run(bridgeDir(), listLua(path), cfg().get('bridge.timeout'));
        if (!r.ok) throw new Error(String(r.error).split('\n')[0]);
        const { total, items } = parseList(r.returns);
        const nodes = items.map((c) => {
          const item = new vscode.TreeItem(c.name, c.count > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
          item.description = c.addr;
          const p3 = props.ma3Props(c.cls);
          item.tooltip = new vscode.MarkdownString(`${c.name}\n\n\`${luaPath(path.concat(c.index))}\`\n\n${c.count} child${c.count === 1 ? '' : 'ren'}\n\n${props.propsMarkdown(c.cls, p3, 25)}`);
          item.contextValue = 'ma3object';
          return { item, path: path.concat(c.index), addr: c.addr, cls: c.cls };
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
  const treeView = vscode.window.createTreeView('ma3.objects', { treeDataProvider: objectTree });
  treeView.description = 'grandMA3';
  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand('ma3.objects.refresh', () => treeChanged.fire()),
    vscode.commands.registerCommand('ma3.objects.switch', (target) => {
      treeTarget = target === 'ma2' || target === 'ma3' ? target : treeTarget === 'ma3' ? 'ma2' : 'ma3';
      treeView.description = treeTarget === 'ma2' ? 'grandMA2' : 'grandMA3';
      treeChanged.fire();
      return treeTarget;
    }),
    vscode.commands.registerCommand('ma3.objects.copyPath', async (el) => {
      if (!el || !el.path) return;
      const text = el.target === 'ma2' ? (el.addr ? ma2Lua(el.addr) : null) : luaPath(el.path);
      if (!text) return vscode.window.showWarningMessage('This object has no pool number, so it has no address.');
      await vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage(`Copied ${text}`, 3000);
      return text;
    }),
    vscode.commands.registerCommand('ma3.objects.showProperties', async (el) => {
      if (!el || !el.path) return;
      if (!propsOut) {
        propsOut = vscode.window.createOutputChannel('grandMA Properties');
        context.subscriptions.push(propsOut);
      }
      const out = propsOut;
      out.clear();
      const row = (p) => `${p.name.padEnd(28)} ${String(p.type).padEnd(16)} ${p.readOnly ? 'ro' : 'rw'}  ${p.value !== undefined ? p.value : ''}${p.enumName ? `  [${p.enumName}]` : ''}`;
      if (el.target === 'ma2') {
        out.appendLine(`${el.addr || el.path.join('.')}  (grandMA2, from the bundled schema; no live values)`);
        props.ma2Props(el.cls || '').forEach((p) => out.appendLine(`${p.name.padEnd(28)} ${p.type}${p.values && p.values.length ? `  [${p.values.join(', ')}]` : ''}`));
      } else {
        let live = null;
        try {
          const r = await bridge.run(bridgeDir(), props.propValuesLua(el.path), cfg().get('bridge.timeout'));
          if (r.ok) live = props.parsePropValues(r.returns);
        } catch (_) {
          live = null;
        }
        const cls = live ? live.cls : el.cls || '';
        out.appendLine(`${luaPath(el.path)}  ${cls}  (${live ? 'live values from the console' : 'bundled schema; the LuaBridge is not running, so no values'})`);
        (live ? live.props : props.ma3Props(cls)).forEach((p) => out.appendLine(row(p)));
      }
      out.show(true);
    }),
    vscode.commands.registerCommand('ma3.objects.copyAddress', async (el) => {
      if (!el || !el.addr) return;
      await vscode.env.clipboard.writeText(el.addr);
      vscode.window.setStatusBarMessage(`Copied ${el.addr}`, 3000);
    }),
    vscode.commands.registerCommand('ma3.objects.insertPath', async (el) => {
      const editor = vscode.window.activeTextEditor;
      if (!el || !el.path || !editor) return;
      const text = el.target === 'ma2' ? (el.addr ? ma2Lua(el.addr) : null) : luaPath(el.path);
      if (!text) return vscode.window.showWarningMessage('This object has no pool number, so it has no address.');
      await editor.edit((b) => b.insert(editor.selection.active, text));
    })
  );

  // ---- Telnet to the console command line (verified on grandMA2 onPC 3.9.61; grandMA3 onPC does not listen)
  const telnetOut = vscode.window.createOutputChannel('grandMA Console');
  context.subscriptions.push(telnetOut);
  const telnetOptions = async () => ({
    host: cfg().get('telnet.host'),
    port: cfg().get('telnet.port'),
    user: cfg().get('telnet.user'),
    password: (await context.secrets.get('ma3.telnet.password')) || '',
    gapMs: cfg().get('telnet.gapMs'),
  });
  // Commands that discard work or end the session are confirmed before they go out.
  const RISKY = /^\s*(NewShow|LoadShow|Delete|Unpatch|Format|Reset|Shutdown|Reboot|ClearAll)\b/i;
  async function confirmRisky(commands) {
    const risky = commands.filter((c) => RISKY.test(c));
    if (!risky.length) return true;
    const pick = await vscode.window.showWarningMessage(`Send ${risky.length === 1 ? 'this command' : 'these commands'} to the console?\n${risky.join('\n')}`, { modal: true }, 'Send');
    return pick === 'Send';
  }
  // Runs commands one after another in a fresh session, stopping at the first console error.
  // A stray `Name.xml.backup...` next to the plugin makes `Import "Name"` create a duplicate plugin.
  function warnCollisions(dir, name) {
    const extra = importCollisions(dir, name);
    if (extra.length) {
      vscode.window.showWarningMessage(`grandMA2 imports every file starting with "${name}", so ${extra.join(', ')} in ${dir} creates a duplicate plugin. Move it out of the plugins folder.`);
    }
    return extra;
  }
  async function sendLines(commands) {
    telnetOut.show(true);
    try {
      const session = await openSession(await telnetOptions());
      try {
        const done = [];
        for (const cmd of commands) {
          telnetOut.appendLine(`> ${cmd}`);
          const r = await session.send(cmd);
          for (const l of r.lines) if (!/^Executing : /.test(l)) telnetOut.appendLine(`  ${l}`);
          done.push({ cmd, ...r });
          if (r.errors.length) break;
        }
        return done;
      } finally {
        session.close();
      }
    } catch (err) {
      telnetOut.appendLine(`telnet error: ${err.message}`);
      vscode.window.showErrorMessage(`Telnet failed: ${err.message}`);
      return null;
    }
  }
  let monitor = null;
  const stopMonitor = () => {
    if (monitor) monitor.close();
    monitor = null;
  };
  context.subscriptions.push(
    { dispose: stopMonitor },
    vscode.commands.registerCommand('ma3.telnet.send', async (cmdArg) => {
      const cmd = typeof cmdArg === 'string' ? cmdArg : await vscode.window.showInputBox({ prompt: 'Console command line command', placeHolder: 'Go+ Executor 1' });
      if (!cmd || !cmd.trim()) return null;
      if (!(await confirmRisky([cmd]))) return null;
      return sendLines([cmd.trim()]);
    }),
    vscode.commands.registerCommand('ma3.telnet.sendSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return null;
      const sel = editor.selection;
      const text = sel.isEmpty ? editor.document.lineAt(sel.active.line).text : editor.document.getText(sel);
      const cmds = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(--|#)/.test(l));
      if (!cmds.length) return vscode.window.showWarningMessage('No command lines selected.');
      if (cmds.length > 1) {
        const pick = await vscode.window.showWarningMessage(`Send ${cmds.length} lines to the console as commands?`, { modal: true }, 'Send');
        if (pick !== 'Send') return null;
      }
      if (!(await confirmRisky(cmds))) return null;
      return sendLines(cmds);
    }),
    vscode.commands.registerCommand('ma3.telnet.setPassword', async () => {
      const pw = await vscode.window.showInputBox({ prompt: 'Password of the console user profile (leave empty if it has none)', password: true });
      if (pw === undefined) return;
      if (pw) await context.secrets.store('ma3.telnet.password', pw);
      else await context.secrets.delete('ma3.telnet.password');
      vscode.window.setStatusBarMessage(pw ? 'Telnet password stored' : 'Telnet password cleared', 3000);
    }),
    vscode.commands.registerCommand('ma3.telnet.monitor', async () => {
      stopMonitor();
      telnetOut.show(true);
      try {
        // On connect the console replays its whole log (hundreds of lines): show only the tail of that.
        const backlog = [];
        let live = false;
        setTimeout(() => {
          live = true;
          if (backlog.length > 20) telnetOut.appendLine(`[monitor] ... ${backlog.length - 20} earlier lines skipped`);
          for (const l of backlog.slice(-20)) telnetOut.appendLine(`[monitor] ${l}`);
          backlog.length = 0;
        }, 900);
        monitor = await listen({
          host: cfg().get('telnet.host'),
          port: cfg().get('telnet.monitorPort'),
          onLine: (l) => (live ? telnetOut.appendLine(`[monitor] ${l}`) : backlog.push(l)),
          onClose: () => {
            telnetOut.appendLine('[monitor] closed');
            monitor = null;
          },
        });
        telnetOut.appendLine(`[monitor] listening on ${cfg().get('telnet.host')}:${cfg().get('telnet.monitorPort')} (System Monitor: Lua runtime errors and console messages)`);
      } catch (err) {
        telnetOut.appendLine(`[monitor] ${err.message}`);
        vscode.window.showErrorMessage(`Monitor failed: ${err.message}`);
      }
    }),
    vscode.commands.registerCommand('ma3.telnet.stopMonitor', () => {
      stopMonitor();
      vscode.window.setStatusBarMessage('Console monitor stopped', 3000);
    }),
    // Copies the LuaBridge plugin into the plugins folder and, on grandMA2, imports and starts it over Telnet.
    vscode.commands.registerCommand('ma3.installBridge', async (opts = {}) => {
      const ma2 = (opts.target || activeTarget()) === 'ma2';
      const names = ma2 ? ['LuaBridge_MA2.lua', 'LuaBridge_MA2.xml'] : ['LuaBridge.lua', 'LuaBridge.xml'];
      const dest = ma2 ? ma2PluginsFolder() : pluginsFolder();
      if (!dest) return vscode.window.showWarningMessage(`No plugins folder for ${ma2 ? 'grandMA2' : 'grandMA3'}; set ${ma2 ? 'ma3.ma2.pluginsPath' : 'ma3.pluginsPath'}.`);
      try {
        fs.mkdirSync(dest, { recursive: true });
        for (const n of names) fs.copyFileSync(path.join(context.extensionPath, 'bridge', n), path.join(dest, n));
      } catch (err) {
        return vscode.window.showErrorMessage(`Could not copy the LuaBridge plugin: ${err.message}`);
      }
      if (!ma2) {
        if (bridge.status(bridgeDirFor('ma3')).running) {
          vscode.window.showInformationMessage(`LuaBridge files updated in ${dest}; the bridge is already running.`);
          return true;
        }
        // grandMA3 has no Telnet; OSC can import and start the plugin if OSC command input is already on.
        const pick = opts.osc ? 'Import over OSC' : await vscode.window.showInformationMessage(`LuaBridge copied to ${dest}. Import and start it over OSC (needs OSC command input already on), or do it by hand from the plugin pool?`, 'Import over OSC', 'By hand');
        if (pick !== 'Import over OSC') return null;
        const slot = opts.slot || (await vscode.window.showInputBox({ prompt: 'Plugin pool slot to import LuaBridge into (overwrites that slot)', value: String(cfg().get('bridge.slot') || 99), validateInput: (v) => (/^\d+$/.test(v) ? null : 'A slot number') }));
        if (!slot) return null;
        const sent = await sendOsc(reloadCommands('ma3', 'LuaBridge', slot), { note: false });
        if (!sent) return null;
        for (let i = 0; i < 30; i++) {
          if (bridge.status(bridgeDirFor('ma3')).running) {
            vscode.window.showInformationMessage('LuaBridge is running; Run on Console now works for grandMA3.');
            return true;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        vscode.window.showWarningMessage('Commands sent, but no LuaBridge heartbeat yet. OSC gives no confirmation: check that OSC command input is on (Enable OSC Command Input on Console needs the bridge, so enable it by hand the first time) and look in the plugin pool.');
        return false;
      }
      // Importing again would restart the bridge (and, with a stray backup file around, add duplicates), so leave a running one alone.
      if (!opts.force && bridge.status(bridgeDirFor('ma2')).running) {
        vscode.window.showInformationMessage('LuaBridge_MA2 files updated; the bridge is already running. Re-import it (or pass force) to load the new copy.');
        return true;
      }
      const slot = opts.slot || (await vscode.window.showInputBox({ prompt: 'Plugin pool slot to import LuaBridge_MA2 into (overwrites that slot)', value: String(cfg().get('bridge.slot') || 99), validateInput: (v) => (/^\d+$/.test(v) ? null : 'A slot number') }));
      if (!slot) return null;
      warnCollisions(dest, 'LuaBridge_MA2');
      const done = await sendLines(reloadCommands('ma2', 'LuaBridge_MA2', slot));
      if (!done || done.some((d) => d.errors.length)) return null;
      const dir = bridgeDirFor('ma2');
      for (let i = 0; i < 24; i++) {
        if (bridge.status(dir).running) {
          vscode.window.showInformationMessage('LuaBridge_MA2 is running; Run on Console now works for grandMA2.');
          return true;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      vscode.window.showWarningMessage('Imported and started, but no LuaBridge heartbeat yet. Check the plugin in the pool and the System Monitor.');
      return false;
    })
  );

  // ---- OSC to the grandMA3 command line (/cmd over UDP; the console never answers)
  const oscOptions = () => ({ host: cfg().get('osc.host'), port: cfg().get('osc.port'), prefix: cfg().get('osc.prefix'), gapMs: cfg().get('osc.gapMs') });
  // Sends commands and reports in the OSC panel. UDP gives no confirmation, so say what could not be checked.
  async function sendOsc(commands, { note = true } = {}) {
    const out = telnetOut;
    out.show(true);
    try {
      const opts = oscOptions();
      let status = null;
      const dir = bridgeDirFor('ma3');
      if (bridge.status(dir).running) {
        const r = await bridge.run(dir, oscStatusLua(), cfg().get('bridge.timeout'));
        status = r.ok ? parseOscStatus(r.returns) : null;
        if (status && !status.ready) {
          out.appendLine('osc: the console has OSC command input off; run "Enable OSC Command Input on Console" first.');
          vscode.window.showWarningMessage('OSC command input is off on the console. Run "Enable OSC Command Input on Console" first.');
          return 0;
        }
      }
      for (const c of commands) out.appendLine(`> osc ${opts.host}:${opts.port} ${c}`);
      const n = await sendCommands(commands, opts);
      if (note) out.appendLine(`  sent ${n} command${n === 1 ? '' : 's'} (OSC has no reply${status ? '' : '; the bridge is not running, so OSC input could not be checked'}).`);
      return n;
    } catch (err) {
      out.appendLine(`osc error: ${err.message}`);
      vscode.window.showErrorMessage(`OSC failed: ${err.message}`);
      return 0;
    }
  }
  const oscStatusText = (s) => (s ? `input ${s.enabled ? 'on' : 'off'}, accepts ${s.preferredIp}, port ${s.port}, line 1 commands ${s.receiveCommand ? 'on' : 'off'}${s.prefix ? `, prefix ${s.prefix}` : ''}` : 'unreadable');
  async function oscConsole(luaFor, title) {
    const dir = bridgeDirFor('ma3');
    if (!bridge.status(dir).running) return vscode.window.showWarningMessage('The LuaBridge must be running on the grandMA3 console to change its OSC settings.');
    const r = await bridge.run(dir, luaFor(), cfg().get('bridge.timeout'));
    if (!r.ok) return vscode.window.showErrorMessage(`${title} failed: ${String(r.error).split('\n')[0]}`);
    const s = parseOscStatus(r.returns);
    telnetOut.appendLine(`osc: ${oscStatusText(s)}`);
    vscode.window.showInformationMessage(`OSC on the console: ${oscStatusText(s)}.`);
    return s;
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.osc.send', async (cmdArg) => {
      const cmd = typeof cmdArg === 'string' ? cmdArg : await vscode.window.showInputBox({ prompt: 'grandMA3 command line command (sent over OSC)', placeHolder: 'Go+ Executor 1' });
      if (!cmd || !cmd.trim()) return 0;
      if (!(await confirmRisky([cmd]))) return 0;
      return sendOsc([cmd.trim()]);
    }),
    vscode.commands.registerCommand('ma3.osc.sendSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return 0;
      const sel = editor.selection;
      const text = sel.isEmpty ? editor.document.lineAt(sel.active.line).text : editor.document.getText(sel);
      const cmds = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(--|#)/.test(l));
      if (!cmds.length) return vscode.window.showWarningMessage('No command lines selected.');
      if (cmds.length > 1) {
        const pick = await vscode.window.showWarningMessage(`Send ${cmds.length} lines to the console as commands over OSC?`, { modal: true }, 'Send');
        if (pick !== 'Send') return 0;
      }
      if (!(await confirmRisky(cmds))) return 0;
      return sendOsc(cmds);
    }),
    vscode.commands.registerCommand('ma3.osc.setup', async (opts = {}) => {
      if (!opts.yes) {
        const pick = await vscode.window.showWarningMessage(
          'Turn on OSC command input on the grandMA3 console?',
          {
            modal: true,
            detail: 'This switches OSC input on, accepts the 127.0.0.0/8 range and lets OSC line 1 run /cmd messages. The console then listens on UDP port 8000 on all network interfaces, so other machines on the network can send it commands (including Lua) unless a firewall blocks the port. Use it on onPC with a throwaway show.',
          },
          'Enable'
        );
        if (pick !== 'Enable') return null;
      }
      return oscConsole(() => oscSetupLua(), 'OSC setup');
    }),
    vscode.commands.registerCommand('ma3.osc.disable', () => oscConsole(oscDisableLua, 'Disabling OSC'))
  );

  // ---- definitions for the Lua language server (sumneko.lua): known globals, typed parameters, `Obj:` methods
  async function setupLanguageServer() {
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!folder) return vscode.window.showWarningMessage('Open a folder first; the definitions are written into it.');
    const root = folder.uri.fsPath;
    const stubsDir = path.join(root, '.vscode', 'grandma-stubs');
    try {
      fs.mkdirSync(stubsDir, { recursive: true });
      fs.writeFileSync(path.join(stubsDir, 'grandma3.lua'), ma3Stubs(index.api));
      fs.writeFileSync(path.join(stubsDir, 'grandma2.lua'), ma2Stubs());
      const luarc = path.join(root, '.luarc.json');
      const merged = mergeLuarc(fs.existsSync(luarc) ? fs.readFileSync(luarc, 'utf8') : '', {
        libraryDir: './.vscode/grandma-stubs',
        runtimeVersion: cfg().get('target') === 'ma2' ? 'Lua 5.3' : 'Lua 5.4',
      });
      if (merged.error) {
        vscode.window.showWarningMessage(`Definitions written to .vscode/grandma-stubs. ${merged.error}`);
        return { stubsDir, luarc: false };
      }
      fs.writeFileSync(luarc, merged.text);
    } catch (err) {
      return vscode.window.showErrorMessage(`Could not write the definitions: ${err.message}`);
    }
    const hasLuaLs = !!vscode.extensions.getExtension('sumneko.lua');
    vscode.window.showInformationMessage(`Lua definitions for grandMA3 and grandMA2 written to .vscode/grandma-stubs and linked from .luarc.json.${hasLuaLs ? '' : ' Install the Lua language server (sumneko.lua) to use them.'}`);
    return { stubsDir, luarc: true };
  }
  context.subscriptions.push(vscode.commands.registerCommand('ma3.setupLanguageServer', setupLanguageServer));
  // Offer it once per workspace when the Lua language server is installed and the folder has Lua files.
  setTimeout(async () => {
    try {
      const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
      if (!folder || !vscode.extensions.getExtension('sumneko.lua') || context.workspaceState.get('stubsOffered')) return;
      const luarc = path.join(folder.uri.fsPath, '.luarc.json');
      if (fs.existsSync(luarc) && /grandma-stubs/.test(fs.readFileSync(luarc, 'utf8'))) return;
      if (!(await vscode.workspace.findFiles('**/*.lua', '**/node_modules/**', 1)).length) return;
      await context.workspaceState.update('stubsOffered', true);
      const pick = await vscode.window.showInformationMessage('Set up grandMA Lua definitions so Printf, Cmd, Root() and gma.* are known to the Lua language server?', 'Set up', 'Not now');
      if (pick === 'Set up') await setupLanguageServer();
    } catch (_) {
      /* an offer is never worth an error */
    }
  }, 4000);

  // ---- Lua tests (*.test.lua) run on the console through the bridge, shown in the Testing panel
  async function runLuaTestFile(fsPath) {
    const open = vscode.workspace.textDocuments.find((d) => d.fileName === fsPath);
    const text = open ? open.getText() : fs.readFileSync(fsPath, 'utf8');
    const target = detectTarget(text, cfg().get('target'));
    const dir = bridgeDirFor(target);
    if (!bridge.status(dir).running) {
      return { target, results: [], output: [], error: `The LuaBridge isn't running on the ${target === 'ma2' ? 'grandMA2' : 'grandMA3'} console.` };
    }
    const r = await bridge.run(dir, buildRunLua(text), cfg().get('test.timeout'));
    return { target, results: r.ok ? parseResults(r.returns) : [], output: r.output || [], error: r.ok ? null : String(r.error).split(String.fromCharCode(10))[0] };
  }
  const luaTests = vscode.tests.createTestController('grandmaLua', 'grandMA Lua tests');
  context.subscriptions.push(luaTests);
  function addTestFile(uri) {
    let item = luaTests.items.get(uri.toString());
    if (!item) {
      item = luaTests.createTestItem(uri.toString(), vscode.workspace.asRelativePath(uri), uri);
      item.canResolveChildren = true;
      luaTests.items.add(item);
    }
    return item;
  }
  async function readTests(item) {
    let text = '';
    try {
      text = (await vscode.workspace.openTextDocument(item.uri)).getText();
    } catch (_) {
      return item.children.replace([]);
    }
    item.children.replace(
      discoverTests(text).map((t) => {
        const child = luaTests.createTestItem(`${item.id}#${t.name}`, t.name, item.uri);
        child.range = new vscode.Range(t.line, 0, t.line, 0);
        return child;
      })
    );
  }
  luaTests.resolveHandler = async (item) => {
    if (item) return readTests(item);
    for (const uri of await vscode.workspace.findFiles('**/*.test.lua', '**/node_modules/**')) addTestFile(uri);
  };
  const luaWatcher = vscode.workspace.createFileSystemWatcher('**/*.test.lua');
  context.subscriptions.push(
    luaWatcher,
    luaWatcher.onDidCreate((uri) => addTestFile(uri)),
    luaWatcher.onDidChange((uri) => {
      const item = luaTests.items.get(uri.toString());
      if (item) readTests(item);
    }),
    luaWatcher.onDidDelete((uri) => luaTests.items.delete(uri.toString()))
  );
  luaTests.createRunProfile(
    'Run on console',
    vscode.TestRunProfileKind.Run,
    async (request, token) => {
      const run = luaTests.createTestRun(request);
      const files = [];
      const pick = (item) => (item.parent ? pick(item.parent) : item);
      if (request.include) request.include.forEach((i) => files.includes(pick(i)) || files.push(pick(i)));
      else luaTests.items.forEach((i) => files.push(i));
      for (const file of files) {
        if (token.isCancellationRequested) break;
        await readTests(file);
        file.children.forEach((c) => run.started(c));
        run.started(file);
        try {
          const res = await runLuaTestFile(file.uri.fsPath);
          for (const line of res.output) run.appendOutput(`${line}\r\n`, undefined, file);
          if (res.error) {
            const msg = new vscode.TestMessage(res.error);
            file.children.forEach((c) => run.errored(c, msg));
            run.errored(file, msg);
            continue;
          }
          for (const t of res.results) {
            let child = null;
            file.children.forEach((c) => c.label === t.name && (child = c));
            if (!child) {
              child = luaTests.createTestItem(`${file.id}#${t.name}`, t.name, file.uri);
              file.children.add(child);
            }
            if (t.ok) run.passed(child, t.ms);
            else {
              const msg = new vscode.TestMessage(t.error);
              const line = errorLine(t.error);
              if (line !== null) msg.location = new vscode.Location(file.uri, new vscode.Position(line, 0));
              run.failed(child, msg, t.ms);
            }
          }
          file.children.forEach((c) => {
            if (!res.results.some((t) => t.name === c.label)) run.skipped(c);
          });
          run.passed(file);
        } catch (err) {
          const msg = new vscode.TestMessage(err.message);
          file.children.forEach((c) => run.errored(c, msg));
          run.errored(file, msg);
        }
      }
      run.end();
    },
    true
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ma3.runLuaTests', async (fileArg) => {
      const file = typeof fileArg === 'string' ? fileArg : vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName;
      if (!file) return vscode.window.showWarningMessage('Open a .test.lua file first.');
      telnetOut.show(true);
      telnetOut.appendLine(`> test ${path.basename(file)}`);
      try {
        const res = await runLuaTestFile(file);
        for (const l of res.output) telnetOut.appendLine(`  ${l}`);
        if (res.error) telnetOut.appendLine(`  error: ${res.error}`);
        for (const t of res.results) telnetOut.appendLine(`  ${t.ok ? 'pass' : 'FAIL'} ${t.name}${t.ok ? '' : `: ${t.error}`}`);
        const failed = res.results.filter((t) => !t.ok).length;
        telnetOut.appendLine(`  ${res.results.length - failed} passed, ${failed} failed`);
        return res;
      } catch (err) {
        telnetOut.appendLine(`  error: ${err.message}`);
        vscode.window.showErrorMessage(`Lua tests failed to run: ${err.message}`);
      }
    })
  );

  // Replaces the API list (saved so it survives restarts), and re-checks every open file against it.
  function applyApi(api) {
    fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
    fs.writeFileSync(path.join(context.globalStorageUri.fsPath, 'api.json'), JSON.stringify(api));
    index = buildIndex(api);
    vscode.workspace.textDocuments.forEach(refresh);
  }

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
      applyApi(api);
      vscode.window.showInformationMessage(`Loaded ${api.global.length} global and ${api.object.length} object functions.`);
    }),
    // Rebuilds the API list from the running grandMA3 console (GetApiDescriptor), no HelpLua file needed.
    vscode.commands.registerCommand('ma3.updateApiFromConsole', async () => {
      const dir = bridgeDirFor('ma3');
      if (!bridge.status(dir).running) return vscode.window.showWarningMessage('The LuaBridge must be running on the grandMA3 console to read its API.');
      try {
        const r = await bridge.run(dir, ma3ApiLua(), 10);
        if (!r.ok) throw new Error(String(r.error).split('\n')[0]);
        const api = parseMa3Api(r.returns);
        if (api.global.length < 50 || api.object.length < 50) throw new Error(`The console returned only ${api.global.length} global and ${api.object.length} object functions.`);
        const diff = diffApi(index.api, api);
        applyApi(api);
        telnetOut.show(true);
        telnetOut.appendLine(`api: read ${api.global.length} global and ${api.object.length} object functions from the console.`);
        for (const [label, list] of [['added', diff.added], ['removed', diff.removed], ['changed', diff.changed]]) if (list.length) telnetOut.appendLine(`  ${label}: ${list.join(', ')}`);
        const regen = fs.existsSync(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.vscode', 'grandma-stubs', 'grandma3.lua'));
        if (regen) await setupLanguageServer();
        vscode.window.showInformationMessage(`API updated from the console: ${api.global.length} global and ${api.object.length} object functions (${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed).`);
        return { api, diff };
      } catch (err) {
        vscode.window.showErrorMessage(`API update failed: ${err.message}`);
      }
    }),
    // grandMA2: compares the curated gma.* list with what the console really has.
    vscode.commands.registerCommand('ma3.checkMa2Api', async () => {
      const dir = bridgeDirFor('ma2');
      if (!bridge.status(dir).running) return vscode.window.showWarningMessage('The LuaBridge_MA2 plugin must be running on the grandMA2 console. Use Install LuaBridge on Console.');
      try {
        const r = await bridge.run(dir, ma2WalkLua(), 10);
        if (!r.ok) throw new Error(String(r.error).split('\n')[0]);
        const walk = parseMa2Walk(r.returns);
        const gaps = ma2Gaps(walk);
        telnetOut.show(true);
        telnetOut.appendLine(`ma2 api: the console has ${walk.functions.length} gma functions; the list has ${walk.functions.length - gaps.missing.length} of them.`);
        if (gaps.missing.length) telnetOut.appendLine(`  on the console but not in the list: ${gaps.missing.join(', ')}`);
        if (gaps.notOnConsole.length) telnetOut.appendLine(`  in the list but not on this console: ${gaps.notOnConsole.join(', ')}`);
        vscode.window.showInformationMessage(`grandMA2 API check: ${gaps.missing.length} functions missing from the list, ${gaps.notOnConsole.length} listed ones absent from this console. Details in the grandMA Console panel.`);
        return { walk, gaps };
      } catch (err) {
        vscode.window.showErrorMessage(`MA2 API check failed: ${err.message}`);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
