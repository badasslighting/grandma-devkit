'use strict';
const { maskCode } = require('./mask');

// Static checks beyond the blocking-loop one. Every finding is {line, message, severity, rule} with a
// 0-based line and severity 'warning' or 'hint'. They lean towards missing a problem over crying wolf:
// a rule only fires when the code is clearly the kind of thing it describes.

const KEYWORDS = new Set(['function', 'if', 'elseif', 'while', 'for', 'until', 'return', 'and', 'or', 'not', 'in', 'local', 'then', 'do', 'else', 'end', 'repeat']);
// Methods of Lua strings; `s:find()` must not be mistaken for a misspelt object `Find`.
const STRING_METHODS = new Set(['byte', 'char', 'dump', 'find', 'format', 'gmatch', 'gsub', 'len', 'lower', 'match', 'rep', 'reverse', 'sub', 'upper']);
const LUA_GLOBALS = new Set(['assert', 'collectgarbage', 'dofile', 'error', 'getmetatable', 'ipairs', 'load', 'loadstring', 'next', 'pairs', 'pcall', 'print', 'rawequal', 'rawget', 'rawset', 'require', 'select', 'setmetatable', 'tonumber', 'tostring', 'type', 'unpack', 'xpcall']);
// Calls that are expensive when they run on every timer tick or object change.
const HEAVY_CALLS = ['ObjectList', 'CmdIndirectWait', 'Children', 'CmdlineChildren', 'FindRecursive', 'Dump'];

const lineAt = (code, index) => code.slice(0, index).split('\n').length - 1;

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

function closest(name, names) {
  const low = name.toLowerCase();
  let best = null;
  let bestD = Infinity;
  for (const n of names) {
    const d = n.toLowerCase() === low ? 0 : distance(low, n.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  const limit = name.length >= 8 ? 2 : name.length >= 5 ? 1 : 0;
  return bestD <= limit ? best : null;
}

// Every block with its kind ('function' | 'loop' | 'block') and the code range it covers.
function blocks(code) {
  const out = [];
  const stack = [];
  const re = /\b(function|if|do|repeat|end|until|while|for)\b/g;
  let pendingLoop = false;
  let m;
  while ((m = re.exec(code))) {
    const w = m[1];
    if (w === 'for' || w === 'while') pendingLoop = true;
    else if (w === 'do') {
      stack.push({ kind: pendingLoop ? 'loop' : 'block', start: m.index + 2 });
      pendingLoop = false;
    } else if (w === 'repeat') stack.push({ kind: 'loop', start: m.index + 6 });
    else if (w === 'function') stack.push({ kind: 'function', start: m.index + 8, at: m.index });
    else if (w === 'if') stack.push({ kind: 'block', start: m.index + 2 });
    else {
      const open = stack.pop();
      if (open) out.push({ ...open, end: m.index });
    }
  }
  return out;
}

// Calls `Name(args)` or `:Name(args)` with their top-level arguments.
function findCalls(code) {
  const calls = [];
  const re = /(:\s*)?\b([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const method = !!m[1];
    const name = m[2];
    const start = m.index + m[0].length;
    const before = code.slice(0, m.index);
    if (!method) {
      if (KEYWORDS.has(name)) continue;
      if (/[.:]\s*$/.test(before)) continue; // a.b(...) or the tail of obj:method
      if (/\bfunction\s+$/.test(before)) continue; // definition, not a call
    }
    let depth = 1;
    let i = start;
    const args = [];
    let argStart = start;
    for (; i < code.length && depth > 0; i++) {
      const ch = code[i];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
      else if (ch === ',' && depth === 1) {
        args.push(code.slice(argStart, i));
        argStart = i + 1;
      }
    }
    if (depth !== 0) continue;
    const last = code.slice(argStart, i - 1);
    if (args.length || last.trim()) args.push(last);
    calls.push({ name, method, args: args.map((a) => a.trim()), index: m.index + (m[1] ? m[1].length : 0), end: i });
  }
  return calls;
}

function declaredNames(code) {
  const names = new Set();
  const add = (list) => list.split(',').forEach((n) => /^\s*[A-Za-z_]\w*\s*$/.test(n) && names.add(n.trim()));
  for (const m of code.matchAll(/\blocal\s+function\s+([A-Za-z_]\w*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\blocal\s+([\w\s,]+?)\s*(?:=|\n|$)/g)) add(m[1]);
  for (const m of code.matchAll(/\bfunction\s+([\w.:]+)/g)) {
    for (const part of m[1].split(/[.:]/)) names.add(part);
  }
  for (const m of code.matchAll(/\bfunction\s*[\w.:]*\s*\(([^)]*)\)/g)) add(m[1]);
  for (const m of code.matchAll(/\bfor\s+([\w\s,]+?)\s*(?:=|\bin\b)/g)) add(m[1]);
  return names;
}

function braceDepthAt(code) {
  const depth = new Int32Array(code.length + 1);
  let d = 0;
  for (let i = 0; i < code.length; i++) {
    depth[i] = d;
    if (code[i] === '{') d++;
    else if (code[i] === '}') d = Math.max(0, d - 1);
  }
  depth[code.length] = d;
  return depth;
}

function fieldNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/\.\s*([A-Za-z_]\w*)\s*=(?!=)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\b([A-Za-z_]\w*)\s*=(?!=)/g)) names.add(m[1]);
  return names;
}

function lintRules(src, api, options = {}) {
  const code = maskCode(src);
  const findings = [];
  const push = (index, rule, message, severity = 'warning') => findings.push({ line: lineAt(code, index), rule, message, severity });
  const calls = findCalls(code);
  const declared = declaredNames(code);
  const fields = fieldNames(code);
  const globalNames = api ? new Map(api.global.map((f) => [f.name, f])) : new Map();
  const objectNames = api ? new Map(api.object.map((f) => [f.name, f])) : new Map();
  const blk = blocks(code);

  // -- unknown function / missing arguments
  if (api) {
    for (const c of calls) {
      if (c.method) {
        if (STRING_METHODS.has(c.name) || declared.has(c.name) || fields.has(c.name)) continue;
        const fn = objectNames.get(c.name);
        if (!fn) {
          const hit = closest(c.name, objectNames.keys());
          if (hit) push(c.index, 'unknown-api', `Unknown object function "${c.name}". Did you mean "${hit}"?`);
          continue;
        }
        const need = fn.params.slice(1).filter((p) => !p.optional && !/\.\.\./.test(p.label)).length;
        // Only a call with no arguments at all is certain to be wrong: HelpLua marks some parameters
        // required that the console accepts without (e.g. ToAddr's with_name).
        if (need > 0 && c.args.length === 0) push(c.index, 'missing-args', `${c.name} needs arguments after the handle but is called with none.`);
      } else {
        if (declared.has(c.name) || fields.has(c.name) || LUA_GLOBALS.has(c.name) || !/^[A-Za-z]/.test(c.name)) continue;
        const fn = globalNames.get(c.name);
        if (!fn) {
          if (/^[a-z][a-z0-9_]*$/.test(c.name) && !/[A-Z]/.test(closest(c.name, globalNames.keys()) || '')) continue; // plain Lua / user functions
          const hit = closest(c.name, globalNames.keys());
          if (hit && hit !== c.name) push(c.index, 'unknown-api', `Unknown function "${c.name}". Did you mean "${hit}"?`);
          continue;
        }
        const need = fn.params.filter((p) => !p.optional && !/\.\.\./.test(p.label)).length;
        if (need > 0 && c.args.length === 0) push(c.index, 'missing-args', `${c.name} needs ${need} argument${need === 1 ? '' : 's'} but is called with none.`);
      }
    }
  }

  // -- Cmd inside a loop
  const loops = blk.filter((b) => b.kind === 'loop');
  for (const c of calls) {
    if (c.method || (c.name !== 'Cmd' && c.name !== 'CmdIndirect' && c.name !== 'CmdIndirectWait')) continue;
    if (loops.some((l) => c.index > l.start && c.index < l.end))
      push(c.index, 'cmd-in-loop', `${c.name}() inside a loop runs one console command per iteration; build a single command string where you can.`);
  }

  // -- heavy work inside Timer / HookObjectChange callbacks
  const funcs = blk.filter((b) => b.kind === 'function');
  const named = new Map();
  for (const f of funcs) {
    const header = /^\s*([\w.:]+)\s*\(/.exec(code.slice(f.start));
    if (header) named.set(header[1].split(/[.:]/).pop(), f);
  }
  for (const c of calls) {
    if (c.method || (c.name !== 'Timer' && c.name !== 'HookObjectChange')) continue;
    const first = c.args[0] || '';
    let body = null;
    if (/^function\b/.test(first)) {
      const at = code.indexOf('function', c.index);
      body = funcs.find((f) => f.at === at);
    }
    else if (/^[A-Za-z_]\w*$/.test(first) && named.has(first)) body = named.get(first);
    if (!body) continue;
    for (const h of calls) {
      if (h.index <= body.start || h.index >= body.end) continue;
      if (!HEAVY_CALLS.includes(h.name)) continue;
      push(h.index, 'heavy-in-callback', `${h.name}() inside a ${c.name} callback runs on every tick; precompute it outside the callback and keep the callback light.`);
    }
  }

  // -- leaked globals (opt-in: plugins often share state through a global on purpose)
  if (!options.globals) return findings.sort((a, b) => a.line - b.line);
  const depth = braceDepthAt(code);
  const globals = new Set(['_G', '_ENV', '_VERSION']);
  const re = /(^|\n)[ \t]*([A-Za-z_]\w*)[ \t]*=(?!=)/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(code))) {
    const name = m[2];
    const index = m.index + m[1].length;
    if (depth[index] !== 0 || globals.has(name) || KEYWORDS.has(name) || declared.has(name) || seen.has(name)) continue;
    seen.add(name);
    push(index, 'global-assign', `"${name}" is assigned without "local", so it becomes a global shared with every other plugin.`, 'hint');
  }

  return findings.sort((a, b) => a.line - b.line);
}

module.exports = { lintRules, findCalls, blocks, closest, distance, declaredNames, HEAVY_CALLS };
