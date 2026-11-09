'use strict';

// The page of the overlay designer (stage B). The page keeps the design being edited; the extension owns the
// model (lib/overlayModel.js) and answers every change with the Lua, the problems and the layout rectangles.
//   page -> extension: {cmd: 'ready'|'change'|'insert'|'copy'|'preview'|'import'|'mode', overlay, mode}
//   extension -> page: {type: 'result', lua, problems, rects} | {type: 'load', overlay, note} | {type: 'note', note}

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-__NONCE__'; script-src 'nonce-__NONCE__';">
<style nonce="__NONCE__">
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; }
.top { display: flex; gap: 6px; padding: 8px 10px; position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 3; border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; align-items: center; }
.top .sp { flex: 1; }
.cols { display: grid; grid-template-columns: 180px minmax(300px, 1fr) minmax(260px, 340px); }
.col { padding: 10px; border-right: 1px solid var(--vscode-panel-border); min-width: 0; }
@media (max-width: 900px) { .cols { grid-template-columns: 1fr; } .col { border-right: 0 !important; border-bottom: 1px solid var(--vscode-panel-border); } }
h4 { margin: 12px 0 4px; font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); font-weight: 600; }
h4:first-child { margin-top: 0; }
button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 0; padding: 3px 8px; cursor: pointer; }
button.go { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
input[type=text], select { font-family: inherit; font-size: inherit; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 5px; box-sizing: border-box; }
.row { display: flex; gap: 4px; margin: 3px 0; align-items: center; }
.row label { width: 82px; flex: none; color: var(--vscode-descriptionForeground); }
.row input[type=text] { flex: 1; min-width: 0; }
.row input.n { width: 56px; flex: none; }
.tree .it { padding: 3px 6px; cursor: pointer; border-radius: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tree .it.sel { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.stage { position: relative; background: repeating-conic-gradient(#222 0% 25%, #2a2a2a 0% 50%) 0 0 / 16px 16px; border: 1px solid var(--vscode-panel-border); overflow: hidden; margin: 4px 0; }
.win { position: absolute; left: 0; top: 0; background: #1e1f24; outline: 1px solid #777; }
.titlebar { position: absolute; left: 0; top: 0; right: 0; background: #2d2e35; color: #ddd; font-family: sans-serif; display: flex; align-items: center; padding: 0 10px; box-sizing: border-box; }
.titlebar .x { margin-left: auto; background: #6a2a2a; padding: 0 8px; }
.el { position: absolute; box-sizing: border-box; font-family: sans-serif; color: #eee; overflow: hidden; display: flex; align-items: center; justify-content: center; text-align: center; cursor: pointer; }
.el.button { background: #3a3d48; border: 1px solid #555; }
.el.grid { border: 1px dashed #6a8; background: rgba(100,170,130,.06); align-items: flex-start; justify-content: flex-start; font-size: 10px; color: #8c9; padding: 1px 3px; }
.el.appearance { background: repeating-linear-gradient(45deg, #345, #345 6px, #456 6px, #456 12px); border: 1px solid #789; }
.el.sel { outline: 2px solid #4af; outline-offset: -2px; z-index: 5; }
.el.hid { opacity: .35; }
.handle { position: absolute; right: 0; bottom: 0; width: 12px; height: 12px; background: #4af; cursor: nwse-resize; }
.prob { padding: 2px 0; } .prob.error { color: var(--vscode-errorForeground); } .prob.warning { color: var(--vscode-editorWarning-foreground, #cca700); }
.ok { color: var(--vscode-testing-iconPassed, #73c991); }
pre { margin: 0; padding: 8px; overflow: auto; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); max-height: 40vh; }
.muted { color: var(--vscode-descriptionForeground); }
</style></head>
<body>
<div class="top">
  <select id="mode"><option value="window">Window (title bar + grid)</option><option value="screen">Screen objects (X, Y, W, H)</option></select>
  <button class="go" id="insert">Insert at cursor</button>
  <button id="copy">Copy Lua</button>
  <button id="import">Import from editor</button>
  <button id="preview">Show on console</button>
  <span class="sp"></span><span class="muted" id="note"></span>
</div>
<div class="cols">
  <div class="col">
    <h4>Add</h4><div id="adders"></div>
    <h4>Items</h4><div class="tree" id="tree"></div>
  </div>
  <div class="col"><div id="stagewrap"></div><div class="muted" id="hint"></div></div>
  <div class="col" style="border-right:0">
    <h4>Settings</h4><div id="settings"></div>
    <h4>Selected</h4><div id="props"><span class="muted">Click an item.</span></div>
    <h4>Problems</h4><div id="probs"></div>
    <h4>Lua</h4><pre id="lua"></pre>
  </div>
</div>
<script nonce="__NONCE__">
(function () {
  var vs = acquireVsCodeApi();
  var o = null, sel = null, rects = {}, timer = null, seq = 0;
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
  function uid() { return 'p' + (++seq) + Math.random().toString(36).slice(2, 6); }
  function all(items, fn, parent) { (items || []).forEach(function (it) { fn(it, parent); if (it.type === 'grid') all(it.items, fn, it); }); }
  function find(id) { var r = null; all(o.items, function (it, p) { if (it.id === id) r = { it: it, parent: p }; }); return r; }
  function post(cmd) { vs.postMessage({ cmd: cmd, overlay: o }); }
  function changed(rerender) {
    clearTimeout(timer);
    timer = setTimeout(function () { post('change'); }, 100);
    if (rerender) renderAll(); else { drawStage(); drawTree(); }
  }
  function txt(obj, key, ph, cls) {
    var i = el('input', { type: 'text', placeholder: ph || '' });
    if (cls) i.className = cls;
    i.value = obj[key] == null ? '' : obj[key];
    i.addEventListener('input', function () { obj[key] = i.value; changed(false); });
    return i;
  }
  function numF(obj, key) {
    var i = el('input', { type: 'text', className: 'n' });
    i.value = obj[key] == null ? '' : obj[key];
    i.addEventListener('input', function () { obj[key] = i.value === '' || isNaN(Number(i.value)) ? i.value : Number(i.value); changed(false); });
    return i;
  }
  function chk(obj, key) {
    var c = el('input', { type: 'checkbox', checked: !!obj[key] });
    c.onchange = function () { obj[key] = c.checked; changed(false); };
    return c;
  }
  function sizes(obj, key, n) {
    var i = el('input', { type: 'text', placeholder: 'blank = share, e.g. ,200' });
    var cur = obj[key] || [];
    i.value = cur.slice(0, Number(obj[n]) || 0).map(function (v) { return v == null ? '' : v; }).join(',');
    i.addEventListener('input', function () {
      obj[key] = i.value.split(',').map(function (v) { v = v.trim(); return v === '' ? null : (isNaN(Number(v)) ? v : Number(v)); });
      changed(false);
    });
    return i;
  }
  function line(label, w) { return el('div', { class: 'row' }, [el('label', { text: label }), w]); }

  function renderSettings() {
    var s = $('settings'); s.textContent = '';
    s.appendChild(line('Name', txt(o, 'name')));
    if (o.mode === 'screen') {
      s.appendChild(line('Display', numF(o, 'display')));
      s.appendChild(line('Screen W', numF(o, 'screenW')));
      s.appendChild(line('Screen H', numF(o, 'screenH')));
    } else {
      s.appendChild(line('Title', txt(o, 'title')));
      s.appendChild(line('Width', numF(o, 'w')));
      s.appendChild(line('Height', numF(o, 'h')));
      s.appendChild(line('Close button', chk(o, 'close')));
      s.appendChild(line('Columns', numF(o, 'cols')));
      s.appendChild(line('Rows', numF(o, 'rows')));
      s.appendChild(line('Col sizes', sizes(o, 'colSizes', 'cols')));
      s.appendChild(line('Row sizes', sizes(o, 'rowSizes', 'rows')));
    }
  }
  function renderAdders() {
    var a = $('adders'); a.textContent = '';
    if (o.mode === 'screen') {
      a.appendChild(el('button', { text: '+ Button', onclick: function () { addItem('screenbutton'); } }));
      a.appendChild(el('button', { text: '+ Appearance', onclick: function () { addItem('appearance'); } }));
    } else {
      a.appendChild(el('button', { text: '+ Button', onclick: function () { addItem('button'); } }));
      a.appendChild(el('button', { text: '+ Grid', onclick: function () { addItem('grid'); } }));
    }
    a.appendChild(el('button', { text: 'Delete', onclick: function () {
      var f = sel && find(sel); if (!f) return;
      var list = f.parent ? f.parent.items : o.items;
      list.splice(list.indexOf(f.it), 1); sel = null; changed(true);
    } }));
  }
  function freeCell(grid) {
    var cols = Number(grid.cols) || 1, rows = Number(grid.rows) || 1;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var taken = (grid.items || []).some(function (i) { return c >= i.left && c <= i.right && r >= i.top && r <= i.bottom; });
      if (!taken) return [c, r];
    }
    return [0, 0];
  }
  function uniqueName(base) {
    var used = {}; all(o.items, function (i) { used[i.name] = 1; });
    var n = 1; while (used[base + n]) n++; return base + n;
  }
  function addItem(type) {
    var it;
    if (o.mode === 'screen') {
      it = type === 'appearance' ? { type: 'appearance', appearance: 1, x: 100, y: 100, w: 400, h: 240, visible: true, interactive: false, handler: '', backColor: '', textColor: '' }
        : { type: 'button', text: 'Button', x: 100, y: 100, w: 300, h: 120, visible: true, interactive: true, handler: '', backColor: '', textColor: '', hasHover: true, hasPressedAnimation: true };
      it.name = uniqueName(type === 'appearance' ? 'Image' : 'Button');
    } else {
      var f = sel && find(sel), grid = f && f.it.type === 'grid' ? f.it : (f && f.parent) || o;
      var c = freeCell(grid);
      it = type === 'grid' ? { type: 'grid', name: uniqueName('Grid'), left: c[0], top: c[1], right: c[0], bottom: c[1], cols: 2, rows: 1, colSizes: [null, null], rowSizes: [null], items: [] }
        : { type: 'button', name: uniqueName('Button'), left: c[0], top: c[1], right: c[0], bottom: c[1], text: 'Button', handler: '', alignH: '', autoAdjust: false };
      (grid.items = grid.items || []).push(it);
    }
    it.id = uid();
    if (o.mode === 'screen') o.items.push(it);
    sel = it.id; changed(true);
  }
  function drawTree() {
    var t = $('tree'); t.textContent = '';
    all(o.items, function (it, parent) {
      var depth = 0, p = parent; while (p) { depth++; p = (find(p.id) || {}).parent; }
      var label = (it.name || it.type) + (it.type === 'button' && it.text ? '  "' + it.text + '"' : '');
      t.appendChild(el('div', { class: 'it' + (it.id === sel ? ' sel' : ''), text: label, onclick: function () { sel = it.id; renderProps(); drawStage(); drawTree(); } }));
      t.lastChild.style.paddingLeft = (6 + depth * 12) + 'px';
    });
  }
  function renderProps() {
    var p = $('props'); p.textContent = '';
    var f = sel && find(sel);
    if (!f) { p.appendChild(el('span', { class: 'muted', text: 'Click an item.' })); return; }
    var it = f.it;
    p.appendChild(line('Name', txt(it, 'name')));
    if (o.mode === 'screen') {
      p.appendChild(line('X / Y', el('span', { class: 'row' }, [numF(it, 'x'), numF(it, 'y')])));
      p.appendChild(line('W / H', el('span', { class: 'row' }, [numF(it, 'w'), numF(it, 'h')])));
      if (it.type === 'button') p.appendChild(line('Text', txt(it, 'text')));
      else p.appendChild(line('Appearance', numF(it, 'appearance')));
      p.appendChild(line('Back colour', txt(it, 'backColor', 'e.g. Global.Transparent')));
      p.appendChild(line('Text colour', txt(it, 'textColor')));
      p.appendChild(line('Click handler', txt(it, 'handler', 'signalTable name')));
      p.appendChild(line('Interactive', chk(it, 'interactive')));
      p.appendChild(line('Visible', chk(it, 'visible')));
      if (it.type === 'button') { p.appendChild(line('Hover', chk(it, 'hasHover'))); p.appendChild(line('Press anim.', chk(it, 'hasPressedAnimation'))); }
    } else {
      p.appendChild(line('Cells L,T', el('span', { class: 'row' }, [numF(it, 'left'), numF(it, 'top')])));
      p.appendChild(line('Cells R,B', el('span', { class: 'row' }, [numF(it, 'right'), numF(it, 'bottom')])));
      if (it.type === 'button') {
        p.appendChild(line('Text', txt(it, 'text')));
        p.appendChild(line('Click handler', txt(it, 'handler', 'signalTable name')));
        var al = el('select'); ['', 'Left', 'Center', 'Right'].forEach(function (v) { al.appendChild(el('option', { value: v, text: v || '(default)' })); });
        al.value = it.alignH || ''; al.onchange = function () { it.alignH = al.value; changed(false); };
        p.appendChild(line('Align', al));
        p.appendChild(line('Auto-fit text', chk(it, 'autoAdjust')));
      } else {
        p.appendChild(line('Columns', numF(it, 'cols')));
        p.appendChild(line('Rows', numF(it, 'rows')));
        p.appendChild(line('Col sizes', sizes(it, 'colSizes', 'cols')));
        p.appendChild(line('Row sizes', sizes(it, 'rowSizes', 'rows')));
      }
    }
  }
  function drawStage() {
    var w = $('stagewrap'); w.textContent = '';
    var W = o.mode === 'screen' ? Number(o.screenW) || 1920 : Number(o.w) || 800;
    var H = o.mode === 'screen' ? Number(o.screenH) || 1080 : Number(o.h) || 500;
    var avail = Math.max(240, w.clientWidth || 520);
    var k = Math.min(1, avail / W);
    var stage = el('div', { class: 'stage' });
    stage.style.width = Math.round(W * k) + 'px'; stage.style.height = Math.round(H * k) + 'px';
    var host = stage;
    if (o.mode === 'window') {
      host = el('div', { class: 'win' }); host.style.width = stage.style.width; host.style.height = stage.style.height;
      var tb = el('div', { class: 'titlebar' }, [el('span', { text: o.title || '' }), o.close ? el('span', { class: 'x', text: 'X' }) : null]);
      tb.style.height = Math.round(60 * k) + 'px'; tb.style.fontSize = Math.max(9, Math.round(24 * k)) + 'px';
      host.appendChild(tb); stage.appendChild(host);
    }
    var list = [];
    all(o.items, function (it) { list.push(it); });
    list.forEach(function (it) {
      var r = o.mode === 'screen' ? { x: Number(it.x) || 0, y: Number(it.y) || 0, w: Number(it.w) || 0, h: Number(it.h) || 0 } : rects[it.id];
      if (!r) return;
      var d = el('div', { class: 'el ' + it.type + (it.id === sel ? ' sel' : '') + (it.visible === false ? ' hid' : ''), text: it.type === 'button' ? (it.text || '') : (it.type === 'grid' ? (it.name || 'grid') : 'Appearance ' + it.appearance) });
      d.style.left = Math.round(r.x * k) + 'px'; d.style.top = Math.round(r.y * k) + 'px';
      d.style.width = Math.max(2, Math.round(r.w * k)) + 'px'; d.style.height = Math.max(2, Math.round(r.h * k)) + 'px';
      d.style.fontSize = Math.max(8, Math.round(22 * k)) + 'px';
      if (it.type === 'grid') d.style.fontSize = '10px';
      d.addEventListener('pointerdown', function (ev) {
        ev.stopPropagation(); sel = it.id; renderProps(); drawTree();
        if (o.mode !== 'screen') { drawStage(); return; }
        var resize = ev.target.className === 'handle';
        var sx = ev.clientX, sy = ev.clientY, ox = Number(it.x), oy = Number(it.y), ow = Number(it.w), oh = Number(it.h);
        d.setPointerCapture(ev.pointerId);
        d.onpointermove = function (e2) {
          var dx = Math.round((e2.clientX - sx) / k), dy = Math.round((e2.clientY - sy) / k);
          if (resize) { it.w = Math.max(1, ow + dx); it.h = Math.max(1, oh + dy); } else { it.x = ox + dx; it.y = oy + dy; }
          d.style.left = Math.round(it.x * k) + 'px'; d.style.top = Math.round(it.y * k) + 'px';
          d.style.width = Math.max(2, Math.round(it.w * k)) + 'px'; d.style.height = Math.max(2, Math.round(it.h * k)) + 'px';
        };
        d.onpointerup = function () { d.onpointermove = null; d.onpointerup = null; renderProps(); changed(false); };
      });
      if (o.mode === 'screen' && it.id === sel) d.appendChild(el('span', { class: 'handle' }));
      host.appendChild(d);
    });
    host.addEventListener('pointerdown', function () { sel = null; renderProps(); drawStage(); drawTree(); });
    w.appendChild(stage);
    $('hint').textContent = o.mode === 'screen' ? 'Drag to move, drag the blue corner to resize. Preview is scaled to ' + W + ' x ' + H + '.' : 'Preview is approximate: the console adds its own padding.';
  }
  function renderAll() { $('mode').value = o.mode; renderSettings(); renderAdders(); renderProps(); drawTree(); drawStage(); }

  $('mode').onchange = function () { vs.postMessage({ cmd: 'mode', mode: $('mode').value }); };
  ['insert', 'copy', 'preview', 'import'].forEach(function (c) { $(c).onclick = function () { post(c); }; });
  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (m.type === 'load') {
      o = m.overlay; all(o.items, function (it) { if (!it.id) it.id = uid(); }); sel = null; rects = {};
      renderAll(); post('change'); $('note').textContent = m.note || '';
    } else if (m.type === 'result') {
      $('lua').textContent = m.lua; rects = {};
      (m.rects || []).forEach(function (r) { rects[r.id] = r; });
      var p = $('probs'); p.textContent = '';
      if (!m.problems.length) p.appendChild(el('div', { class: 'ok', text: 'No problems.' }));
      m.problems.forEach(function (x) { p.appendChild(el('div', { class: 'prob ' + x.level, text: x.message })); });
      drawStage();
    } else if (m.type === 'note') { $('note').textContent = m.note; }
  });
  window.addEventListener('resize', function () { if (o) drawStage(); });
  vs.postMessage({ cmd: 'ready' });
})();
</script></body></html>`;

function overlayHtml(nonce) {
  return PAGE.replace(/__NONCE__/g, nonce);
}

module.exports = { overlayHtml };
