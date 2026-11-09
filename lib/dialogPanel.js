'use strict';

// The page of the dialog / menu flow designer. The page keeps the flow being edited; the extension owns the
// model (lib/dialogModel.js) and answers every change with the generated Lua and the problems found.
//   page -> extension: {cmd: 'change', flow} | {cmd: 'insert'|'copy'|'preview'|'import'|'ready', flow}
//   extension -> page: {type: 'result', lua, problems} | {type: 'load', flow, note}

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-__NONCE__'; script-src 'nonce-__NONCE__';">
<style nonce="__NONCE__">
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; }
.top { display: flex; gap: 6px; padding: 8px 10px; position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 3; border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; align-items: center; }
.top .sp { flex: 1; }
.cols { display: grid; grid-template-columns: 170px minmax(260px, 1fr) minmax(240px, 1fr); gap: 0; }
.col { padding: 10px; border-right: 1px solid var(--vscode-panel-border); min-width: 0; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } .col { border-right: 0 !important; border-bottom: 1px solid var(--vscode-panel-border); } }
h4 { margin: 12px 0 4px; font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); font-weight: 600; }
h4:first-child { margin-top: 0; }
button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 0; padding: 3px 8px; cursor: pointer; }
button.go { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
button.x { padding: 3px 6px; }
input[type=text], input[type=number], select, textarea { font-family: inherit; font-size: inherit; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 5px; box-sizing: border-box; }
textarea { width: 100%; min-height: 54px; resize: vertical; }
.full { width: 100%; }
.list .item { padding: 4px 6px; cursor: pointer; display: flex; gap: 4px; align-items: center; border-radius: 2px; }
.list .item.sel { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.list .item .id { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.star { color: var(--vscode-charts-yellow, #cca700); }
.row { display: flex; gap: 4px; margin: 3px 0; align-items: center; flex-wrap: wrap; }
.row input[type=text] { flex: 1; min-width: 90px; }
.row input.num { width: 58px; flex: none; }
.row select { max-width: 120px; }
.sub { margin-left: 14px; padding-left: 6px; border-left: 2px solid var(--vscode-panel-border); }
.prob { padding: 2px 0; }
.prob.error { color: var(--vscode-errorForeground); }
.prob.warning { color: var(--vscode-editorWarning-foreground, #cca700); }
.ok { color: var(--vscode-testing-iconPassed, #73c991); }
pre { margin: 0; padding: 8px; overflow: auto; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre; max-height: 46vh; }
.mock { background: #1b1b1f; color: #e6e6e6; border: 1px solid #555; border-radius: 4px; padding: 0 0 10px; margin: 4px 0 10px; font-family: sans-serif; }
.mock .tt { padding: 6px 10px; background: #2c2c33; font-weight: 600; border-radius: 4px 4px 0 0; }
.mock .msg { padding: 10px; white-space: pre-wrap; }
.mock .fld { display: flex; gap: 8px; padding: 3px 10px; align-items: center; }
.mock .fld .lb { min-width: 70px; opacity: .8; }
.mock .fld .box { flex: 1; background: #101013; border: 1px solid #444; padding: 2px 6px; min-height: 1.2em; }
.mock .tg { width: 28px; height: 14px; border-radius: 7px; background: #444; position: relative; }
.mock .tg.on { background: #2e9; }
.mock .btns { display: flex; gap: 6px; padding: 8px 10px 0; flex-wrap: wrap; }
.mock .btn { background: #3a3a44; padding: 4px 14px; border-radius: 3px; }
.mock .sw { display: flex; gap: 2px; }
.mock .sw span { background: #3a3a44; padding: 2px 8px; }
.mock .sw span.on { background: #2e9; color: #000; }
.muted { color: var(--vscode-descriptionForeground); }
.flow { font-family: var(--vscode-editor-font-family); font-size: 12px; }
.flow div { padding: 1px 0; }
</style></head>
<body>
<div class="top">
  <button class="go" id="insert">Insert at cursor</button>
  <button id="copy">Copy Lua</button>
  <button id="import">Import from editor</button>
  <button id="preview">Show on console</button>
  <span class="sp"></span>
  <span class="muted" id="note"></span>
</div>
<div class="cols">
  <div class="col"><h4>Dialogs</h4><div class="list" id="list"></div><div class="row"><button id="add">+ Dialog</button></div><h4>Flow</h4><div class="flow" id="flowmap"></div></div>
  <div class="col" id="edit"></div>
  <div class="col" style="border-right:0"><h4>Preview</h4><div id="mock"></div><h4>Problems</h4><div id="probs"></div><h4>Lua</h4><pre id="lua"></pre></div>
</div>
<script nonce="__NONCE__">
(function () {
  var vs = acquireVsCodeApi();
  var flow = { start: 'main', dialogs: [] };
  var sel = null;
  var timer = null;
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    for (var k in (props || {})) {
      if (k === 'class') e.className = props[k];
      else if (k === 'text') e.textContent = props[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), props[k]);
      else e[k] = props[k];
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function cur() { for (var i = 0; i < flow.dialogs.length; i++) if (flow.dialogs[i].id === sel) return flow.dialogs[i]; return null; }
  function changed(rerender) {
    clearTimeout(timer);
    timer = setTimeout(function () { vs.postMessage({ cmd: 'change', flow: flow }); }, 120);
    if (rerender) render(); else { drawMock(); drawMap(); }
  }
  function field(d, key, area) {
    var i = area ? el('textarea') : el('input', { type: 'text' });
    i.className = 'full';
    i.value = d[key] == null ? '' : d[key];
    i.addEventListener('input', function () { d[key] = i.value; changed(false); });
    return i;
  }
  function textIn(obj, key, ph, cls) {
    var i = el('input', { type: 'text', placeholder: ph || '' });
    if (cls) i.className = cls;
    i.value = obj[key] == null ? '' : obj[key];
    i.addEventListener('input', function () { obj[key] = i.value; changed(false); });
    return i;
  }
  function numIn(obj, key, ph) {
    var i = el('input', { type: 'text', placeholder: ph || '', className: 'num' });
    i.value = obj[key] == null ? '' : obj[key];
    i.addEventListener('input', function () { obj[key] = i.value === '' ? '' : Number(i.value); changed(false); });
    return i;
  }
  function delBtn(arr, i) { return el('button', { class: 'x', text: 'x', title: 'Remove', onclick: function () { arr.splice(i, 1); changed(true); } }); }
  function render() {
    var l = $('list'); l.textContent = '';
    flow.dialogs.forEach(function (d) {
      var it = el('div', { class: 'item' + (d.id === sel ? ' sel' : ''), onclick: function () { sel = d.id; render(); } }, [
        el('span', { class: 'star', text: d.id === flow.start ? '★' : '' }),
        el('span', { class: 'id', text: d.id })
      ]);
      l.appendChild(it);
    });
    var d = cur(); var e = $('edit'); e.textContent = '';
    if (!d) { drawMock(); drawMap(); return; }
    e.appendChild(el('h4', { text: 'Dialog' }));
    var idRow = el('div', { class: 'row' }, [textIn(d, 'id', 'id')]);
    var idIn = idRow.firstChild;
    idIn.onchange = function () {
      var old = sel; var nv = idIn.value.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || old;
      flow.dialogs.forEach(function (o) { o.commands.forEach(function (c) { if (c.next === old) c.next = nv; }); });
      if (flow.start === old) flow.start = nv;
      d.id = nv; sel = nv; changed(true);
    };
    idRow.appendChild(el('button', { text: 'Make start', onclick: function () { flow.start = d.id; changed(true); } }));
    idRow.appendChild(el('button', { class: 'x', text: 'Delete', onclick: function () {
      if (flow.dialogs.length < 2) return;
      flow.dialogs = flow.dialogs.filter(function (o) { return o !== d; });
      flow.dialogs.forEach(function (o) { o.commands.forEach(function (c) { if (c.next === d.id) c.next = null; }); });
      if (flow.start === d.id) flow.start = flow.dialogs[0].id;
      sel = flow.dialogs[0].id; changed(true);
    } }));
    e.appendChild(idRow);
    e.appendChild(el('h4', { text: 'Title' })); e.appendChild(field(d, 'title'));
    e.appendChild(el('h4', { text: 'Message' })); e.appendChild(field(d, 'message', true));

    e.appendChild(el('h4', { text: 'Buttons' }));
    d.commands.forEach(function (c, i) {
      var nx = el('select');
      nx.appendChild(el('option', { value: '', text: '(end)' }));
      flow.dialogs.forEach(function (o) { nx.appendChild(el('option', { value: o.id, text: '→ ' + o.id })); });
      nx.value = c.next || '';
      nx.onchange = function () { c.next = nx.value || null; changed(false); };
      e.appendChild(el('div', { class: 'row' }, [numIn(c, 'value', '#'), textIn(c, 'name', 'name'), nx, delBtn(d.commands, i)]));
    });
    e.appendChild(el('button', { text: '+ Button', onclick: function () {
      var n = 1; d.commands.forEach(function (c) { if (Number(c.value) >= n) n = Number(c.value) + 1; });
      d.commands.push({ value: n, name: 'Button', next: null }); changed(true);
    } }));

    e.appendChild(el('h4', { text: 'Text inputs' }));
    d.inputs.forEach(function (f, i) { e.appendChild(el('div', { class: 'row' }, [textIn(f, 'name', 'name'), textIn(f, 'value', 'start value'), numIn(f, 'maxTextLength', 'max'), delBtn(d.inputs, i)])); });
    e.appendChild(el('button', { text: '+ Input', onclick: function () { d.inputs.push({ name: 'Input', value: '' }); changed(true); } }));

    e.appendChild(el('h4', { text: 'Switches' }));
    d.states.forEach(function (f, i) {
      var cb = el('input', { type: 'checkbox', checked: !!f.state, title: 'starts on' });
      cb.onchange = function () { f.state = cb.checked; changed(false); };
      e.appendChild(el('div', { class: 'row' }, [textIn(f, 'name', 'name'), cb, delBtn(d.states, i)]));
    });
    e.appendChild(el('button', { text: '+ Switch', onclick: function () { d.states.push({ name: 'Switch', state: false }); changed(true); } }));

    e.appendChild(el('h4', { text: 'Selectors' }));
    d.selectors.forEach(function (f, i) {
      var ty = el('select'); ty.appendChild(el('option', { value: 0, text: 'swipe' })); ty.appendChild(el('option', { value: 1, text: 'radio' }));
      ty.value = f.type == 1 ? 1 : 0; ty.onchange = function () { f.type = Number(ty.value); changed(false); };
      e.appendChild(el('div', { class: 'row' }, [textIn(f, 'name', 'name'), ty, numIn(f, 'selectedValue', 'start'), delBtn(d.selectors, i)]));
      var sub = el('div', { class: 'sub' });
      f.values.forEach(function (v, j) { sub.appendChild(el('div', { class: 'row' }, [textIn(v, 'name', 'label'), numIn(v, 'value', 'value'), delBtn(f.values, j)])); });
      sub.appendChild(el('button', { text: '+ Value', onclick: function () { f.values.push({ name: 'Value', value: f.values.length + 1 }); changed(true); } }));
      e.appendChild(sub);
    });
    e.appendChild(el('button', { text: '+ Selector', onclick: function () { d.selectors.push({ name: 'Selector', selectedValue: 1, type: 0, values: [{ name: 'A', value: 1 }, { name: 'B', value: 2 }] }); changed(true); } }));

    e.appendChild(el('h4', { text: 'Options' }));
    var to = el('div', { class: 'row' }, [el('span', { text: 'Timeout (ms)' }), numIn(d, 'timeout', '0')]);
    e.appendChild(to);
    var ac = el('input', { type: 'checkbox', checked: !!d.autoCloseOnInput });
    ac.onchange = function () { d.autoCloseOnInput = ac.checked; changed(false); };
    e.appendChild(el('div', { class: 'row' }, [ac, el('span', { text: 'Close when any input is used' })]));
    drawMock(); drawMap();
  }
  function drawMock() {
    var m = $('mock'); m.textContent = '';
    var d = cur(); if (!d) return;
    var box = el('div', { class: 'mock' });
    box.appendChild(el('div', { class: 'tt', text: d.title || '' }));
    box.appendChild(el('div', { class: 'msg', text: d.message || '' }));
    d.inputs.forEach(function (f) { box.appendChild(el('div', { class: 'fld' }, [el('span', { class: 'lb', text: f.name }), el('span', { class: 'box', text: f.value || '' })])); });
    d.states.forEach(function (f) { box.appendChild(el('div', { class: 'fld' }, [el('span', { class: 'lb', text: f.name }), el('span', { class: 'tg' + (f.state ? ' on' : '') })])); });
    d.selectors.forEach(function (f) {
      var sw = el('span', { class: 'sw' });
      f.values.forEach(function (v) { sw.appendChild(el('span', { class: Number(v.value) === Number(f.selectedValue) ? 'on' : '', text: v.name })); });
      box.appendChild(el('div', { class: 'fld' }, [el('span', { class: 'lb', text: f.name }), sw]));
    });
    var bt = el('div', { class: 'btns' });
    d.commands.forEach(function (c) { bt.appendChild(el('span', { class: 'btn', text: c.name })); });
    box.appendChild(bt);
    m.appendChild(box);
  }
  function drawMap() {
    var m = $('flowmap'); m.textContent = '';
    flow.dialogs.forEach(function (d) {
      m.appendChild(el('div', { text: (d.id === flow.start ? '★ ' : '') + d.id }));
      d.commands.forEach(function (c) { if (c.next) m.appendChild(el('div', { class: 'muted', text: '   ' + c.name + ' → ' + c.next })); });
    });
  }
  $('add').onclick = function () {
    var n = 'dialog', k = 1; var used = flow.dialogs.map(function (d) { return d.id; });
    while (used.indexOf(k === 1 ? n : n + '_' + k) >= 0) k++;
    var id = k === 1 ? n : n + '_' + k;
    flow.dialogs.push({ id: id, title: 'Title', message: '', commands: [{ value: 1, name: 'OK', next: null }], inputs: [], states: [], selectors: [] });
    sel = id; changed(true);
  };
  ['insert', 'copy', 'preview', 'import'].forEach(function (c) { $(c).onclick = function () { vs.postMessage({ cmd: c, flow: flow }); }; });
  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (m.type === 'result') {
      $('lua').textContent = m.lua;
      var p = $('probs'); p.textContent = '';
      if (!m.problems.length) p.appendChild(el('div', { class: 'ok', text: 'No problems.' }));
      m.problems.forEach(function (x) { p.appendChild(el('div', { class: 'prob ' + x.level, text: (x.dialog ? x.dialog + ': ' : '') + x.message })); });
    } else if (m.type === 'load') {
      flow = m.flow; sel = flow.start || (flow.dialogs[0] && flow.dialogs[0].id); render(); changed(false);
      $('note').textContent = m.note || '';
    } else if (m.type === 'note') { $('note').textContent = m.note; }
  });
  vs.postMessage({ cmd: 'ready' });
})();
</script></body></html>`;

function dialogHtml(nonce) {
  return PAGE.replace(/__NONCE__/g, nonce);
}

module.exports = { dialogHtml };
