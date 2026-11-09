'use strict';
const { maskCode } = require('./mask');

// Static frame-budget analysis of one Lua file: which functions run per tick / per event, and which heavy
// console calls they reach through local function calls. `rules` is required lazily (it requires this module).
const rules = () => require('./rules');

// Relative cost of one call, in rough units (10 = a call worth keeping out of a tick). Only gma.cmd is measured:
// about 0.46 s per call on grandMA2 onPC. A call inside a loop counts LOOP_FACTOR times per enclosing loop.
const WEIGHTS = {
  ObjectList: 10, // parses a selection and builds a handle list
  Children: 5, // :Children() builds a table of every child handle
  CmdlineChildren: 5,
  FindRecursive: 10, // walks the whole subtree
  Dump: 10, // formats every property as text
  CmdIndirectWait: 20, // waits for the command queue
  Cmd: 10, // runs a console command synchronously
  CmdIndirect: 1, // queued, returns at once
  'gma.cmd': 46, // ~0.46 s per call on onPC
};
const LOOP_FACTOR = 10;
const CMD_NAMES = new Set(['Cmd', 'CmdIndirect', 'CmdIndirectWait', 'gma.cmd']);
const REGISTER = { Timer: 'timer', HookObjectChange: 'hook', 'gma.timer': 'timer' };
const KEYWORDS = new Set(['function', 'if', 'elseif', 'while', 'for', 'until', 'return', 'and', 'or', 'not', 'in', 'local', 'then', 'do', 'else', 'end', 'repeat']);

function lineIndex(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

// Every call `name(`, `a.b.name(`, `x:name(` with its receiver chain and top-level argument ranges.
function scanCalls(code) {
  const out = [];
  const re = /([.:]\s*)?\b([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const sep = m[1] ? m[1][0] : '';
    const name = m[2];
    const nameAt = m.index + (m[1] ? m[1].length : 0);
    const before = code.slice(Math.max(0, m.index - 200), m.index);
    if (!sep && KEYWORDS.has(name)) continue;
    if (/\bfunction\s+[\w.:\s]*$/.test(before + (m[1] || ''))) continue; // a definition header
    const chain = sep ? (/((?:[A-Za-z_]\w*\s*\.\s*)*[A-Za-z_]\w*)\s*$/.exec(before) || [null, ''])[1].replace(/\s+/g, '') : '';
    const receiver = chain ? chain.split('.').pop() : '';
    let depth = 1;
    let i = m.index + m[0].length;
    const args = [];
    let argStart = i;
    for (; i < code.length && depth > 0; i++) {
      const ch = code[i];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
      else if (ch === ',' && depth === 1) {
        args.push({ text: code.slice(argStart, i).trim(), start: argStart });
        argStart = i + 1;
      }
    }
    if (depth !== 0) continue;
    const last = code.slice(argStart, i - 1);
    if (args.length || last.trim()) args.push({ text: last.trim(), start: argStart });
    const path = sep === '.' && chain ? `${chain}.${name}` : name;
    out.push({ name, sep, receiver, path, index: nameAt, args });
  }
  return out;
}

// Function units of the file and the calls between them. Anonymous functions that are neither named, nor
// registered as a callback, nor at top level (pcall(function() ... end), sort comparators) belong to the
// function around them: they run when it runs.
function buildCallGraph(src) {
  const code = maskCode(src);
  const lineAt = lineIndex(code);
  const calls = scanCalls(code);
  const funcs = rules().blocks(code).filter((b) => b.kind === 'function').sort((a, b) => a.at - b.at);
  const parentOf = (f) => {
    let best = null;
    for (const g of funcs) if (g !== f && g.start < f.at && g.end > f.at && (!best || g.start > best.start)) best = g;
    return best;
  };
  // callbacks handed to Timer / HookObjectChange / gma.timer inline
  const inlineCallback = new Map();
  for (const c of calls) {
    const kind = REGISTER[c.path];
    if (!kind || !c.args[0] || !/^function\b/.test(c.args[0].text)) continue;
    inlineCallback.set(c.args[0].start + code.slice(c.args[0].start).search(/\S/), { kind, call: c });
  }
  const nodes = [];
  const unitOf = new Map();
  for (const f of funcs) {
    const header = /^\s*([\w.:]+)\s*\(/.exec(code.slice(f.start, f.start + 200));
    const assign = /(local\s+)?([A-Za-z_][\w.]*)\s*=\s*$/.exec(code.slice(Math.max(0, f.at - 200), f.at));
    let name = null;
    let qualifier = null;
    let plain = false;
    if (header) {
      const parts = header[1].split(/[.:]/);
      name = parts.pop();
      qualifier = parts.length ? parts.join('.') : null;
      plain = !qualifier;
    } else if (assign) {
      const parts = assign[2].split('.');
      name = parts.pop();
      qualifier = parts.length ? parts.join('.') : null;
      const depth = (code.slice(0, f.at).match(/\{/g) || []).length - (code.slice(0, f.at).match(/\}/g) || []).length;
      plain = !qualifier && (!!assign[1] || depth <= 0);
      if (!qualifier && !plain) qualifier = '{}'; // a table field: its owner is unknown
    }
    const cb = inlineCallback.get(f.at);
    const parent = parentOf(f);
    if (!name && !cb && parent) continue; // merged into the parent unit
    const node = { id: nodes.length, name, qualifier, plain, at: f.at, start: f.start, end: f.end, line: lineAt(f.at), callback: cb ? cb.kind : null, calls: [], heavy: [], loops: [], cmdCalls: 0, cost: 0 };
    nodes.push(node);
    unitOf.set(f, node);
  }
  const ownerOf = (index) => {
    let best = null;
    for (const f of funcs) if (f.start < index && f.end > index && unitOf.has(f) && (!best || f.start > best.start)) best = f;
    return best ? unitOf.get(best) : null;
  };
  const byPlain = new Map();
  const byQualified = new Map();
  for (const n of nodes) {
    if (!n.name) continue;
    const map = n.plain ? byPlain : byQualified;
    if (!map.has(n.name)) map.set(n.name, []);
    map.get(n.name).push(n);
  }
  const resolve = (c) => {
    if (!c.sep) return byPlain.get(c.name) || [];
    if (c.receiver === 'gma') return [];
    return (byQualified.get(c.name) || []).filter((n) => n.qualifier === '{}' || c.receiver === 'self' || (n.qualifier || '').split('.').pop() === c.receiver);
  };
  const heavyNames = new Set(rules().HEAVY_CALLS);
  const loops = rules().blocks(code).filter((b) => b.kind === 'loop');
  const chunk = { id: -1, name: null, calls: [], heavy: [], loops: [], cmdCalls: 0, cost: 0 };
  for (const l of loops) (ownerOf(l.start) || chunk).loops.push({ line: lineAt(l.start), start: l.start, end: l.end });
  for (const c of calls) {
    const owner = ownerOf(c.index) || chunk;
    c.line = lineAt(c.index);
    c.owner = owner;
    c.mult = LOOP_FACTOR ** owner.loops.filter((l) => l.start < c.index && l.end > c.index).length;
    c.targets = resolve(c);
    const key = c.path === 'gma.cmd' ? 'gma.cmd' : c.sep === '.' ? null : c.name;
    if (key && heavyNames.has(key)) owner.heavy.push({ name: key, line: c.line, index: c.index });
    if (key && CMD_NAMES.has(key)) owner.cmdCalls++;
    if (key && WEIGHTS[key]) owner.cost += WEIGHTS[key] * c.mult;
    owner.calls.push(c);
  }
  return { code, nodes, chunk, calls, byPlain, byQualified, resolve, lineAt };
}

// Functions the console calls: per-tick/per-event callbacks (Timer, HookObjectChange, gma.timer), grandMA3 UI
// signal handlers, and the plugin functions the file returns (run once per start).
function entryPoints(src, graph = buildCallGraph(src)) {
  const { code, nodes, calls } = graph;
  const out = [];
  const add = (node, kind, perTick, call) => node && !out.some((e) => e.node === node && e.kind === kind) && out.push({ node, kind, perTick, call, line: node.line });
  for (const c of calls) {
    const kind = REGISTER[c.path];
    if (!kind || !c.args[0]) continue;
    const count = c.args[2] && c.args[2].text;
    const perTick = count !== '1'; // a literal count of 1 is a one-shot delay
    const first = c.args[0].text;
    if (/^function\b/.test(first)) add(nodes.find((n) => n.at === c.args[0].start + code.slice(c.args[0].start).search(/\S/)), kind, perTick, c);
    else if (/^[A-Za-z_][\w.:]*$/.test(first)) {
      const parts = first.split(/[.:]/);
      const name = parts.pop();
      const targets = parts.length ? graph.resolve({ name, sep: '.', receiver: parts.pop() }) : graph.byPlain.get(name) || [];
      for (const t of targets) add(t, kind, perTick, c);
    }
  }
  const sigVars = new Set(['signalTable']);
  for (const m of code.matchAll(/\blocal\s+\w+\s*,\s*\w+\s*,\s*([A-Za-z_]\w*)\s*(?:,[\w\s,]*)?=\s*(?:select\s*\(\s*1\s*,\s*)?\.\.\./g)) sigVars.add(m[1]);
  for (const n of nodes) if (n.qualifier && sigVars.has(n.qualifier)) add(n, 'signal', false, null);
  for (const m of code.matchAll(/(^|\n)[ \t]*return[ \t]+([A-Za-z_]\w*(?:[ \t]*,[ \t]*[A-Za-z_]\w*)*)[ \t]*(?=\n|$)/g)) {
    const at = m.index + m[1].length;
    if (nodes.some((n) => n.start < at && n.end > at)) continue; // a return inside a function
    for (const name of m[2].split(',').map((s) => s.trim())) for (const t of graph.byPlain.get(name) || []) add(t, 'plugin', false, null);
  }
  return out.sort((a, b) => a.line - b.line);
}

// Shortest chains from a call site to heavy calls, through local functions; heavy calls inside `skip` (the
// caller's own range, already a direct finding) are left out. Cycle-safe.
function chainsFrom(targets, skip) {
  const found = [];
  const seen = new Set();
  const queue = targets.map((t) => ({ node: t, via: [t] }));
  targets.forEach((t) => seen.add(t));
  while (queue.length) {
    const { node, via } = queue.shift();
    for (const h of node.heavy) {
      if (skip && h.index > skip.start && h.index < skip.end) continue;
      found.push({ via: via.filter((n) => n.name).map((n) => n.name), call: h.name, line: h.line, index: h.index });
    }
    for (const c of node.calls) for (const t of c.targets) if (!seen.has(t)) seen.add(t) && queue.push({ node: t, via: via.concat(t) });
  }
  const unique = new Map();
  for (const f of found) if (!unique.has(f.index)) unique.set(f.index, f);
  return [...unique.values()];
}

// Per function: direct heavy calls, loops, console command count, weighted cost (local, and with everything it
// calls) and the heavy calls it reaches through other local functions.
function costOf(src, graph = buildCallGraph(src)) {
  const memo = new Map();
  const total = (n, stack = new Set()) => {
    if (memo.has(n)) return memo.get(n);
    if (stack.has(n)) return 0;
    stack.add(n);
    let sum = n.cost;
    for (const c of n.calls) for (const t of c.targets) sum += c.mult * total(t, stack);
    stack.delete(n);
    memo.set(n, sum);
    return sum;
  };
  return graph.nodes.map((n) => ({
    name: n.name,
    line: n.line,
    heavy: n.heavy.map(({ name, line }) => ({ name, line })),
    loops: n.loops.map((l) => l.line),
    cmdCalls: n.cmdCalls,
    cost: n.cost,
    totalCost: total(n),
    reachableHeavy: chainsFrom(n.calls.flatMap((c) => c.targets), n).map(({ via, call, line }) => ({ via, call, line })),
  }));
}

// heavy-reachable findings: call sites in a per-tick callback that reach a heavy call through local functions.
function reachableFindings(src, graph = buildCallGraph(src)) {
  const out = [];
  const done = new Set();
  for (const e of entryPoints(src, graph)) {
    if (!e.perTick) continue;
    const n = e.node;
    for (const c of graph.calls) {
      if (c.index <= n.start || c.index >= n.end || !c.targets.length || done.has(c.index)) continue;
      const chains = chainsFrom(c.targets, n).sort((a, b) => a.via.length - b.via.length);
      if (!chains.length) continue;
      done.add(c.index);
      const [first] = chains;
      const who = n.name ? `${n.name}()` : `The ${e.kind === 'hook' ? 'HookObjectChange' : 'Timer'} callback`;
      const when = e.kind === 'hook' ? 'object change' : 'Timer tick';
      const more = chains.length > 1 ? ` (and ${chains.length - 1} more heavy call${chains.length > 2 ? 's' : ''})` : '';
      out.push({
        index: c.index,
        len: c.name.length,
        message: `${who} reaches ${first.call}() through ${first.via.map((v) => `${v}()`).join(' > ')}${more}; this runs on every ${when}. Precompute it outside the callback.`,
      });
    }
  }
  return out;
}

// CodeLens lines above each entry point (static estimate; the live profiler is stage 2, ma3.profileFunction).
function lenses(src, graph = buildCallGraph(src)) {
  const out = [];
  for (const e of entryPoints(src, graph)) {
    if (out.some((l) => l.line === e.line)) continue;
    const n = e.node;
    const direct = n.heavy.map((h) => ({ via: [], call: h.name }));
    const all = direct.concat(chainsFrom(n.calls.flatMap((c) => c.targets), n));
    const first = all[0];
    const title = all.length
      ? `frame budget: ${all.length} heavy call${all.length === 1 ? '' : 's'} reachable (${first.call}${first.via.length ? ` via ${first.via.join(' > ')}` : ''})`
      : 'frame budget: light';
    out.push({ line: e.line, title, name: n.name, kind: e.kind, heavy: all.length });
  }
  return out;
}

module.exports = { WEIGHTS, LOOP_FACTOR, buildCallGraph, entryPoints, costOf, reachableFindings, lenses, scanCalls };
