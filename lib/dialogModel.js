'use strict';

// Dialog / menu flow designer, stage A. A flow is a set of grandMA3 MessageBox dialogs; each command button can
// lead to another dialog. This file is the model only: defaults, validation, Lua generation and reading an
// existing MessageBox({...}) call back into a dialog. No editor or console is touched here.
//
// flow   = { start: id, dialogs: [dialog, ...] }
// dialog = { id, title, message, backColor?, timeout?, autoCloseOnInput?,
//            commands: [{ value, name, next }], inputs: [{ name, value, maxTextLength? }],
//            states: [{ name, state }], selectors: [{ name, selectedValue, type, values: [{ name, value }] }] }
// command.next is a dialog id, or null / '' to end the flow there.

const MAX_DIALOGS = 40;

function newDialog(id) {
  return { id, title: 'Title', message: '', commands: [{ value: 1, name: 'OK', next: null }], inputs: [], states: [], selectors: [] };
}

function newFlow() {
  return { start: 'main', dialogs: [newDialog('main')] };
}

// A dialog id is also a Lua identifier suffix (dlg_<id>), so it keeps to letters, digits and underscore.
function cleanId(s) {
  const t = String(s == null ? '' : s).trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return t.slice(0, 32);
}

function uniqueId(flow, wanted) {
  const base = cleanId(wanted) || 'dialog';
  const used = new Set(flow.dialogs.map((d) => d.id));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

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

function luaNum(n, dflt) {
  const v = Number(n);
  return Number.isFinite(v) ? String(v) : String(dflt);
}

const isNum = (v) => v !== '' && v != null && Number.isFinite(Number(v));

// ---------------------------------------------------------------------------------------------- validation

// Returns [{ level: 'error'|'warning', dialog, message }]. Errors would make the generated code wrong or the
// console reject it; warnings are things that work but are probably not intended.
function validate(flow) {
  const out = [];
  const add = (level, dialog, message) => out.push({ level, dialog: dialog || null, message });
  const ds = flow.dialogs || [];
  if (!ds.length) add('error', null, 'The flow has no dialogs.');
  if (ds.length > MAX_DIALOGS) add('error', null, `A flow holds at most ${MAX_DIALOGS} dialogs.`);
  const ids = new Map();
  for (const d of ds) {
    if (!d.id || cleanId(d.id) !== d.id) add('error', d.id, `"${d.id}" is not a usable dialog id (letters, digits and _ only).`);
    if (ids.has(d.id)) add('error', d.id, `Two dialogs share the id "${d.id}".`);
    ids.set(d.id, d);
  }
  if (ds.length && !ids.has(flow.start)) add('error', null, `The start dialog "${flow.start}" does not exist.`);

  for (const d of ds) {
    const cmds = d.commands || [];
    if (!cmds.length) add('warning', d.id, 'No command buttons: the user has no way to close this dialog except a timeout.');
    const values = new Set();
    for (const c of cmds) {
      if (!String(c.name || '').trim()) add('error', d.id, 'A command button has no name.');
      if (!isNum(c.value) || !Number.isInteger(Number(c.value))) add('error', d.id, `Button "${c.name}" needs a whole-number value.`);
      else if (values.has(Number(c.value))) add('error', d.id, `Two buttons share the value ${c.value}; the code cannot tell them apart.`);
      else values.add(Number(c.value));
      if (c.next && !ids.has(c.next)) add('error', d.id, `Button "${c.name}" leads to "${c.next}", which does not exist.`);
    }
    const names = new Set();
    for (const group of [d.inputs || [], d.states || [], d.selectors || []]) {
      for (const f of group) {
        if (!String(f.name || '').trim()) add('error', d.id, 'An input, state or selector has no name.');
        else if (names.has(f.name)) add('error', d.id, `The name "${f.name}" is used twice in this dialog; results are looked up by name.`);
        names.add(f.name);
      }
    }
    for (const s of d.selectors || []) {
      if (!(s.values || []).length) add('error', d.id, `Selector "${s.name}" has no values.`);
      else if (!s.values.some((v) => Number(v.value) === Number(s.selectedValue))) add('warning', d.id, `Selector "${s.name}" starts on a value that is not in its list.`);
    }
    if (d.timeout != null && d.timeout !== '' && (!isNum(d.timeout) || Number(d.timeout) < 0)) add('error', d.id, 'The timeout must be a number of milliseconds.');
  }

  // Dialogs nothing leads to, from the start.
  if (ids.has(flow.start)) {
    const seen = new Set();
    const walk = (id) => {
      if (seen.has(id) || !ids.has(id)) return;
      seen.add(id);
      for (const c of ids.get(id).commands || []) if (c.next) walk(c.next);
    };
    walk(flow.start);
    for (const d of ds) if (!seen.has(d.id)) add('warning', d.id, 'Nothing leads to this dialog from the start, so it is never shown.');
  }
  return out;
}

const hasErrors = (problems) => problems.some((p) => p.level === 'error');

// ---------------------------------------------------------------------------------------------- generation

function dialogTable(d, indent) {
  const p = indent;
  const lines = [];
  const kv = (k, v) => lines.push(`${p}  ${k} = ${v},`);
  kv('title', luaStr(d.title));
  kv('message', luaStr(d.message));
  if (d.backColor) kv('backColor', luaStr(d.backColor));
  if (isNum(d.timeout) && Number(d.timeout) > 0) kv('timeout', luaNum(d.timeout, 0));
  if (d.autoCloseOnInput) kv('autoCloseOnInput', 'true');
  const list = (key, items, row) => {
    if (!items.length) return;
    lines.push(`${p}  ${key} = {`);
    items.forEach((it, i) => lines.push(`${p}    ${row(it, i + 1)},`));
    lines.push(`${p}  },`);
  };
  list('commands', d.commands || [], (c, o) => `{ value = ${luaNum(c.value, o)}, name = ${luaStr(c.name)}, order = ${o} }`);
  list('inputs', d.inputs || [], (f, o) => {
    const len = isNum(f.maxTextLength) && Number(f.maxTextLength) > 0 ? `, maxTextLength = ${luaNum(f.maxTextLength, 0)}` : '';
    return `{ name = ${luaStr(f.name)}, value = ${luaStr(f.value)}${len}, order = ${o} }`;
  });
  list('states', d.states || [], (f, o) => `{ name = ${luaStr(f.name)}, state = ${f.state ? 'true' : 'false'}, order = ${o} }`);
  list('selectors', d.selectors || [], (f, o) => {
    const vals = (f.values || []).map((v) => `[${luaStr(v.name)}] = ${luaNum(v.value, 0)}`).join(', ');
    return `{ name = ${luaStr(f.name)}, selectedValue = ${luaNum(f.selectedValue, 0)}, type = ${Number(f.type) === 1 ? 1 : 0}, values = { ${vals} }, order = ${o} }`;
  });
  return `{\n${lines.join('\n')}\n${p}}`;
}

// A single dialog as one MessageBox call (what the editor inserts when the flow has one dialog).
function generateCall(d) {
  return `MessageBox(${dialogTable(d, '')})`;
}

// A whole flow: one local function per dialog, each branching on the button pressed. The function of the start
// dialog is called at the end. Reading results (inputs, states, selectors) is left as a comment so that the
// generated code never guesses what the plugin wants to do with them.
function generate(flow) {
  const ds = flow.dialogs || [];
  if (ds.length === 1 && !(ds[0].commands || []).some((c) => c.next)) return `local r = ${generateCall(ds[0])}\n`;
  const fn = (id) => `dlg_${id}`;
  const out = [];
  out.push(`local ${ds.map((d) => fn(d.id)).join(', ')}`, '');
  for (const d of ds) {
    out.push(`${fn(d.id)} = function()`);
    out.push(`  local r = MessageBox(${dialogTable(d, '  ').replace(/^\{/, '{')})`);
    const fields = [
      ...(d.inputs || []).map((f) => `r.inputs[${luaStr(f.name)}]`),
      ...(d.states || []).map((f) => `r.states[${luaStr(f.name)}]`),
      ...(d.selectors || []).map((f) => `r.selectors[${luaStr(f.name)}]`),
    ];
    if (fields.length) out.push(`  -- ${fields.join(', ')}`);
    const branches = (d.commands || []).filter((c) => c.next);
    branches.forEach((c, i) => {
      out.push(`  ${i === 0 ? 'if' : 'elseif'} r.result == ${luaNum(c.value, 0)} then return ${fn(c.next)}()`);
    });
    if (branches.length) out.push('  end');
    out.push('end', '');
  }
  out.push(`${fn(flow.start || ds[0].id)}()`, '');
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------- reading Lua

// A small reader for Lua table constructors: strings, numbers, booleans, nil, nested tables, comments, and
// both `key = v` and `["key"] = v` fields. Anything that is not a literal (a variable, a call) makes it return
// null for the whole table, so an existing call is only imported when the designer can write it back faithfully.
function readLuaTable(src, at) {
  let i = at;
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith('--[[', i)) { const e = src.indexOf(']]', i + 4); if (e < 0) return; i = e + 2; continue; }
      if (src.startsWith('--', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
      return;
    }
  };
  const str = () => {
    const q = src[i++];
    let s = '';
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') {
        i++;
        const c = src[i++];
        if (c === 'n') s += '\n'; else if (c === 'r') s += '\r'; else if (c === 't') s += '\t';
        else if (/\d/.test(c)) { let d = c; while (d.length < 3 && /\d/.test(src[i] || '')) d += src[i++]; s += String.fromCharCode(Number(d)); }
        else s += c;
      } else s += src[i++];
    }
    if (src[i] !== q) throw new Error('unterminated string');
    i++;
    return s;
  };
  const value = () => {
    ws();
    const c = src[i];
    if (c === '"' || c === "'") return str();
    if (c === '{') return table();
    const m = /^(-?\d+(?:\.\d+)?|true|false|nil)(?![\w.])/.exec(src.slice(i, i + 40));
    if (!m) throw new Error('not a literal');
    i += m[0].length;
    if (m[0] === 'true') return true;
    if (m[0] === 'false') return false;
    if (m[0] === 'nil') return null;
    return Number(m[0]);
  };
  const table = () => {
    i++; // {
    const obj = { named: {}, list: [] };
    for (;;) {
      ws();
      if (src[i] === '}') { i++; return obj; }
      let key = null;
      const id = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(src.slice(i, i + 80));
      if (id) { key = id[1]; i += id[0].length; }
      else if (src[i] === '[') {
        i++; ws();
        key = value();
        ws();
        if (src[i] !== ']') throw new Error('bad key');
        i++; ws();
        if (src[i] !== '=') throw new Error('bad key');
        i++;
      }
      const v = value();
      if (key === null) obj.list.push(v); else obj.named[key] = v;
      ws();
      if (src[i] === ',' || src[i] === ';') i++;
      else if (src[i] !== '}') throw new Error('bad table');
    }
  };
  try {
    ws();
    if (src[i] !== '{') return null;
    const t = table();
    return { table: t, end: i };
  } catch (_) {
    return null;
  }
}

function dialogFromTable(t, id) {
  const n = t.named;
  const d = newDialog(id);
  d.title = typeof n.title === 'string' ? n.title : '';
  d.message = typeof n.message === 'string' ? n.message : '';
  if (typeof n.backColor === 'string') d.backColor = n.backColor;
  if (typeof n.timeout === 'number') d.timeout = n.timeout;
  if (n.autoCloseOnInput === true) d.autoCloseOnInput = true;
  const rows = (x) => (x && x.list ? x.list.filter((r) => r && r.named) : []);
  const byOrder = (a, b) => (Number(a.named.order) || 0) - (Number(b.named.order) || 0);
  d.commands = rows(n.commands).sort(byOrder).map((r) => ({ value: Number(r.named.value) || 0, name: String(r.named.name == null ? '' : r.named.name), next: null }));
  d.inputs = rows(n.inputs).sort(byOrder).map((r) => ({ name: String(r.named.name || ''), value: String(r.named.value == null ? '' : r.named.value), ...(r.named.maxTextLength ? { maxTextLength: Number(r.named.maxTextLength) } : {}) }));
  d.states = rows(n.states).sort(byOrder).map((r) => ({ name: String(r.named.name || ''), state: r.named.state === true }));
  d.selectors = rows(n.selectors).sort(byOrder).map((r) => ({
    name: String(r.named.name || ''),
    selectedValue: Number(r.named.selectedValue) || 0,
    type: Number(r.named.type) === 1 ? 1 : 0,
    values: Object.entries((r.named.values && r.named.values.named) || {}).map(([k, v]) => ({ name: k, value: Number(v) || 0 })),
  }));
  return d;
}

// Every MessageBox({...}) call in the text whose table is entirely literal, as dialogs (ids dialog, dialog_2 ...).
// `skipped` counts calls that were found but use variables or expressions and so cannot be imported.
function importMessageBoxes(text) {
  const flow = { start: null, dialogs: [] };
  let skipped = 0;
  const re = /\bMessageBox\s*\(\s*(?=\{)/g;
  let m;
  while ((m = re.exec(String(text)))) {
    const r = readLuaTable(text, m.index + m[0].length);
    if (!r) { skipped++; continue; }
    flow.dialogs.push(dialogFromTable(r.table, uniqueId(flow, flow.dialogs.length ? 'dialog' : 'main')));
    re.lastIndex = r.end;
  }
  flow.start = flow.dialogs.length ? flow.dialogs[0].id : null;
  return { flow, skipped };
}

module.exports = { MAX_DIALOGS, newDialog, newFlow, cleanId, uniqueId, luaStr, validate, hasErrors, generate, generateCall, importMessageBoxes, readLuaTable };
