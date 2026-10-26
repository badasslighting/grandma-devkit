'use strict';
// UI tests for the variable features (run inside the extension host by suite.js).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const MA2_XML = (lines) =>
  `<?xml version="1.0"?>\n<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" major_vers="3">\n\t<Macro index="1" name="m">\n${lines
    .map((l, i) => `\t\t<Macroline index="${i}">\n\t\t\t<text>${l}</text>\n\t\t</Macroline>\n`)
    .join('')}\t</Macro>\n</MA>\n`;

module.exports = function registerVarTests({ test, testMa2, testMa3, ws, openLua, until, sleep, labelOf, bridgeLib, popups }) {
  async function openFile(name, text) {
    const file = path.join(ws, name);
    fs.writeFileSync(file, text);
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);
    return doc;
  }
  const codes = (doc) => vscode.languages.getDiagnostics(doc.uri).map((d) => d.code);
  const waitCodes = (doc, want, what) =>
    until(() => {
      const c = codes(doc);
      return want.every((w) => c.includes(w)) ? c : null;
    }, what || `diagnostics ${want}`);
  const outputOf = (re) =>
    vscode.workspace.textDocuments
      .filter((d) => d.uri.scheme === 'output' && re.test(d.uri.path + d.uri.authority + d.uri.query))
      .map((d) => d.getText())
      .join('\n');
  const cmd = (name, ...args) => vscode.commands.executeCommand(name, ...args);
  const positionOfText = (doc, needle, delta = 0) => {
    const i = doc.getText().indexOf(needle);
    assert.ok(i >= 0, `${needle} found`);
    return doc.positionAt(i + delta);
  };

  test('variable commands and the console variables view are registered', async () => {
    await openLua('v0.lua', 'return 1\n');
    await vscode.extensions.getExtension('badasslighting.grandma-devkit').activate();
    const cmds = await vscode.commands.getCommands(true);
    for (const c of ['replaceRange', 'preview', 'inline', 'extract', 'convert', 'refresh', 'set', 'add', 'delete', 'copyName', 'watch', 'stopWatch', 'snapshot', 'diff', 'restore']) assert.ok(cmds.includes(`ma3.vars.${c}`), `ma3.vars.${c} registered`);
    const langs = await vscode.languages.getLanguages();
    assert.ok(langs.includes('gma2macro') && langs.includes('gma3macro'), 'macro languages registered');
  });

  test('variable checks in Lua command strings: quotes, unset, unquoted values', async () => {
    const doc = await openFile(
      'vars1.lua',
      ['SetVar(UserVars(), "Color1", 5)', 'Cmd("Label Macro 1 \\"x$Color1\\"")', 'Cmd("Go+ $nothere")', 'Cmd("SetUserVariable \\"k\\" a b")', 'Cmd("Go+ $Color1")', 'Cmd("Go+ $color1")', ''].join('\n')
    );
    const c = await waitCodes(doc, ['var-in-quotes', 'var-undefined', 'var-value-unquoted', 'var-case']);
    assert.strictEqual(c.filter((x) => x === 'var-undefined').length, 1, 'only $nothere is unset');
    assert.strictEqual(c.filter((x) => x === 'var-case').length, 1, 'only $color1 differs in case (grandMA3)');
  });

  test('macro files get condition and variable checks, completion, hover and no manifest errors', async () => {
    const doc = await openFile('m1.gma2macro', ['SetVar $dkvcolor1 = 5', '[$dkvcolor1==5 && $dkvmissing==1] Go+ Executor $dkvcolor1', '[$dkvx!=1] Go+', 'Go+ $dkvco', ''].join('\n'));
    assert.strictEqual(doc.languageId, 'gma2macro');
    await waitCodes(doc, ['bracket-logic', 'bracket-operator', 'var-undefined']);
    const list = await cmd('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(3, 10));
    const labels = list.items.map(labelOf);
    assert.ok(labels.includes('dkvcolor1'), `the workspace variable is offered: ${labels.slice(0, 8)}`);
    assert.ok(labels.includes('FADERPAGE'), 'grandMA2 system variables are offered');
    const hovers = await cmd('vscode.executeHoverProvider', doc.uri, positionOfText(doc, '$dkvcolor1==', 3));
    assert.ok(hovers.some((h) => h.contents.some((x) => /grandMA2 variable/.test(x.value) && /dkvcolor1/.test(x.value))), 'hover describes the variable');
    const kw = await cmd('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(4, 0));
    assert.ok(kw.items.some((i) => labelOf(i) === 'Go+'), 'command words complete in a macro file');
  });

  test('exported macro XML: findings point into the text, no manifest checks', async () => {
    const doc = await openFile('mx.xml', MA2_XML(['[$a==1 &amp;&amp; $b==2] Go+', '[$a==&quot;x&quot;] Label Macro 1 &quot;n&quot;']));
    await waitCodes(doc, ['bracket-logic']);
    const d = vscode.languages.getDiagnostics(doc.uri).find((x) => x.code === 'bracket-logic');
    assert.strictEqual(doc.getText(d.range), '&amp;&amp;', 'the finding covers the escaped && in the file');
    assert.ok(vscode.languages.getDiagnostics(doc.uri).every((x) => x.code), 'every diagnostic is a rule finding, none from the plugin manifest checks');
  });

  test('go to definition, references, rename across Lua, macro and XML files', async () => {
    const lua = await openFile('r1.lua', 'gma.cmd("SetVar $dkvcount = 1")\nreturn 1\n');
    const mac = await openFile('r2.gma2macro', 'Go+ Executor $dkvcount\n');
    const xml = await openFile('r3.xml', MA2_XML(['Go+ Executor $dkvcount']));
    await until(() => cmd('vscode.executeReferenceProvider', mac.uri, new vscode.Position(0, 16)).then((r) => r && r.length >= 3), 'three occurrences indexed');
    const defs = await cmd('vscode.executeDefinitionProvider', mac.uri, new vscode.Position(0, 16));
    assert.strictEqual(defs.length, 1);
    assert.ok(/r1\.lua$/.test(defs[0].uri.fsPath), 'the definition is in the Lua file');
    const refs = await cmd('vscode.executeReferenceProvider', mac.uri, new vscode.Position(0, 16));
    assert.strictEqual(new Set(refs.map((r) => r.uri.fsPath)).size, 3, 'references in all three files');
    const edit = await cmd('vscode.executeDocumentRenameProvider', mac.uri, new vscode.Position(0, 16), 'dkvtotal');
    assert.ok(edit, 'a rename edit is offered');
    await vscode.workspace.applyEdit(edit);
    assert.match(lua.getText(), /SetVar \$dkvtotal = 1/);
    assert.match(mac.getText(), /Go\+ Executor \$dkvtotal/);
    assert.match(xml.getText(), /<text>Go\+ Executor \$dkvtotal<\/text>/);
    // a name that already exists would merge two variables
    const mac2 = await openFile('r4.gma2macro', 'SetVar $dkvother = 1\nGo+ $dkvtotal\n');
    let refused = false;
    try {
      const e2 = await cmd('vscode.executeDocumentRenameProvider', mac2.uri, new vscode.Position(1, 6), 'dkvother');
      refused = !e2 || !e2.size;
    } catch (_) {
      refused = true;
    }
    assert.ok(refused, 'renaming onto an existing variable is refused');
    const hl = await cmd('vscode.executeDocumentHighlights', mac.uri, new vscode.Position(0, 16));
    assert.ok(hl && hl.length === 1, 'highlight finds the use in this file');
  });

  test('Replace Variables Across a Range renames $col1 thru $col3 in one file and across the workspace', async () => {
    const a = await openFile('rr1.gma2macro', ['SetVar $dkvcol1 = 1', 'SetVar $dkvcol2 = 2', 'SetVar $dkvcol3 = 3', 'SetVar $dkvcol4 = 4', 'Go+ $dkvcol2 ; Go+ $dkvcol3', ''].join('\n'));
    const b = await openFile('rr2.lua', 'gma.cmd("Go+ $dkvcol1")\nlocal v = gma.show.getvar("DKVCOL3")\n');
    await until(() => cmd('vscode.executeReferenceProvider', a.uri, new vscode.Position(0, 10)).then((r) => r && r.length >= 2), 'index ready');
    const r1 = await cmd('ma3.vars.replaceRange', { uri: a.uri.toString(), range: '$dkvcol1 thru $dkvcol3', template: '$dkvhue{n}', scope: 'file' });
    assert.strictEqual(r1.edits, 5, 'five places in the file');
    assert.strictEqual(a.getText(), ['SetVar $dkvhue1 = 1', 'SetVar $dkvhue2 = 2', 'SetVar $dkvhue3 = 3', 'SetVar $dkvcol4 = 4', 'Go+ $dkvhue2 ; Go+ $dkvhue3', ''].join('\n'));
    assert.match(b.getText(), /\$dkvcol1/, 'the other file is untouched by a file-scope run');
    const r2 = await cmd('ma3.vars.replaceRange', { uri: b.uri.toString(), range: 'dkvcol1..dkvcol3', template: 'dkvlow{n+10}', scope: 'workspace' });
    assert.strictEqual(r2.files >= 1, true);
    assert.match(b.getText(), /Go\+ \$dkvlow11/);
    assert.match(b.getText(), /getvar\("dkvlow13"\)/);
    const bad = await cmd('ma3.vars.replaceRange', { range: '$a1 thru $b5', template: 'x{n}', scope: 'file' });
    assert.match(bad.error, /share one name/);
  });

  test('preview expands variables and evaluates a grandMA2 condition', async () => {
    const doc = await openFile('p1.gma2macro', ['SetVar $dkvpv = 7', 'SetVar $dkvpe = 3', '[$dkvpv==7] Go+ Executor $dkvpe', '[$dkvpv==8] Go+ Executor $dkvpe', 'Go+ $dkvmissing', ''].join('\n'));
    await until(() => cmd('vscode.executeReferenceProvider', doc.uri, new vscode.Position(0, 10)).then((r) => r && r.length >= 2), 'index ready');
    const yes = await cmd('ma3.vars.preview', { uri: doc.uri.toString(), line: 2, character: 3 });
    assert.deepStrictEqual([yes.runs, yes.text], [true, 'Go+ Executor 3']);
    const no = await cmd('ma3.vars.preview', { uri: doc.uri.toString(), line: 3, character: 3 });
    assert.strictEqual(no.runs, false);
    const missing = await cmd('ma3.vars.preview', { uri: doc.uri.toString(), line: 4, character: 3 });
    assert.match(missing.problems[0], /Error #54/);
  });

  test('inline, extract and convert', async () => {
    const doc = await openFile('i1.gma2macro', ['SetVar $dkvie = 3', 'Go+ Executor $dkvie', 'Go+ Executor 5', ''].join('\n'));
    await until(() => cmd('vscode.executeReferenceProvider', doc.uri, new vscode.Position(0, 10)).then((r) => r && r.length >= 2), 'index ready');
    const inl = await cmd('ma3.vars.inline', { uri: doc.uri.toString(), name: 'dkvie', value: '3' });
    assert.strictEqual(inl.edits, 1);
    assert.match(doc.getText(), /Go\+ Executor 3\n/);
    const ex = await cmd('ma3.vars.extract', { uri: doc.uri.toString(), range: [2, 13, 2, 14], name: 'dkvnew' });
    assert.strictEqual(ex.name, 'dkvnew');
    assert.strictEqual(doc.getText(), ['SetVar $dkvie = 3', 'Go+ Executor 3', 'SetVar $dkvnew = 5', 'Go+ Executor $dkvnew', ''].join('\n'));
    const lua = await openFile('c1.lua', ['gma.show.setvar("x", 1)', 'local v = gma.user.getvar("y")', 'gma.cmd("[$x==1] Go+ Executor 1")', 'gma.cmd("SetVar $z = abc")', ''].join('\n'));
    const conv = await cmd('ma3.vars.convert', { uri: lua.uri.toString(), open: false });
    assert.strictEqual(conv.to, 'ma3');
    assert.match(conv.text, /SetVar\(GlobalVars\(\), "x", 1\)/);
    assert.match(conv.text, /GetVar\(UserVars\(\), "y"\)/);
    assert.match(conv.text, /if GetVar\(GlobalVars\(\), "x"\) == 1 then Cmd\("Go\+ Executor 1"\) end/);
    assert.ok(conv.text.includes('Cmd("SetGlobalVariable \\"z\\" \\"abc\\"")'), `quotes escaped inside the Lua string: ${conv.text}`);
    const mac = await openFile('c2.gma2macro', ['SetVar $a = 7', 'SetUserVar $b = text', '[$a==7] Go+', ''].join('\n'));
    const mc = await cmd('ma3.vars.convert', { uri: mac.uri.toString(), open: false });
    assert.strictEqual(mc.to, 'ma3');
    assert.match(mc.text, /SetGlobalVariable "a" 7/);
    assert.match(mc.text, /SetUserVariable "b" "text"/);
    assert.ok(mc.notes.some((n) => /does not run a macro line that starts with \[condition\]/.test(n)));
  });

  test('quick fixes: bracket-ma3 becomes a Lua if, != becomes ==', async () => {
    const doc = await openFile('q1.lua', 'Cmd("[$v==5] Off Page 3")\n');
    await waitCodes(doc, ['bracket-ma3']);
    const acts = await cmd('vscode.executeCodeActionProvider', doc.uri, new vscode.Range(0, 5, 0, 6), 'quickfix');
    const act = acts.find((a) => /Rewrite as a Lua if/.test(a.title));
    assert.ok(act, `a rewrite action is offered: ${acts.map((a) => a.title)}`);
    await vscode.workspace.applyEdit(act.edit);
    assert.strictEqual(doc.getText().trim(), 'if GetVar(GlobalVars(), "v") == 5 then Cmd("Off Page 3") end');
    const m = await openFile('q2.gma2macro', '[$v!=5] Go+\n');
    await waitCodes(m, ['bracket-operator']);
    const acts2 = await cmd('vscode.executeCodeActionProvider', m.uri, new vscode.Range(0, 3, 0, 4), 'quickfix');
    const fix = acts2.find((a) => /Write ==/.test(a.title));
    assert.ok(fix, 'a != action is offered');
    await vscode.workspace.applyEdit(fix.edit);
    assert.strictEqual(m.getText().trim(), '[$v==5] Go+');
  });

  test('variable bank: favorites survive export and import, completion ranks by use, insert and reveal work', async () => {
    const mac = await openFile('bank1.gma2macro', ['SetVar $bnkhot = 1', 'Go+ $bnkhot', 'Go+ $bnkhot', 'Go+ $bnkhot', 'Go+ $bnkcool', 'Go+ $bnkfav', ''].join('\n'));
    const probe = await openFile('bank2.gma2macro', 'Go+ $dk\n');
    await until(() => cmd('vscode.executeReferenceProvider', mac.uri, new vscode.Position(0, 10)).then((r) => r && r.length >= 4), 'index ready');
    const favFile = path.join(ws, 'favs.json');
    try {
      await cmd('ma3.bank.favorite', { name: '$bnkfav', target: 'ma2', scope: 'global', value: '5', note: 'front wash' });
      const edited = await cmd('ma3.bank.editFavorite', { name: 'bnkfav', target: 'ma2', value: '6', note: 'edited' });
      assert.strictEqual(edited.count >= 1, true);
      const list = await cmd('vscode.executeCompletionItemProvider', probe.uri, new vscode.Position(0, 7));
      const order = list.items.filter((i) => /^bnk/.test(labelOf(i))).sort((a, b) => a.sortText.localeCompare(b.sortText)).map(labelOf);
      assert.deepStrictEqual(order, ['bnkfav', 'bnkhot', 'bnkcool'], `favorites first, then most used first: ${order}`);
      const fav = list.items.find((i) => labelOf(i) === 'bnkfav');
      assert.match(fav.detail, /★ favorite.*= 6/);
      const hot = list.items.find((i) => labelOf(i) === 'bnkhot');
      assert.match(hot.detail, /3 uses, 1 set, 1 file/);
      // insert at the cursor: what is already typed after the $ is replaced
      const ed = await vscode.window.showTextDocument(probe);
      ed.selection = new vscode.Selection(0, 7, 0, 7);
      const ins = await cmd('ma3.bank.insert', { name: 'bnkhot' });
      assert.strictEqual(ins.text, 'bnkhot', `insert 1 text ${ins.text}`);
      assert.strictEqual(probe.lineAt(0).text, 'Go+ $bnkhot', `line after insert 1: ${probe.lineAt(0).text}`);
      await ed.edit((b) => b.replace(new vscode.Range(0, 0, 0, probe.lineAt(0).text.length), 'Go+ '));
      ed.selection = new vscode.Selection(0, 4, 0, 4);
      const ins2 = await cmd('ma3.bank.insert', { name: 'bnkhot' });
      assert.strictEqual(ins2.text, '$bnkhot', `insert 2 ${JSON.stringify(ins2)}, line ${JSON.stringify(probe.lineAt(0).text)}`);
      // export, remove, import back
      const exp = await cmd('ma3.bank.export', { path: favFile });
      assert.ok(exp.count >= 1 && fs.existsSync(favFile));
      await cmd('ma3.bank.unfavorite', { name: 'bnkfav', target: 'ma2', scope: 'global' });
      const gone = await cmd('vscode.executeCompletionItemProvider', probe.uri, new vscode.Position(0, 5));
      assert.ok(!(gone.items.find((i) => labelOf(i) === 'bnkfav') || { detail: '' }).detail.includes('★'), 'no longer a favorite');
      const imp = await cmd('ma3.bank.import', { path: favFile });
      assert.ok(imp.added >= 1, JSON.stringify(imp));
      const bad = path.join(ws, 'notfavs.json');
      fs.writeFileSync(bad, '{"format":"other"}');
      assert.match((await cmd('ma3.bank.import', { path: bad })).error, /not a grandMA Devkit variable list/);
      // reveal opens the file at the definition
      const rev = await cmd('ma3.bank.reveal', { kind: 'var', stat: { name: 'bnkhot', target: 'ma2' } });
      assert.ok(/bank1\.gma2macro$/.test(rev.file));
      assert.strictEqual(vscode.window.activeTextEditor.selection.start.line, 0, `reveal line ${vscode.window.activeTextEditor.selection.start.line}`);
    } finally {
      await cmd('ma3.bank.unfavorite', { name: 'bnkfav', target: 'ma2', scope: 'global' });
    }
  });

  // -- live consoles (self-cleaning: every variable the test makes is removed, and removal is checked)
  const unq = (r) => String((r.returns && r.returns[0]) || '').replace(/^"|"$/g, '');

  testMa2('grandMA2 variables: set, snapshot, diff, restore and watch over Telnet', async () => {
    await vscode.workspace.getConfiguration('ma3').update('telnet.user', 'Devkit', vscode.ConfigurationTarget.Global);
    const ma2dir = bridgeLib.defaultBridgeDirMa2();
    const read = async (name, user) => unq(await bridgeLib.run(ma2dir, `local v = gma.${user ? 'user' : 'show'}.getvar('${name}') return v == nil and '<nil>' or v`, 5));
    const free = await read('DKV_ui');
    assert.strictEqual(free, '<nil>', `DKV_ui must be free for this test, read ${free}`);
    try {
      await cmd('ma3.vars.snapshot', { target: 'ma2' });
      const watch = await cmd('ma3.vars.watch', { target: 'ma2', intervalMs: 600 });
      assert.ok(watch.count > 20, `ListVar returned the variables: ${watch.count}`);
      const set = await cmd('ma3.vars.set', { target: 'ma2', scope: 'global', name: 'DKV_ui', value: '7', confirmed: true });
      assert.strictEqual(set.name, 'DKV_ui');
      const seven = await read('DKV_ui');
      assert.strictEqual(seven, '7', `the console now holds the value, read ${seven}`);
      await cmd('ma3.vars.set', { target: 'ma2', scope: 'user', name: 'DKV_uiu', value: 'a b', confirmed: true });
      const d = await cmd('ma3.vars.diff', { target: 'ma2' });
      assert.ok(d.added.some((v) => v.name.toUpperCase() === 'DKV_UI'), 'diff shows the new variable');
      assert.ok(d.added.some((v) => v.name.toUpperCase() === 'DKV_UIU' && v.scope === 'user' && v.value === 'a b'), `diff shows the user variable (the Telnet user's own): ${JSON.stringify(d.added)}`);
      await until(() => /\+ \$DKV_UI = 7/i.test(outputOf(/grandMA Variables/i)), 'the watcher reports the new variable', 8000);
      await cmd('ma3.vars.stopWatch');
      const back = await cmd('ma3.vars.restore', { target: 'ma2', confirmed: true });
      assert.ok(back.cleared >= 2, `restore cleared what the test added: ${JSON.stringify(back)}`);
      assert.strictEqual(await read('DKV_ui'), '<nil>');
      const same = await cmd('ma3.vars.diff', { target: 'ma2' });
      assert.ok(!same.added.length && !same.removed.length, 'no differences left');
    } finally {
      await cmd('ma3.vars.stopWatch');
      await bridgeLib.run(ma2dir, "gma.cmd('SetVar $DKV_ui =') return 'ok'", 5);
      await cmd('ma3.vars.set', { target: 'ma2', scope: 'user', name: 'DKV_uiu', value: '', confirmed: true });
      assert.strictEqual(await read('DKV_ui'), '<nil>', 'cleaned up');
    }
  });

  // Lua tests with withVars: the helper sets variables for a function and always puts them back.
  const { buildRunLua, parseResults } = require('../../lib/luaTests');
  const runTests = async (dir, src) => {
    const r = await bridgeLib.run(dir, buildRunLua(src), 15);
    assert.ok(r.ok, `the test file ran: ${r.error}`);
    return parseResults(r.returns);
  };
  testMa2('withVars sets grandMA2 variables for a test and restores them, also after a failure', async () => {
    const res = await runTests(
      bridgeLib.defaultBridgeDirMa2(),
      [
        "test('set, read, restored', function()",
        "  assertNil(gma.show.getvar('DKV_wv'))",
        "  withVars({ global = { DKV_wv = 5 }, user = { DKV_wu = 'hi' } }, function()",
        "    assertEq(gma.show.getvar('DKV_wv'), '5')",
        "    assertEq(gma.user.getvar('DKV_wu'), 'hi')",
        '  end)',
        "  assertNil(gma.show.getvar('DKV_wv'))",
        "  assertNil(gma.user.getvar('DKV_wu'))",
        'end)',
        "test('an old value comes back after a failure', function()",
        "  gma.show.setvar('DKV_wk', 'keep')",
        "  local ok = pcall(function() withVars({ global = { DKV_wk = 'temp' } }, function() error('boom') end) end)",
        '  assertFalse(ok)',
        "  assertEq(gma.show.getvar('DKV_wk'), 'keep')",
        "  gma.cmd('SetVar $DKV_wk =')",
        "  assertNil(gma.show.getvar('DKV_wk'))",
        'end)',
      ].join('\n')
    );
    assert.deepStrictEqual(res.map((r) => [r.ok, r.error]), [[true, ''], [true, '']]);
  });
  testMa3('withVars sets grandMA3 variables for a test and restores them, also after a failure', async () => {
    const res = await runTests(
      bridgeLib.defaultBridgeDir(),
      [
        "test('set, read, restored', function()",
        "  assertNil(GetVar(UserVars(), 'DKV_wv'))",
        "  withVars({ user = { DKV_wv = 5 }, global = { DKV_wg = 'hi' } }, function()",
        "    assertEq(GetVar(UserVars(), 'DKV_wv'), 5)",
        "    assertEq(GetVar(GlobalVars(), 'DKV_wg'), 'hi')",
        '  end)',
        "  assertNil(GetVar(UserVars(), 'DKV_wv'))",
        "  assertNil(GetVar(GlobalVars(), 'DKV_wg'))",
        'end)',
        "test('an old value comes back after a failure', function()",
        "  SetVar(UserVars(), 'DKV_wk', 'keep')",
        "  local ok = pcall(function() withVars({ user = { DKV_wk = 'temp' } }, function() error('boom') end) end)",
        '  assertFalse(ok)',
        "  assertEq(GetVar(UserVars(), 'DKV_wk'), 'keep')",
        "  DelVar(UserVars(), 'DKV_wk')",
        "  assertNil(GetVar(UserVars(), 'DKV_wk'))",
        'end)',
      ].join('\n')
    );
    assert.deepStrictEqual(res.map((r) => [r.ok, r.error]), [[true, ''], [true, '']]);
  });

  testMa3('grandMA3 variables: set and delete through the bridge, known names in the snapshot', async () => {
    const dir = bridgeLib.defaultBridgeDir();
    const get = async (name) => unq(await bridgeLib.run(dir, `local v = GetVar(UserVars(), '${name}') return v == nil and '<nil>' or tostring(v)`, 5));
    assert.strictEqual(await get('DKV_ui3'), '<nil>', 'DKV_ui3 must be free for this test');
    await openFile('live3.lua', "SetVar(UserVars(), 'DKV_ui3', 1)\n");
    await sleep(500);
    try {
      await cmd('ma3.vars.snapshot', { target: 'ma3' });
      await cmd('ma3.vars.set', { target: 'ma3', scope: 'user', name: 'DKV_ui3', value: '5', confirmed: true });
      assert.strictEqual(await get('DKV_ui3'), '5');
      const d = await cmd('ma3.vars.diff', { target: 'ma3' });
      assert.ok(d.added.some((v) => v.name === 'DKV_ui3'), `diff shows it: ${JSON.stringify(d)}`);
      const back = await cmd('ma3.vars.restore', { target: 'ma3', confirmed: true });
      assert.ok(back.cleared >= 1);
      assert.strictEqual(await get('DKV_ui3'), '<nil>');
    } finally {
      await bridgeLib.run(dir, "DelVar(UserVars(), 'DKV_ui3') return 'ok'", 5);
      assert.strictEqual(await get('DKV_ui3'), '<nil>', 'cleaned up');
    }
  });
};
