'use strict';

// Overlay designer, stage B: a grandMA3 window built from UI objects on the screen overlay, the way plugins
// such as File Daddy build theirs. Only what real plugins use is offered: a BaseInput window with a TitleBar
// (and CloseButton), nested UILayoutGrid cells, and Buttons. Cells are addressed as MA does, left,top,right,bottom
// (inclusive cell indices; a single cell is "0,1"). A row or column with a size is SizePolicy "Fixed" in pixels;
// one without shares what is left.
//
// overlay = { name, title, w, h, close, cols, rows, colSizes, rowSizes, items }
// item    = { id, type: 'button'|'grid', name, left, top, right, bottom,
//             button: text, handler, alignH, autoAdjust
//             grid:   cols, rows, colSizes, rowSizes, items }

const TITLE_H = 60;
const MAX_ITEMS = 200;
const MAX_DEPTH = 4;
const LIMITS = { w: [200, 3840], h: [120, 2160], cells: 24 };

let seq = 0;
const nextId = () => `i${++seq}`;

// Two modes, both taken from shipping plugins. "window" (File Daddy): a BaseInput with a TitleBar and a
// UILayoutGrid of cells. "screen" (Screensaver): free X, Y, W, H objects (Button, AppearancePreview) appended
// straight to a display's ScreenOverlay, no window around them.
//   screen: overlay = { mode: 'screen', name, display, screenW, screenH, items }
//           item    = { id, type: 'button'|'appearance', name, x, y, w, h, text, handler, backColor, textColor,
//                       interactive, visible, hasHover, hasPressedAnimation, appearance }
function newOverlay(mode) {
  if (mode === 'screen') return { mode: 'screen', name: 'MyOverlay', display: 1, screenW: 1920, screenH: 1080, items: [] };
  return { mode: 'window', name: 'MyWindow', title: 'My Window', w: 800, h: 500, close: true, cols: 2, rows: 1, colSizes: [null, null], rowSizes: [null], items: [] };
}

function newScreenItem(type) {
  const common = { id: nextId(), type, name: '', x: 100, y: 100, w: 300, h: 120, visible: true, interactive: false, handler: '', backColor: '', textColor: '' };
  if (type === 'appearance') return { ...common, appearance: 1 };
  return { ...common, text: 'Button', hasHover: true, hasPressedAnimation: true };
}

function newItem(type, left, top) {
  if (type === 'appearance') return newScreenItem('appearance');
  if (type === 'screenbutton') return newScreenItem('button');
  const base = { id: nextId(), type, name: '', left, top, right: left, bottom: top };
  if (type === 'grid') return { ...base, cols: 2, rows: 1, colSizes: [null, null], rowSizes: [null], items: [] };
  return { ...base, text: 'Button', handler: '', alignH: '', autoAdjust: false };
}

const isId = (s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(s || ''));
const num = (v) => (v === '' || v == null ? null : Number(v));
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function luaStr(s) {
  let out = '"';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < 32 || c === 127) out += `\\${String(c).padStart(3, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

function walk(items, fn, depth = 1, parent = null) {
  for (const it of items || []) {
    fn(it, depth, parent);
    if (it.type === 'grid') walk(it.items, fn, depth + 1, it);
  }
}

// ---------------------------------------------------------------------------------------------- validation

// [{ level, item (id or null), message }]
function validateScreen(o) {
  const out = [];
  const add = (level, item, message) => out.push({ level, item: item || null, message });
  if (!isId(o.name)) add('error', null, 'The overlay name must start with a letter and use letters, digits and _ only.');
  if (!intIn(Number(o.display), 1, 16)) add('error', null, 'The display number must be 1 to 16.');
  if (!intIn(Number(o.screenW), 100, 7680) || !intIn(Number(o.screenH), 100, 4320)) add('error', null, 'The screen size is for the preview only: width 100 to 7680, height 100 to 4320.');
  const names = new Set();
  (o.items || []).forEach((it) => {
    const label = it.name || it.text || it.type;
    if (it.name) {
      if (!isId(it.name)) add('error', it.id, `${label}: the name must start with a letter and use letters, digits and _ only.`);
      else if (names.has(it.name)) add('error', it.id, `The name "${it.name}" is used twice.`);
      names.add(it.name);
    }
    for (const k of ['x', 'y']) if (!Number.isFinite(Number(it[k]))) add('error', it.id, `${label}: ${k} must be a number.`);
    for (const k of ['w', 'h']) if (!(Number(it[k]) >= 1)) add('error', it.id, `${label}: ${k} must be 1 or more.`);
    if (it.handler && !isId(it.handler)) add('error', it.id, `${label}: "${it.handler}" is not a usable handler name.`);
    if (it.handler && !it.interactive) add('warning', it.id, `${label}: has a click handler but is not interactive, so it will never be clicked.`);
    if (it.type === 'appearance' && !intIn(Number(it.appearance), 1, 99999)) add('error', it.id, `${label}: the appearance number must be 1 or more.`);
  });
  if ((o.items || []).length > MAX_ITEMS) add('error', null, `An overlay holds at most ${MAX_ITEMS} items.`);
  if (!(o.items || []).length) add('warning', null, 'The overlay has no items yet.');
  return out;
}

function validate(o) {
  if (o.mode === 'screen') return validateScreen(o);
  const out = [];
  const add = (level, item, message) => out.push({ level, item: item || null, message });
  if (!isId(o.name)) add('error', null, 'The window name must start with a letter and use letters, digits and _ only.');
  if (!intIn(Number(o.w), LIMITS.w[0], LIMITS.w[1])) add('error', null, `Window width must be ${LIMITS.w[0]} to ${LIMITS.w[1]}.`);
  if (!intIn(Number(o.h), LIMITS.h[0], LIMITS.h[1])) add('error', null, `Window height must be ${LIMITS.h[0]} to ${LIMITS.h[1]}.`);
  const gridCheck = (g, where, id) => {
    if (!intIn(Number(g.cols), 1, LIMITS.cells) || !intIn(Number(g.rows), 1, LIMITS.cells)) add('error', id, `${where}: columns and rows must be 1 to ${LIMITS.cells}.`);
    for (const [label, arr, n] of [['column', g.colSizes, g.cols], ['row', g.rowSizes, g.rows]]) {
      (arr || []).slice(0, n).forEach((s, i) => {
        if (s != null && !(Number.isFinite(Number(s)) && Number(s) > 0)) add('error', id, `${where}: the size of ${label} ${i + 1} must be a positive number of pixels.`);
      });
    }
  };
  gridCheck(o, 'Window', null);

  let count = 0;
  const names = new Map();
  const handlers = new Set();
  const level = (items, grid, where, depth) => {
    for (const it of items || []) {
      count++;
      const id = it.id;
      const label = it.name || (it.type === 'button' ? it.text : 'grid') || it.type;
      if (depth > MAX_DEPTH) add('error', id, `${label}: grids are nested more than ${MAX_DEPTH} deep.`);
      if (!isId(it.name)) add('error', id, `${label}: the name must start with a letter and use letters, digits and _ only.`);
      else if (names.has(it.name)) add('error', id, `The name "${it.name}" is used twice; names must be unique in the window.`);
      else names.set(it.name, id);
      const { left, top, right, bottom } = it;
      const cols = Number(grid.cols), rows = Number(grid.rows);
      if (![left, top, right, bottom].every(Number.isInteger) || left < 0 || top < 0 || right >= cols || bottom >= rows || right < left || bottom < top) {
        add('error', id, `${label}: its cells (${left},${top} to ${right},${bottom}) are outside the ${cols} x ${rows} grid.`);
      }
      if (it.type === 'button') {
        if (it.handler) {
          if (!isId(it.handler)) add('error', id, `${label}: "${it.handler}" is not a usable handler name.`);
          handlers.add(it.handler);
        }
      } else {
        gridCheck(it, label, id);
        level(it.items, it, label, depth + 1);
      }
    }
    // Overlapping items in one grid.
    const list = items || [];
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const p = list[a], q = list[b];
        if (p.left <= q.right && q.left <= p.right && p.top <= q.bottom && q.top <= p.bottom) {
          add('warning', q.id, `${q.name || q.type} overlaps ${p.name || p.type} in ${where}.`);
        }
      }
    }
  };
  level(o.items, o, 'the window', 1);
  if (count > MAX_ITEMS) add('error', null, `A window holds at most ${MAX_ITEMS} items.`);
  if (!count) add('warning', null, 'The window has no items yet.');
  return out;
}

const hasErrors = (p) => p.some((x) => x.level === 'error');

// ---------------------------------------------------------------------------------------------- layout preview

function splitAxis(total, sizes, n) {
  const fixed = [];
  let used = 0, free = 0;
  for (let i = 0; i < n; i++) {
    const s = num(sizes && sizes[i]);
    if (s != null && s > 0) { fixed[i] = s; used += s; } else { fixed[i] = null; free++; }
  }
  const share = free ? Math.max(0, (total - used) / free) : 0;
  const out = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const w = fixed[i] != null ? fixed[i] : share;
    out.push({ at, size: w });
    at += w;
  }
  return out;
}

// Rectangles of every item in window pixels, y from the top of the window (the title bar takes the first
// TITLE_H). Approximate: the console's own padding and minimum sizes are not modelled.
function layoutRects(o) {
  if (o.mode === 'screen') return (o.items || []).map((it) => ({ id: it.id, type: it.type, x: Number(it.x) || 0, y: Number(it.y) || 0, w: Number(it.w) || 0, h: Number(it.h) || 0 }));
  const rects = [];
  const place = (items, box, g) => {
    const xs = splitAxis(box.w, g.colSizes, Number(g.cols));
    const ys = splitAxis(box.h, g.rowSizes, Number(g.rows));
    for (const it of items || []) {
      const c0 = xs[it.left], c1 = xs[it.right], r0 = ys[it.top], r1 = ys[it.bottom];
      if (!c0 || !c1 || !r0 || !r1) continue;
      const r = { id: it.id, type: it.type, x: box.x + c0.at, y: box.y + r0.at, w: c1.at + c1.size - c0.at, h: r1.at + r1.size - r0.at };
      rects.push(r);
      if (it.type === 'grid') place(it.items, r, it);
    }
  };
  place(o.items, { x: 0, y: TITLE_H, w: Number(o.w), h: Number(o.h) - TITLE_H }, o);
  return rects;
}

// ---------------------------------------------------------------------------------------------- generation

const STATE_MARK = '--[[ ma3-overlay-designer';

// The design rides along in a Lua long comment as base64, so no text of the design can contain "]]" and end the
// comment early (a button text could otherwise inject code).
const stateComment = (o) => `${STATE_MARK} ${Buffer.from(JSON.stringify(o), 'utf8').toString('base64')} ]]`;

function sizeLines(varName, g, indent) {
  const lines = [];
  (g.colSizes || []).slice(0, Number(g.cols)).forEach((s, i) => { if (num(s) > 0) lines.push(`${indent}cell(${varName}, 2, ${i + 1}, ${num(s)})`); });
  (g.rowSizes || []).slice(0, Number(g.rows)).forEach((s, i) => { if (num(s) > 0) lines.push(`${indent}cell(${varName}, 1, ${i + 1}, ${num(s)})`); });
  return lines;
}

const anchors = (it) => (it.left === it.right && it.top === it.bottom ? `${it.left},${it.top}` : `${it.left},${it.top},${it.right},${it.bottom}`);

const COLOR = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;

// Screen mode: objects added straight to the display's ScreenOverlay and removed again by walking the parent's
// children (a UI object has no :Index()), as the Screensaver does.
function generateScreen(o) {
  const out = [];
  const handlers = [];
  (o.items || []).forEach((it) => { if (it.handler && !handlers.includes(it.handler)) handlers.push(it.handler); });
  out.push('local pluginName, _, signalTable, myHandle = ...', '');
  out.push('local shown = {} -- { { overlay = handle, obj = handle }, ... }', '');
  out.push('local function setProps(obj, props)');
  out.push('  for key, value in pairs(props) do');
  out.push('    local ok, err = pcall(function() obj[key] = value end)');
  out.push('    if not ok then Printf("%s: could not set %s (%s).", tostring(pluginName), key, tostring(err)) end');
  out.push('  end', 'end', '');
  out.push('local function add(parent, class, props)');
  out.push('  local ok, obj = pcall(function() return parent:Append(class) end)');
  out.push('  if not ok or not obj then Printf("%s: could not add %s.", tostring(pluginName), class); return nil end');
  out.push('  setProps(obj, props)', '  shown[#shown + 1] = { overlay = parent, obj = obj }', '  return obj', 'end', '');
  out.push('local function closeOverlay()');
  out.push('  for i = #shown, 1, -1 do');
  out.push('    local entry = shown[i]');
  out.push('    local ok, kids = pcall(function() return entry.overlay:Children() end)');
  out.push('    if ok and kids then');
  out.push('      for index, kid in ipairs(kids) do');
  out.push('        if rawequal(kid, entry.obj) or kid == entry.obj then pcall(function() entry.overlay:Remove(index) end); break end');
  out.push('      end', '    end', '  end', '  shown = {}', 'end', '');
  handlers.forEach((h) => { out.push(`signalTable.${h} = function(caller)`, '  -- caller.Name tells which object was clicked', 'end', ''); });
  out.push('local function openOverlay()', '  closeOverlay()');
  out.push(`  local overlay = GetDisplayByIndex(${Number(o.display)}).ScreenOverlay`);
  (o.items || []).forEach((it) => {
    const props = [];
    if (it.name) props.push(`Name = ${luaStr(it.name)}`);
    props.push(`X = ${Number(it.x)}`, `Y = ${Number(it.y)}`, `W = ${Number(it.w)}`, `H = ${Number(it.h)}`, `Visible = ${it.visible === false ? 'false' : 'true'}`, `Interactive = ${it.interactive ? 'true' : 'false'}`);
    if (it.type === 'appearance') {
      props.push(`Appearance = GetObject(${luaStr(`Appearance ${Number(it.appearance)}`)})`);
    } else {
      props.push(`Text = ${luaStr(it.text)}`);
      if (it.hasHover === false) props.push('HasHover = false');
      if (it.hasPressedAnimation === false) props.push('HasPressedAnimation = false');
    }
    if (it.backColor && COLOR.test(it.backColor)) props.push(`BackColor = ${luaStr(it.backColor)}`);
    if (it.textColor && COLOR.test(it.textColor)) props.push(`TextColor = ${luaStr(it.textColor)}`);
    if (it.handler) props.push('PluginComponent = myHandle', `Clicked = ${luaStr(it.handler)}`);
    out.push(`  add(overlay, ${luaStr(it.type === 'appearance' ? 'AppearancePreview' : 'Button')}, { ${props.join(', ')} })`);
  });
  out.push('end', '', 'return openOverlay, closeOverlay', '');
  out.push(`${stateComment(o)}`, '');
  return out.join('\n');
}

function generate(o) {
  if (o.mode === 'screen') return generateScreen(o);
  const out = [];
  const handlerOf = (it) => (it.handler ? it.handler : '');
  const handlers = [];
  walk(o.items, (it) => { if (it.type === 'button' && it.handler && !handlers.includes(it.handler)) handlers.push(it.handler); });

  out.push('local _, _, signalTable, myHandle = ...', '');
  out.push('-- A row or column with a fixed size (axis 1 = rows, 2 = columns).');
  out.push('local function cell(grid, axis, index, size)');
  out.push('  grid[axis][index].SizePolicy = "Fixed"');
  out.push('  grid[axis][index].Size = tostring(size)');
  out.push('end', '');
  handlers.forEach((h) => {
    out.push(`signalTable.${h} = function(caller)`, '  -- caller.Name tells which button was pressed', 'end', '');
  });
  out.push('local function openWindow()');
  out.push('  local display = GetFocusDisplay()');
  out.push('  local overlay = display.ScreenOverlay');
  out.push('  for _, child in ipairs(overlay:UIChildren() or {}) do');
  out.push(`    if tostring((child:Get("Name"))) == ${luaStr(o.name)} then overlay:Remove(child:Index()) end`);
  out.push('  end', '');
  out.push('  local dlg = overlay:Append("BaseInput")');
  out.push(`  dlg.Name = ${luaStr(o.name)}`);
  out.push(`  dlg.W = ${Number(o.w)}`);
  out.push(`  dlg.H = ${Number(o.h)}`);
  out.push('  dlg.Columns = 1', '  dlg.Rows = 2');
  out.push(`  cell(dlg, 1, 1, ${TITLE_H})`);
  out.push('  dlg.AutoClose = false');
  out.push('  pcall(function() dlg.AlignmentH = "Center"; dlg.AlignmentV = "Center" end)', '');
  out.push('  local titleBar = dlg:Append("TitleBar")');
  out.push(`  titleBar.Columns = ${o.close ? 2 : 1}`, '  titleBar.Rows = 1', '  titleBar.Anchors = "0,0"');
  if (o.close) out.push('  cell(titleBar, 2, 2, 50)');
  out.push('  local titleButton = titleBar:Append("TitleButton")', '  titleButton.Anchors = "0,0"', `  titleButton.Text = ${luaStr(o.title)}`);
  if (o.close) out.push('  local close = titleBar:Append("CloseButton")', '  close.Anchors = "1,0"');
  out.push('');
  out.push('  local content = dlg:Append("UILayoutGrid")');
  out.push(`  content.Columns = ${Number(o.cols)}`, `  content.Rows = ${Number(o.rows)}`, '  content.Anchors = "0,1"');
  out.push(...sizeLines('content', o, '  '));

  let n = 0;
  const emit = (items, parentVar) => {
    for (const it of items) {
      const v = `e${++n}`;
      if (it.type === 'grid') {
        out.push('', `  local ${v} = ${parentVar}:Append("UILayoutGrid")`, `  ${v}.Name = ${luaStr(it.name)}`, `  ${v}.Anchors = ${luaStr(anchors(it))}`, `  ${v}.Columns = ${Number(it.cols)}`, `  ${v}.Rows = ${Number(it.rows)}`);
        out.push(...sizeLines(v, it, '  '));
        emit(it.items || [], v);
      } else {
        out.push('', `  local ${v} = ${parentVar}:Append("Button")`, `  ${v}.Name = ${luaStr(it.name)}`, `  ${v}.Anchors = ${luaStr(anchors(it))}`, `  ${v}.Text = ${luaStr(it.text)}`);
        if (it.alignH) out.push(`  pcall(function() ${v}.TextAlignmentH = ${luaStr(it.alignH)} end)`);
        if (it.autoAdjust) out.push(`  pcall(function() ${v}.TextAutoAdjust = "Yes" end)`);
        if (handlerOf(it)) out.push(`  ${v}.PluginComponent = myHandle`, `  ${v}.Clicked = ${luaStr(handlerOf(it))}`);
      }
    }
  };
  emit(o.items || [], 'content');
  out.push('end', '', 'return openWindow', '');
  out.push(`${stateComment(o)}`, '');
  return out.join('\n');
}

// Reads a design back out of code this designer wrote (the state comment at its end).
function importDesign(text) {
  const s = String(text);
  const at = s.lastIndexOf(STATE_MARK);
  if (at < 0) return null;
  const end = s.indexOf(' ]]', at);
  if (end < 0) return null;
  try {
    const o = JSON.parse(Buffer.from(s.slice(at + STATE_MARK.length, end).trim(), 'base64').toString('utf8'));
    if (!o || typeof o !== 'object' || !Array.isArray(o.items)) return null;
    const norm = (it) => { it.id = nextId(); if (it.type === 'grid') (it.items || []).forEach(norm); };
    o.items.forEach(norm);
    return o;
  } catch (_) {
    return null;
  }
}

module.exports = { TITLE_H, MAX_ITEMS, MAX_DEPTH, newOverlay, newItem, validate, hasErrors, layoutRects, generate, importDesign, luaStr, splitAxis };
