'use strict';

// The page of the console REPL panel. The script talks to the extension by messages only:
//   page -> extension: {cmd: 'run'|'expand'|'watch'|'copy'|'insert'|'props', ...}
//   extension -> page: {type: 'run'|'children'|'watch'|'error'|'status', ...}
// Values come back already described (lib/repl.js); the page never evaluates anything itself.

// The expression of a child node is wrapped as (parent)[key]; undo the wrapping when it is only there for
// grammar, so a copied path reads Root()[14][3] and not (Root()[14])[3].
function tidyExpr(expr) {
  const e = String(expr);
  const m = /^\((.*)\)(\[[^\]]+\])$/.exec(e);
  return m ? tidyExpr(m[1]) + m[2] : e;
}

// [i, j, ...] when the expression is Root()[i][j]..., else null (so Show Properties can find the object).
function rootIndexPath(expr) {
  const m = /^Root\(\)((?:\[\d+\])*)$/.exec(tidyExpr(expr));
  if (!m) return null;
  return (m[1].match(/\d+/g) || []).map(Number);
}

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-__NONCE__'; script-src 'nonce-__NONCE__';">
<style nonce="__NONCE__">
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 10px 40px; }
.bar { display: flex; gap: 6px; align-items: center; position: sticky; top: 0; background: var(--vscode-editor-background); padding: 8px 0; z-index: 2; }
input[type=text] { flex: 1; font-family: var(--vscode-editor-font-family); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 4px 6px; }
select, button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 0; padding: 4px 8px; cursor: pointer; }
button.go { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.row { font-family: var(--vscode-editor-font-family); padding: 1px 0; white-space: pre-wrap; word-break: break-all; }
.row .tw { display: inline-block; width: 1.2em; cursor: pointer; color: var(--vscode-descriptionForeground); }
.k { color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe); }
.t-string { color: var(--vscode-debugTokenExpression-string, #ce9178); }
.t-number, .t-boolean { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
.t-nil, .t-function { color: var(--vscode-descriptionForeground); }
.t-object { color: var(--vscode-symbolIcon-classForeground, #4ec9b0); }
.hint, .entry { color: var(--vscode-descriptionForeground); }
.entry { margin-top: 10px; border-top: 1px solid var(--vscode-panel-border); padding-top: 6px; }
.err { color: var(--vscode-errorForeground); }
.kids { margin-left: 1.2em; }
.acts button { margin-left: 4px; padding: 0 5px; font-size: 0.85em; opacity: 0.8; }
h3 { margin: 14px 0 4px; font-size: 1em; }
</style></head><body>
<div class="bar">
  <select id="target"><option value="ma3">grandMA3</option><option value="ma2">grandMA2</option></select>
  <input id="expr" type="text" placeholder="Lua expression or statement, Enter to run (Up/Down for history)" autofocus>
  <button class="go" id="run">Run</button>
  <button id="clear">Clear</button>
</div>
<div id="status" class="hint"></div>
<div id="log"></div>
<h3>Watch <button id="refresh">Refresh</button> <label class="hint"><input type="checkbox" id="auto"> every 2 s</label></h3>
<div id="watches"><div class="hint">Add an expression from a result with its Watch button.</div></div>
<script nonce="__NONCE__">
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const state = vscode.getState() || { history: [], watches: [], target: '__TARGET__' };
const save = () => vscode.setState(state);
$('target').value = state.target;
let seq = 0, hpos = 0;
const nodes = new Map();
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmt = (d) => d.t === 'string' ? JSON.stringify(d.s) + (d.len > 300 ? ' (' + d.len + ' chars)' : '') : d.s;
const expandable = (d) => (d.t === 'table' || d.t === 'object') && d.n > 0;
function actions(expr, d) {
  const a = el('span', 'acts');
  const b = (label, cmd, extra) => { const x = el('button', '', label); x.onclick = (ev) => { ev.stopPropagation(); vscode.postMessage(Object.assign({ cmd, expr, target: $('target').value }, extra)); }; a.append(x); };
  b('Copy', 'copy');
  b('Insert', 'insert');
  if (d.t === 'object') b('Properties', 'props');
  const w = el('button', '', 'Watch'); w.onclick = (ev) => { ev.stopPropagation(); addWatch(expr); }; a.append(w);
  return a;
}
function valueRow(label, expr, d) {
  const wrap = el('div');
  const row = el('div', 'row');
  const tw = el('span', 'tw', expandable(d) ? '▸' : '');
  row.append(tw);
  if (label !== null) { row.append(el('span', 'k', label + ': ')); }
  row.append(el('span', 't-' + d.t, fmt(d)));
  if (expr) row.append(actions(expr, d));
  wrap.append(row);
  if (expandable(d) && expr) {
    const kids = el('div', 'kids');
    let open = false;
    row.onclick = () => {
      open = !open;
      tw.textContent = open ? '▾' : '▸';
      kids.hidden = !open;
      if (open && !kids.dataset.loaded) { kids.dataset.loaded = '1'; const id = ++seq; nodes.set(id, kids); kids.append(el('div', 'hint', 'loading...')); vscode.postMessage({ cmd: 'expand', id, expr, target: $('target').value }); }
    };
    kids.hidden = true;
    wrap.append(kids);
  }
  return wrap;
}
function run(expr) {
  if (!expr.trim()) return;
  state.history = state.history.filter((h) => h !== expr).concat(expr).slice(-100);
  hpos = state.history.length;
  state.target = $('target').value;
  save();
  const id = ++seq;
  const entry = el('div', 'entry');
  entry.append(el('div', 'hint', '> ' + expr));
  const out = el('div'); entry.append(out);
  nodes.set(id, out);
  $('log').append(entry);
  entry.scrollIntoView();
  vscode.postMessage({ cmd: 'run', id, expr, target: $('target').value });
}
function addWatch(expr) {
  if (!state.watches.includes(expr)) { state.watches.push(expr); save(); }
  refreshWatches();
}
function refreshWatches() {
  const box = $('watches');
  box.textContent = '';
  if (!state.watches.length) { box.append(el('div', 'hint', 'Add an expression from a result with its Watch button.')); return; }
  state.watches.forEach((w, i) => {
    const row = el('div', 'row');
    const rm = el('button', '', 'x'); rm.onclick = () => { state.watches.splice(i, 1); save(); refreshWatches(); };
    const slot = el('span', 't-nil', ' ...'); slot.id = 'w' + i;
    row.append(rm, el('span', 'k', ' ' + w + ' = '), slot);
    box.append(row);
  });
  vscode.postMessage({ cmd: 'watch', exprs: state.watches, target: $('target').value });
}
window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m.type === 'status') { $('status').textContent = m.text; return; }
  if (m.type === 'watch') {
    m.results.forEach((r, i) => { const s = $('w' + i); if (!s) return; s.className = r.error ? 'err' : 't-' + ((r.values[0] || { t: 'nil' }).t); s.textContent = r.error ? r.error : (r.values.length ? r.values.map(fmt).join(', ') : '(no value)'); });
    return;
  }
  const box = nodes.get(m.id);
  if (!box) return;
  box.textContent = '';
  if (m.reply.error) { box.append(el('div', 'row err', m.reply.error)); return; }
  if (m.type === 'run') {
    if (!m.reply.values.length) box.append(el('div', 'hint', '(no values)'));
    m.reply.values.forEach((d, i) => box.append(valueRow(m.reply.values.length > 1 ? String(i + 1) : null, m.reply.values.length === 1 ? m.expr : null, d)));
  } else {
    m.reply.children.forEach((c) => box.append(valueRow(String(c.k), c.expr, c.d)));
    if (m.reply.props && m.reply.props.length) {
      box.append(el('div', 'hint', 'properties'));
      m.reply.props.forEach((p) => box.append(valueRow(p.k, null, p.d)));
    }
    if (!box.children.length) box.append(el('div', 'hint', '(empty)'));
  }
});
$('expr').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { run($('expr').value); $('expr').value = ''; }
  else if (e.key === 'ArrowUp') { if (hpos > 0) $('expr').value = state.history[--hpos] || ''; e.preventDefault(); }
  else if (e.key === 'ArrowDown') { if (hpos < state.history.length) $('expr').value = state.history[++hpos] || ''; e.preventDefault(); }
});
$('run').onclick = () => { run($('expr').value); $('expr').value = ''; };
$('clear').onclick = () => { $('log').textContent = ''; };
$('refresh').onclick = refreshWatches;
$('target').onchange = () => { state.target = $('target').value; save(); };
let timer = null;
$('auto').onchange = () => { clearInterval(timer); timer = $('auto').checked ? setInterval(refreshWatches, 2000) : null; };
refreshWatches();
</script></body></html>`;

function replHtml(nonce, target = 'ma3') {
  return PAGE.replace(/__NONCE__/g, nonce).replace('__TARGET__', target === 'ma2' ? 'ma2' : 'ma3');
}

module.exports = { replHtml, tidyExpr, rootIndexPath };
