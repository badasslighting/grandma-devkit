'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildCallGraph, entryPoints, costOf, lenses } = require('../lib/frameBudget');
const { lintRules } = require('../lib/rules');
const api = require('../data/api.json');

const rules = (src, opts) => lintRules(src, api, opts).map((f) => f.rule + '@' + f.line);
const reach = (src, opts) => lintRules(src, api, opts).filter((f) => f.rule === 'heavy-reachable');
const edges = (src) => {
  const g = buildCallGraph(src);
  return g.nodes.filter((n) => n.name).map((n) => `${n.name}>${[...new Set(n.calls.flatMap((c) => c.targets.map((t) => t.name)))].join(',')}`);
};

test('call graph: local, global, module, assigned and method functions', () => {
  const src = [
    'local M = {}',
    'local function a() b() end',
    'function b() M.c() end',
    'function M.c() M:d() end',
    'function M:d() self:e() end',
    'M.e = function() f() end',
    'local f = function() end',
  ].join('\n');
  assert.deepStrictEqual(edges(src), ['a>b', 'b>c', 'c>d', 'd>e', 'e>f', 'f>']);
});

test('call graph: recursion and mutual recursion terminate', () => {
  const src = 'local function a(n) if n > 0 then a(n - 1) end end\nlocal function p() q() end\nfunction q() p() ObjectList("x") end';
  assert.deepStrictEqual(edges(src), ['a>a', 'p>q', 'q>p']);
  const cost = costOf(src);
  assert.deepStrictEqual(cost.find((c) => c.name === 'p').reachableHeavy.map((r) => [r.via, r.call]), [[['q'], 'ObjectList']]);
  assert.ok(Number.isFinite(cost.find((c) => c.name === 'q').totalCost));
});

test('costOf: weights, loops multiply, cmd count', () => {
  const [f] = costOf('local function f()\n  for i = 1, 3 do Cmd("Go+") end\n  ObjectList("Group 1")\nend');
  assert.deepStrictEqual([f.heavy, f.loops, f.cmdCalls, f.cost], [[{ name: 'ObjectList', line: 2 }], [1], 1, 10 * 10 + 10]);
});

test('entry points: Timer inline and by name, hook, gma.timer, signal handlers, returned plugin functions', () => {
  const src = [
    'local pluginName, componentName, sig, me = select(1, ...)',
    'local function tick() end',
    'local function onChange() end',
    'sig.OnClick = function() end',
    'local function Main()',
    '  Timer(tick, 0.1, 0)',
    '  HookObjectChange(onChange, Root(), me)',
    '  Timer(function() end, 1, 1)',
    'end',
    'gma.timer(function() end, 0.5, 0)',
    'return Main',
  ].join('\n');
  const e = entryPoints(src).map((x) => `${x.node.name || 'anon'}:${x.kind}:${x.perTick}`);
  assert.deepStrictEqual(e, ['tick:timer:true', 'onChange:hook:true', 'OnClick:signal:false', 'Main:plugin:false', 'anon:timer:false', 'anon:timer:true']);
});

test('G3: one heavy-reachable at the scan() call', () => {
  const f = reach('local function scan() return ObjectList("Sequence 1") end\nTimer(function() scan() end, 0.1, 0)');
  assert.deepStrictEqual(f.map((x) => [x.line, x.col, x.len]), [[1, 17, 4]]);
  assert.match(f[0].message, /reaches ObjectList\(\) through scan\(\); this runs on every Timer tick/);
});

test('reachable chains of depth 1-3 name the chain', () => {
  const base = 'local function collect() return ObjectList("Group 1") end\nlocal function scan() return collect() end\nlocal function outer() return scan() end\n';
  const msg = (cb) => reach(base + `local function tick() ${cb}() end\nTimer(tick, 0.1, 0)`)[0].message;
  assert.match(msg('collect'), /^tick\(\) reaches ObjectList\(\) through collect\(\);/);
  assert.match(msg('scan'), /^tick\(\) reaches ObjectList\(\) through scan\(\) > collect\(\);/);
  assert.match(msg('outer'), /^tick\(\) reaches ObjectList\(\) through outer\(\) > scan\(\) > collect\(\);/);
  assert.match(reach('local function s() Root():Children() end\nHookObjectChange(function() s() end, Root(), nil)')[0].message, /HookObjectChange callback reaches Children\(\).*every object change/);
});

test('G4: a direct heavy call in the callback stays heavy-in-callback only', () => {
  assert.deepStrictEqual(rules('Timer(function()\n  local l = ObjectList("Sequence 1")\nend, 0.1, 0)'), ['heavy-in-callback@1']);
  assert.deepStrictEqual(rules('Timer(function()\n  local function s() return ObjectList("x") end\n  s()\nend, 0.1, 0)'), ['heavy-in-callback@1']);
});

test('no finding off the per-tick path, for one-shot code, or with ma3.lint.frameBudget off', () => {
  const scan = 'local function scan() return ObjectList("Sequence 1") end\n';
  assert.deepStrictEqual(reach(scan + 'local cache = scan()\nTimer(function() Printf(#cache) end, 0.1, 0)'), []);
  assert.deepStrictEqual(reach(scan + 'local function Main() scan() end\nreturn Main'), []);
  assert.deepStrictEqual(reach(scan + 'Timer(function() scan() end, 2, 1)'), []);
  assert.deepStrictEqual(reach(scan + 'Timer(function() scan() end, 0.1, 0)', { frameBudget: false }), []);
});

test('lenses: heavy count with the chain, or light', () => {
  const l = lenses('local function scan() return ObjectList("x") end\nlocal function tick() scan() end\nlocal function idle() end\nTimer(tick, 0.1, 0)\nTimer(idle, 1, 0)');
  assert.deepStrictEqual(l.map((x) => [x.line, x.title]), [[1, 'frame budget: 1 heavy call reachable (ObjectList via scan)'], [2, 'frame budget: light']]);
});

// Light plugins in the shapes real ones take: none may get a heavy-reachable hint.
const LIGHT = [
  'local function tick() Cmd("Go+ Sequence 1") end\nTimer(tick, 1, 0)',
  'local n = 0\nTimer(function() n = n + 1; Printf("%d", n) end, 0.5, 0)',
  'local seqs = ObjectList("Sequence 1 Thru 10")\nlocal function fade(i) seqs[i]:Set("Fader", 50) end\nTimer(function() for i = 1, #seqs do fade(i) end end, 0.1, 0)',
  'local children = Root().ShowData.DataPools[1].Groups:Children()\nlocal function label(i) return children[i].name end\nTimer(function() Printf(label(1)) end, 1, 0)',
  'local function onChange(obj) Printf(obj.name) end\nHookObjectChange(onChange, Root().ShowData.DataPools[1].Sequences, luaComponentHandle)',
  'local M = {}\nfunction M.fmt(v) return string.format("%.1f", v) end\nTimer(function() Printf(M.fmt(1)) end, 1, 0)',
  'local function Main()\n  local list = ObjectList("Group 1")\n  for _, h in ipairs(list) do Printf(h.name) end\nend\nreturn Main',
  'local pluginName, componentName, signalTable, me = select(1, ...)\nsignalTable.OnClick = function(caller) Cmd("Off Sequence 1") end\nreturn function() end',
  'local function blink(on) CmdIndirect(on and "On Group 1" or "Off Group 1") end\nlocal state = false\nTimer(function() state = not state; blink(state) end, 0.5, 0)',
  'local function clamp(v) return math.max(0, math.min(100, v)) end\nTimer(function() local v = clamp(GetVar(GlobalVars(), "x") or 0) end, 0.2, 0)',
  'local function Start()\n  gma.timer(function() gma.cmd("Go Executor 1") end, 1, 0)\nend\nreturn Start',
  'local function step() local h = gma.show.getobj.handle("Sequence 1"); return gma.show.getobj.label(h) end\ngma.timer(function() gma.echo(step()) end, 1, 0)',
  'local sorted = {}\nlocal function rebuild() sorted = ObjectList("Group 1 Thru 5") end\nlocal function Main() rebuild(); Timer(function() Printf(#sorted) end, 1, 0) end\nreturn Main',
  'local t = { update = function(self) self.v = (self.v or 0) + 1 end }\nTimer(function() t:update() end, 0.05, 0)',
  'local function tick()\n  pcall(function() Cmd("Go+") end)\n  table.sort({ 3, 1 }, function(a, b) return a < b end)\nend\nTimer(tick, 0.5, 0)',
];

test('no false positives on light plugin snippets', () => {
  LIGHT.forEach((src, i) => assert.deepStrictEqual(reach(src, { target: /gma\./.test(src) ? 'ma2' : 'ma3' }), [], `snippet ${i}`));
});
