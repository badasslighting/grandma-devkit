'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const M = require('../lib/overlayModel');

const lua = spawnSync('lua', ['-v']).status === 0;

function windowDesign() {
  const o = M.newOverlay();
  o.cols = 2; o.rows = 2; o.colSizes = [null, 200]; o.rowSizes = [50, null];
  const a = M.newItem('button', 0, 0); a.name = 'Save'; a.text = 'Save "now"'; a.handler = 'OnSave'; a.alignH = 'Left'; a.autoAdjust = true;
  const g = M.newItem('grid', 0, 1); g.name = 'Pane'; g.right = 1; g.cols = 3; g.rows = 1; g.colSizes = [null, null, 80];
  const b = M.newItem('button', 2, 0); b.name = 'Row1'; b.text = 'Row 1'; b.handler = 'OnSave';
  g.items = [b];
  o.items = [a, g];
  return o;
}

function screenDesign() {
  const o = M.newOverlay('screen');
  const b = M.newItem('screenbutton'); b.name = 'Hit'; b.text = 'Tap'; b.interactive = true; b.handler = 'OnTap'; b.backColor = 'Global.Transparent'; b.hasHover = false;
  const im = M.newItem('appearance'); im.appearance = 7; im.x = 0; im.y = 0; im.w = 1920; im.h = 1080;
  o.items = [im, b];
  return o;
}

test('a good window design has no errors', () => {
  assert.deepStrictEqual(M.validate(windowDesign()).filter((p) => p.level === 'error'), []);
});

test('window validation: names, cells out of the grid, overlaps, nested handler names, sizes', () => {
  const o = windowDesign();
  o.items[0].name = 'Row1';
  o.items[0].right = 5;
  o.items[1].items[0].left = 0; o.items[1].items[0].right = 2; // fine inside 3 cols
  const extra = M.newItem('button', 0, 0); extra.name = 'Other'; extra.handler = 'bad name';
  o.items.push(extra);
  o.colSizes = [null, -4];
  const msgs = M.validate(o).map((p) => p.message).join('|');
  assert.match(msgs, /used twice/);
  assert.match(msgs, /outside the 2 x 2 grid/);
  assert.match(msgs, /overlaps/);
  assert.match(msgs, /not a usable handler/);
  assert.match(msgs, /size of column 2/);
});

test('screen validation: handler without interactive is a warning, bad numbers are errors', () => {
  const o = screenDesign();
  o.items[1].interactive = false;
  o.items[0].w = 0;
  o.items[0].appearance = 0;
  const p = M.validate(o);
  assert.ok(p.some((x) => x.level === 'warning' && /not interactive/.test(x.message)));
  assert.ok(p.some((x) => x.level === 'error' && /w must be/.test(x.message)));
  assert.ok(p.some((x) => x.level === 'error' && /appearance number/.test(x.message)));
});

test('layoutRects: fixed sizes are kept, the rest is shared, nested grids sit inside their cell', () => {
  const o = windowDesign(); // 800 x 500, title 60: content 800 x 440; columns [free, 200], rows [50, free]
  const r = Object.fromEntries(M.layoutRects(o).map((x) => [x.id, x]));
  const [a, g] = o.items;
  assert.deepStrictEqual([r[a.id].x, r[a.id].y, r[a.id].w, r[a.id].h], [0, 60, 600, 50]);
  assert.deepStrictEqual([r[g.id].x, r[g.id].y, r[g.id].w, r[g.id].h], [0, 110, 800, 390]);
  const inner = r[g.items[0].id]; // third column of a 3-column grid, 80 wide, at the right end of the grid
  assert.deepStrictEqual([inner.x, inner.w], [720, 80]);
});

test('window code: structure, quoting, one handler stub per handler name, state comment', () => {
  const code = M.generate(windowDesign());
  assert.match(code, /overlay:Append\("BaseInput"\)/);
  assert.match(code, /\.Text = "Save \\"now\\""/);
  assert.match(code, /Anchors = "0,1,1,1"/); // a grid spanning both columns
  assert.strictEqual((code.match(/signalTable\.OnSave = function/g) || []).length, 1);
  assert.match(code, /cell\(content, 2, 2, 200\)/);
  assert.match(code, /return openWindow\n/);
  assert.ok(M.importDesign(code));
});

test('importDesign gives the design back (ids renewed) and ignores code without the comment', () => {
  const o = windowDesign();
  const back = M.importDesign(M.generate(o));
  const strip = (d) => JSON.parse(JSON.stringify(d, (k, v) => (k === 'id' ? undefined : v)));
  assert.deepStrictEqual(strip(back), strip(o));
  assert.strictEqual(M.importDesign('print("hi")'), null);
  assert.strictEqual(M.importDesign('--[[ ma3-overlay-designer !!notbase64!! ]]'), null);
  const s = screenDesign();
  assert.deepStrictEqual(strip(M.importDesign(M.generate(s))), strip(s));
});

test('screen code: ScreenOverlay objects with X Y W H, appearance object, handler wiring', () => {
  const code = M.generate(screenDesign());
  assert.match(code, /GetDisplayByIndex\(1\)\.ScreenOverlay/);
  assert.match(code, /add\(overlay, "AppearancePreview", \{ X = 0, Y = 0, W = 1920, H = 1080, Visible = true, Interactive = false, Appearance = GetObject\("Appearance 7"\) \}\)/);
  assert.match(code, /Clicked = "OnTap"/);
  assert.match(code, /HasHover = false/);
  assert.match(code, /BackColor = "Global\.Transparent"/);
  assert.match(code, /return openOverlay, closeOverlay/);
});

test('a colour with odd characters is dropped, never written into the code', () => {
  const o = screenDesign();
  o.items[1].backColor = '"; os.execute("x") --';
  assert.ok(!/os\.execute/.test(M.generate(o)));
});

test('window code runs against a stubbed console and builds the tree', { skip: !lua && 'no lua on PATH' }, () => {
  const code = `
local log = {}
local function node(class)
  local n = { class = class, kids = {} }
  return setmetatable(n, { __index = function(t, k) if k == "Append" then return function(self, c) local c2 = node(c); self.kids[#self.kids + 1] = c2; log[#log + 1] = c; return c2 end
    elseif k == "UIChildren" then return function() return {} end
    elseif type(k) == "number" then local cell = {}; rawset(t, k, cell); return setmetatable(cell, { __index = function(c, i) local x = {}; rawset(c, i, x); return x end }) end end,
    __newindex = rawset })
end
local screenOverlay = node("overlay")
function GetFocusDisplay() return { ScreenOverlay = screenOverlay } end
function Printf() end
local chunk = load(${JSON.stringify(M.generate(windowDesign()))}, "design", "t", _ENV)
local open = chunk(nil, nil, {}, {})
open()
assert(table.concat(log, ",") == "BaseInput,TitleBar,TitleButton,CloseButton,UILayoutGrid,Button,UILayoutGrid,Button", table.concat(log, ","))`;
  const r = spawnSync('lua', ['-'], { input: code, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

test('screen code runs: objects are added and closeOverlay clears them', { skip: !lua && 'no lua on PATH' }, () => {
  const code = `
local added, removed = {}, 0
local overlay = setmetatable({ kids = {} }, { __index = function(t, k)
  if k == "Append" then return function(self, c) local o = { class = c }; self.kids[#self.kids + 1] = o; added[#added + 1] = c; return o end
  elseif k == "Children" then return function(self) return self.kids end
  elseif k == "Remove" then return function(self, i) table.remove(self.kids, i); removed = removed + 1 end end end })
function GetDisplayByIndex() return { ScreenOverlay = overlay } end
function GetObject(n) return { name = n } end
function Printf() end
local chunk = load(${JSON.stringify(M.generate(screenDesign()))}, "design", "t", _ENV)
local open, close = chunk("P", nil, {}, {})
open()
assert(#added == 2 and #overlay.kids == 2, "added")
close()
assert(removed == 2 and #overlay.kids == 0, "removed")`;
  const r = spawnSync('lua', ['-'], { input: code, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

test('text containing "]]" cannot end the state comment: code stays one comment and the design still round-trips', () => {
  const o = screenDesign();
  o.items[1].text = 'x ]] os.execute("boom") --[[ y';
  const code = M.generate(o);
  const tail = code.slice(code.lastIndexOf('--[[ ma3-overlay-designer'));
  assert.strictEqual((tail.match(/\]\]/g) || []).length, 1);
  assert.strictEqual(M.importDesign(code).items[1].text, o.items[1].text);
  const w = windowDesign();
  w.items[0].text = 'a ]] b';
  assert.strictEqual((M.generate(w).slice(M.generate(w).lastIndexOf('--[[ ma3-overlay')).match(/\]\]/g) || []).length, 1);
});
