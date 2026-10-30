'use strict';
const COMMANDS = require('../data/commands.json');
const { parseBracket } = require('./conditions');
const { quoteMask } = require('./quoteMask');

// Console variables, as far as they were checked on onPC (grandMA2 3.9.61.1, grandMA3 2.5.1.0).
//  - A variable is written `$name` in a command line or macro line, outside quotes. Inside quotes grandMA3
//    drops the `$` ("x$a" becomes "xa" ... the name stays) and grandMA2 leaves it, which is an illegal name.
//  - grandMA2: `SetVar $x = v` is global, `SetUserVar $x = v` per user; names are case-insensitive. Lua reads them
//    with gma.show.getvar('x') / gma.user.getvar('x') (no `$`; each sees only its own scope) and always gets text.
//  - grandMA3: `SetUserVariable "x" v` / `SetGlobalVariable "x" v`, or Lua SetVar(UserVars(), 'x', v); names are
//    case-sensitive; GetVar returns a number or text as stored. The tables can't be listed (Count is 0).
//  - A value written without quotes is parsed as part of a command: a keyword or several words is not stored (grandMA2)
//    or becomes something else (grandMA3). Quote text values.
//  - grandMA2 `[a==b] cmd`: the first comparison only, operators == > < <= >= (and != acting as ==), numbers
//    compared as numbers when both are, otherwise as case-sensitive text; the last [..] on a line is the one that counts.

const MA2_SYSTEM_VARS = {
  HOSTSUBTYPE: 'Kind of host, for example onPC.',
  HOSTTYPE: 'Console, or the kind of unit the software runs on.',
  TIME: 'Current time.',
  DATE: 'Current date.',
  PRESET: 'Selected preset type.',
  USER: 'Name of the logged-in user.',
  USERPROFILE: 'Name of the active user profile.',
  USERRIGHTS: 'Rights of the logged-in user (for example Admin).',
  HOSTHARDWARE: 'Hardware type of the host (for example GMA2).',
  ATTRIBUTE: 'Selected attribute.',
  OS: 'Operating system.',
  HOSTNAME: 'Name of the computer.',
  HOSTSTATUS: 'Session role (for example Master 1).',
  HOSTIP: 'IP address of the host.',
  PATH: 'Installation data folder.',
  PLUGINPATH: 'Folder the console loads plugins from.',
  TEMPPATH: 'Temporary files folder.',
  VERSION: 'Software version.',
  SELECTEDEXEC: 'Selected executor (page.number).',
  FEATURE: 'Selected feature.',
  FADERPAGE: 'Current fader page.',
  BUTTONPAGE: 'Current button page.',
  CHANNELPAGE: 'Current channel page.',
  SELECTEDEXECCUE: 'Current cue of the selected executor.',
  SELECTEDFIXTURESCOUNT: 'How many fixtures are selected.',
  SHOWFILE: 'Name of the loaded show.',
};
const isSystemVar = (name, target) => target !== 'ma3' && Object.prototype.hasOwnProperty.call(MA2_SYSTEM_VARS, String(name).toUpperCase());

// grandMA2 names are not case-sensitive, grandMA3 names are.
const keyOf = (name, target) => (target === 'ma3' ? String(name) : String(name).toUpperCase());

const NAME = '[A-Za-z_]\\w*';

// ---- text helpers --------------------------------------------------------------------------------------

// The `;`-separated commands of one line (not counting a `;` inside quotes): [{start, end, text}].
function splitChain(text) {
  const mask = quoteMask(text);
  const parts = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || (text[i] === ';' && !mask[i])) {
      parts.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  return parts;
}

const unquoteValue = (v) => {
  const m = /^\\?"([\s\S]*?)\\?"$/.exec(v.trim());
  return m ? m[1] : v.trim();
};
const isNumber = (s) => /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(String(s).trim());

// ---- what a command line says about variables --------------------------------------------------------------

const KEYWORDS = new Set([...COMMANDS.verb, ...COMMANDS.object, ...COMMANDS.modifier].map(([n]) => n.toLowerCase()));

// The part of a command after any leading [conditions]: {offset, text}. Every closed [..] at the start is skipped.
function afterBrackets(part) {
  let offset = 0;
  let text = part;
  for (let guard = 0; guard < 20; guard++) {
    const b = parseBracket(text);
    if (!b || b.end < 0) break;
    offset += b.end + 1;
    text = text.slice(b.end + 1);
  }
  return { offset, text };
}

const MA2_DEF = new RegExp(`^(\\s*)(SetVar|SetUserVar|AddVar|AddUserVar)(\\s+)\\$(${NAME})(\\s*=?\\s*)([\\s\\S]*?)\\s*$`, 'i');
const MA3_DEF = new RegExp(`^(\\s*)(SetUserVariable|SetGlobalVariable|AddUserVariable|AddGlobalVariable)(\\s+)(\\\\?"?)(${NAME})(\\\\?"?)(\\s*)([\\s\\S]*?)\\s*$`, 'i');

// Every variable occurrence in one console command string. Offsets are relative to `text`.
// -> {defs, refs, quoted}; a def is {name, scope, op, start (of the name), len, valueText, valueStart, part},
//    a ref or quoted ref is {name, start (of the name, after the $), len, part, inCondition}.
function scanCommand(text, target) {
  const defs = [];
  const refs = [];
  const quoted = [];
  const mask = quoteMask(text);
  const parts = splitChain(text);
  const defNameStarts = new Set();
  parts.forEach((p, partIndex) => {
    const { offset, text: body } = afterBrackets(p.text);
    const base = p.start + offset;
    let m;
    if (target !== 'ma3' && (m = MA2_DEF.exec(body))) {
      const nameStart = base + m[1].length + m[2].length + m[3].length + 1;
      const value = m[6];
      const valueStart = base + m[1].length + m[2].length + m[3].length + 1 + m[4].length + m[5].length;
      defNameStarts.add(nameStart);
      defs.push({
        name: m[4],
        scope: /user/i.test(m[2]) ? 'user' : 'global',
        op: /^add/i.test(m[2]) ? 'add' : value === '' ? 'clear' : 'set',
        start: nameStart,
        len: m[4].length,
        form: 'dollar',
        valueText: value,
        valueStart,
        part: partIndex,
      });
    } else if (target !== 'ma2' && (m = MA3_DEF.exec(body))) {
      const nameStart = base + m[1].length + m[2].length + m[3].length + m[4].length;
      defs.push({
        name: m[5],
        scope: /global/i.test(m[2]) ? 'global' : 'user',
        op: /^add/i.test(m[2]) ? 'add' : 'set',
        start: nameStart,
        len: m[5].length,
        form: 'name',
        valueText: m[8],
        valueStart: nameStart + m[5].length + m[6].length + m[7].length,
        part: partIndex,
      });
    }
  });
  const partOf = (i) => parts.findIndex((p) => i >= p.start && i <= p.end);
  const bracketRanges = [];
  for (const p of parts) {
    let off = 0;
    let rest = p.text;
    for (let guard = 0; guard < 20; guard++) {
      const b = parseBracket(rest);
      if (!b) break;
      bracketRanges.push([p.start + off + b.start, p.start + off + (b.end < 0 ? rest.length : b.end)]);
      if (b.end < 0) break;
      off += b.end + 1;
      rest = rest.slice(b.end + 1);
    }
  }
  const inCondition = (i) => bracketRanges.some(([a, z]) => i >= a && i <= z);
  for (const m of text.matchAll(new RegExp(`\\$(${NAME})`, 'g'))) {
    const start = m.index + 1;
    if (defNameStarts.has(start)) continue;
    const occ = { name: m[1], start, len: m[1].length, form: 'dollar', part: partOf(m.index), inCondition: inCondition(m.index) };
    (mask[m.index] ? quoted : refs).push(occ);
  }
  return { defs, refs, quoted };
}

// ---- Lua: the API calls that read and write variables ---------------------------------------------------

// The source with comments blanked and strings left alone (offsets stay valid).
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '-' && src[i + 1] === '-') {
      const long = /^--\[(=*)\[/.exec(src.slice(i, i + 40));
      let end;
      if (long) {
        const close = src.indexOf(`]${long[1]}]`, i + long[0].length);
        end = close < 0 ? src.length : close + long[1].length + 2;
      } else {
        const nl = src.indexOf('\n', i);
        end = nl < 0 ? src.length : nl;
      }
      for (let k = i; k < end; k++) if (out[k] !== '\n') out[k] = ' ';
      i = end;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      i = j + 1;
    } else if (ch === '[' && /^\[(=*)\[/.test(src.slice(i, i + 40))) {
      const open = /^\[(=*)\[/.exec(src.slice(i, i + 40));
      const close = src.indexOf(`]${open[1]}]`, i + open[0].length);
      i = close < 0 ? src.length : close + open[1].length + 2;
    } else i++;
  }
  return out.join('');
}

const MA3_VAR_CALL = new RegExp(`\\b(SetVar|GetVar|DelVar)\\s*\\(\\s*(?:(GlobalVars|UserVars|PluginVars|AddonVars)\\s*\\(([^()]*)\\)|(${NAME}))\\s*,\\s*(["'])((?:\\\\.|(?!\\5).)*?)\\5`, 'g');
const MA2_VAR_CALL = /\bgma\.(show|user)\.(getvar|setvar)\s*\(\s*(["'])((?:\\.|(?!\3).)*?)\3/g;

// Variable occurrences in a Lua file: the API calls with a literal name, and the `$name` words inside the command
// strings of Cmd() / gma.cmd(). -> flat list, offsets absolute.
// {name, kind: 'def'|'ref'|'get'|'del'|'qref', scope, form: 'dollar'|'name', start, len, dollarInName?, valueText?, ...}
function scanLua(src, target, commandStrings) {
  const clean = stripComments(src);
  const out = [];
  for (const m of clean.matchAll(MA3_VAR_CALL)) {
    const nameEnd = m.index + m[0].length - 1;
    const raw = m[6];
    const dollar = raw.startsWith('$');
    out.push({
      name: dollar ? raw.slice(1) : raw,
      kind: m[1] === 'SetVar' ? 'def' : m[1] === 'DelVar' ? 'del' : 'get',
      scope: m[2] ? { GlobalVars: 'global', UserVars: 'user', PluginVars: 'plugin', AddonVars: 'addon' }[m[2]] : 'unknown',
      form: 'name',
      api: 'ma3',
      start: nameEnd - raw.length + (dollar ? 1 : 0),
      len: raw.length - (dollar ? 1 : 0),
      dollarInName: dollar,
    });
  }
  for (const m of clean.matchAll(MA2_VAR_CALL)) {
    const nameEnd = m.index + m[0].length - 1;
    const raw = m[4];
    const dollar = raw.startsWith('$');
    out.push({
      name: dollar ? raw.slice(1) : raw,
      kind: m[2] === 'setvar' ? 'def' : 'get',
      scope: m[1] === 'show' ? 'global' : 'user',
      form: 'name',
      api: 'ma2',
      start: nameEnd - raw.length + (dollar ? 1 : 0),
      len: raw.length - (dollar ? 1 : 0),
      dollarInName: dollar,
    });
  }
  for (const s of commandStrings(src)) {
    if (s.quote !== '"' && s.quote !== "'") continue;
    out.push(...flattenCommand(scanCommand(s.text, target), s.offset, 'command'));
  }
  return out.sort((a, b) => a.start - b.start);
}

// A scanCommand() result as flat occurrences shifted by `offset`; `chain` ties together what one command line holds.
function flattenCommand(scan, offset, api, chain = offset) {
  const out = [];
  for (const d of scan.defs) out.push({ ...d, kind: d.op === 'clear' ? 'del' : 'def', start: d.start + offset, valueStart: d.valueStart + offset, api, chain });
  for (const r of scan.refs) out.push({ ...r, kind: 'ref', scope: 'unknown', start: r.start + offset, api, chain });
  for (const r of scan.quoted) out.push({ ...r, kind: 'qref', scope: 'unknown', start: r.start + offset, api, chain });
  return out;
}

// ---- lint -------------------------------------------------------------------------------------------------

// Findings for the occurrences of one document: [{offset, len, rule, message, severity, fix?}].
//  ctx.target: 'ma2' | 'ma3';  ctx.known: Map(key -> [{scope, name}]) of every definition in the workspace.
function lintVariables(occ, ctx) {
  const target = ctx.target === 'ma3' ? 'ma3' : 'ma2';
  const known = ctx.known || new Map();
  const out = [];
  const add = (o, rule, message, severity = 'warning', fix) => out.push({ offset: o.start, len: o.len, rule, message, severity, ...(fix ? { fix } : {}) });
  const defsOf = (name) => known.get(keyOf(name, target)) || [];
  const exactDef = (name) => defsOf(name).some((d) => d.name === name);

  for (const o of occ) {
    if (o.dollarInName) add(o, 'var-dollar-in-api', `${o.api === 'ma2' ? 'gma.show.getvar / gma.user.getvar' : 'The variable'} takes the name without the "$": "${o.name}". With the $ it reads nothing.`, 'warning', { kind: 'replace', text: o.name, from: o.start - 1, to: o.start + o.len });
    if (o.kind === 'qref') {
      add(o, 'var-in-quotes', target === 'ma3' ? `A variable inside "quotes" is not expanded on grandMA3 (the "$" is just dropped, leaving "${o.name}").` : `A variable inside "quotes" is not expanded on grandMA2 (a name with "$" in it is an illegal name). Put $${o.name} outside the quotes.`);
    }
    if (o.kind === 'ref') {
      const sys = isSystemVar(o.name, target);
      if (!sys && !defsOf(o.name).length && ctx.known) {
        const near = target === 'ma3' ? [...known.values()].flat().find((d) => d.name.toLowerCase() === o.name.toLowerCase()) : null;
        if (near) add(o, 'var-case', `grandMA3 variable names are case-sensitive: this is not "${near.name}".`, 'warning', { kind: 'replace', text: near.name });
        else add(o, 'var-undefined', `$${o.name} is not set anywhere in this workspace${target === 'ma2' ? ' (and is not a system variable)' : ''}. An unset variable ${target === 'ma2' ? 'stops the command (Error #54) and makes every comparison false' : 'stops the command from running'}.`, 'hint');
      }
    }
    if (o.kind === 'get' && !o.dollarInName && ctx.known && o.scope !== 'plugin' && o.scope !== 'addon') {
      if (target === 'ma3' && !exactDef(o.name)) {
        const near = [...known.values()].flat().find((d) => d.name.toLowerCase() === o.name.toLowerCase() && d.name !== o.name);
        if (near) add(o, 'var-case', `grandMA3 variable names are case-sensitive: this is not "${near.name}".`, 'warning', { kind: 'replace', text: near.name });
      }
      if (o.api === 'ma2' && o.scope === 'global' && !isSystemVar(o.name, 'ma2')) {
        const defs = defsOf(o.name);
        if (defs.length && defs.every((d) => d.scope === 'user')) add(o, 'var-scope', `${o.name} is only set as a user variable (SetUserVar); gma.show.getvar cannot see it. Use gma.user.getvar.`);
      }
      if (o.api === 'ma2' && o.scope === 'user') {
        const defs = defsOf(o.name);
        if (defs.length && defs.every((d) => d.scope === 'global')) add(o, 'var-scope', `${o.name} is only set as a global variable (SetVar); gma.user.getvar cannot see it. Use gma.show.getvar.`);
      }
    }
    if (o.kind === 'def' && o.valueText !== undefined && o.op !== 'clear') {
      const v = o.valueText.trim();
      const bare = v.replace(/^\\?"|\\?"$/g, '');
      const quoted = v !== bare || /^\\?"/.test(v);
      if (!quoted && v) {
        const words = v.split(/\s+/);
        if (words.length > 1) add({ start: o.valueStart, len: v.length }, 'var-value-unquoted', `A value with several words must be in quotes ("${v}"): without them ${target === 'ma3' ? 'only part of it is read as a value' : 'grandMA2 does not store it'}.`, 'warning', { kind: 'replace', text: `"${v.replace(/"/g, '')}"` });
        else if (KEYWORDS.has(v.toLowerCase()) || /[\]\[]/.test(v)) add({ start: o.valueStart, len: v.length }, 'var-value-unquoted', `"${v}" is read as a command word or contains a bracket, so it is not stored as text. Put it in quotes.`, 'warning', { kind: 'replace', text: `"${v}"` });
        else if (/^[A-Za-z]{1,4}$/.test(v)) add({ start: o.valueStart, len: v.length }, 'var-value-unquoted', `A short word can be a keyword abbreviation ("${v}" may be read as a command word, like COL for Color). Quote text values.`, 'hint', { kind: 'replace', text: `"${v}"` });
      }
    }
  }

  // grandMA2 `;` chains: every $name is replaced before the first command runs, so a variable set earlier in the
  // same chain still holds its old value (or none).
  if (target === 'ma2') {
    const byLine = new Map();
    for (const o of occ) if (o.api === 'command' || o.api === undefined) (byLine.get(o.chain) || byLine.set(o.chain, []).get(o.chain)).push(o);
    for (const list of byLine.values()) {
      const setAt = new Map();
      for (const o of list) if (o.kind === 'def' && o.part !== undefined) setAt.set(keyOf(o.name, 'ma2'), Math.min(setAt.has(keyOf(o.name, 'ma2')) ? setAt.get(keyOf(o.name, 'ma2')) : 99, o.part));
      for (const o of list) if (o.kind === 'ref' && setAt.has(keyOf(o.name, 'ma2')) && o.part > setAt.get(keyOf(o.name, 'ma2'))) add(o, 'var-chain', `$${o.name} is set earlier in this ";" chain, but grandMA2 replaces every $name before the chain runs, so this uses the old value. Send the SetVar as its own command line.`);
    }
  }

  // The same name set both as a user and a global variable.
  const seen = new Map();
  for (const o of occ) if (o.kind === 'def' && (o.scope === 'user' || o.scope === 'global')) (seen.get(keyOf(o.name, target)) || seen.set(keyOf(o.name, target), new Set()).get(keyOf(o.name, target))).add(o.scope);
  for (const o of occ) {
    if (o.kind !== 'def') continue;
    const scopes = new Set([...(seen.get(keyOf(o.name, target)) || [])]);
    for (const d of defsOf(o.name)) if (d.scope === 'user' || d.scope === 'global') scopes.add(d.scope);
    if (scopes.size > 1 && (o.scope === 'user' || o.scope === 'global')) add(o, 'var-shadow', `${o.name} is set as both a user and a global variable; $${o.name} reads the user one (checked on both consoles), so the global one is hidden.`, 'hint');
  }
  return out;
}

// ---- grandMA2 conditions: what a [condition] does (so a line can be previewed) ----------------------------------

// First comparison of a condition, the way the console reads it. Anything else in the brackets is ignored.
const COMPARISON = new RegExp(`^\\s*(\\$${NAME}|"[^"]*"|[^\\s=<>!~\\]\\[()$"]+)\\s*(==|!=|<=|>=|<|>)\\s*(\\$${NAME}|"[^"]*"|[^\\s&|\\]]+)`);

function compareValues(a, op, b) {
  const both = isNumber(a) && isNumber(b);
  const x = both ? Number(a) : String(a);
  const y = both ? Number(b) : String(b);
  if (op === '==' || op === '!=') return x === y; // != behaves like == on the console
  if (op === '<') return x < y;
  if (op === '>') return x > y;
  if (op === '<=') return x <= y;
  return x >= y;
}

// vars: Map(KEY -> value) with upper-case keys (see keyOf). An unset variable makes every comparison false.
function evalCondition(expr, vars) {
  const m = COMPARISON.exec(expr);
  if (!m) return false;
  const operand = (t) => {
    if (t.startsWith('$')) return vars.has(keyOf(t.slice(1), 'ma2')) ? String(vars.get(keyOf(t.slice(1), 'ma2'))) : undefined;
    return unquoteValue(t);
  };
  if (/^[>=]/.test(m[3])) return false;
  const l = operand(m[1]);
  const r = operand(m[3]);
  if (l === undefined || r === undefined) return false;
  return compareValues(l, m[2], r);
}

// A grandMA2 line: the condition at its end decides, and covers the whole `;` chain. The bracket ends at the first "]"
// even inside quotes. -> {runs, command, conditions}
function evalLine(text, vars) {
  let rest = text;
  const conditions = [];
  for (let guard = 0; guard < 20; guard++) {
    const lead = /^\s*\[/.exec(rest);
    if (!lead) break;
    const close = rest.indexOf(']');
    if (close < 0) return { runs: false, command: rest, conditions, unclosed: true };
    conditions.push(rest.slice(lead[0].length, close));
    rest = rest.slice(close + 1);
  }
  const runs = conditions.length ? evalCondition(conditions[conditions.length - 1], vars) : true;
  return { runs, command: rest.trim(), conditions };
}

// ---- preview: what a command line becomes after the console replaces its variables ----------------------------

// vars: Map(key -> value). -> {text, problems: [string]}. Unset variables and quoted references are reported; the
// text keeps them as written.
function expandCommand(text, vars, target) {
  const mask = quoteMask(text);
  const problems = [];
  const lookup = (name) => (vars.has(keyOf(name, target)) ? vars.get(keyOf(name, target)) : undefined);
  let out = '';
  let i = 0;
  const re = new RegExp(`\\$(${NAME})`, 'y');
  while (i < text.length) {
    if (text[i] === '$') {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) {
        if (mask[i]) {
          if (target === 'ma3') out += m[1];
          else out += m[0];
          problems.push(target === 'ma3' ? `"$${m[1]}" is inside quotes: the "$" is dropped and the name stays.` : `"$${m[1]}" is inside quotes: not expanded (illegal name).`);
        } else {
          const v = lookup(m[1]);
          if (v === undefined) {
            out += m[0];
            problems.push(target === 'ma3' ? `$${m[1]} is not set: the command does not run.` : `$${m[1]} is not set: Error #54 VARIABLE NOT FOUND, the command does not run.`);
          } else out += String(v);
        }
        i += m[0].length;
        continue;
      }
    }
    out += text[i++];
  }
  return { text: out, problems };
}

// ---- ranges: $color1 thru $color5 -------------------------------------------------------------------------------

// '$color1 thru $color5', 'color1..color5', '$c01 - $c05', '$color1 thru 5'. -> {prefix, from, to, pad, names} or {error}.
function parseRange(spec) {
  const s = String(spec || '').trim().replace(/\$/g, '');
  const m = new RegExp(`^(${NAME}?)(\\d+)\\s*(?:thru|through|to|\\.\\.|-)\\s*(?:(${NAME}?)(\\d+)|(\\d+))$`, 'i').exec(s);
  if (!m) return { error: 'Write a range like "$color1 thru $color5".' };
  const [, prefix, a, rightPrefix, z1, z2] = m;
  const z = z1 === undefined ? z2 : z1;
  if (rightPrefix && rightPrefix.toLowerCase() !== prefix.toLowerCase()) return { error: `The two ends must share one name ("${prefix}" and "${rightPrefix}" differ).` };
  const from = Number(a);
  const to = Number(z);
  if (from > to) return { error: 'The range runs backwards.' };
  if (to - from > 9999) return { error: 'That range is more than 10000 variables.' };
  const pad = a.length > 1 && a.startsWith('0') ? a.length : 0;
  const names = [];
  for (let n = from; n <= to; n++) names.push(prefix + String(n).padStart(pad, '0'));
  return { prefix, from, to, pad, names };
}

// {n} the number, {n+2} / {n-1} offset, {n:2} zero padded, {i} the 0-based position, {i+1}.
function applyTemplate(template, n, i, pad = 0) {
  return String(template).replace(/\{([ni])([+-]\d+)?(?::(\d+))?\}/g, (_, which, off, width) => {
    const v = (which === 'n' ? n : i) + (off ? Number(off) : 0);
    const w = width ? Number(width) : which === 'n' ? pad : 0;
    return String(v).padStart(w, '0');
  });
}

const VALID_NAME = new RegExp(`^${NAME}$`);

// Edits that rename every variable of a range with a template: [{start, len, newText, name, to}] against the flat
// occurrence list of one document. template: '$hue{n}' or 'hue{n+10}' (a leading $ is ignored).
function planRangeRename(occ, range, template, target) {
  if (range.error) return { error: range.error, edits: [] };
  const tpl = String(template || '').trim().replace(/^\$/, '');
  if (!tpl) return { error: 'The replacement is empty.', edits: [] };
  const map = new Map();
  const toNames = new Set();
  for (let idx = 0; idx < range.names.length; idx++) {
    const n = range.from + idx;
    const to = applyTemplate(tpl, n, idx, range.pad);
    if (!VALID_NAME.test(to)) return { error: `"${to}" is not a valid variable name.`, edits: [] };
    map.set(keyOf(range.names[idx], target), { from: range.names[idx], to });
    toNames.add(keyOf(to, target));
  }
  if (toNames.size !== map.size) return { error: 'The replacement gives two variables the same name; use {n} in it.', edits: [] };
  const edits = [];
  for (const o of occ) {
    if (o.kind === 'qref') continue;
    const hit = map.get(keyOf(o.name, target));
    if (!hit) continue;
    edits.push({ start: o.start, len: o.len, newText: hit.to, name: hit.from, to: hit.to });
  }
  const collisions = [];
  return { edits, map, collisions };
}

// ---- inline a variable as its value -----------------------------------------------------------------------------

// Edits that replace each `$name` outside quotes by `value`; a value with spaces, or a keyword, would be read
// differently once the $ is gone, so those are refused.
function planInline(occ, name, value, target) {
  const v = String(value);
  if (/\s/.test(v)) return { error: `"${v}" has spaces; written outside quotes it would be read as several words.`, edits: [] };
  if (KEYWORDS.has(v.toLowerCase())) return { error: `"${v}" is a command word; written in place of the variable it would be read as a command.`, edits: [] };
  const edits = [];
  for (const o of occ) if (o.kind === 'ref' && keyOf(o.name, target) === keyOf(name, target)) edits.push({ start: o.start - 1, len: o.len + 1, newText: v });
  return { edits };
}

// ---- converting between the consoles ---------------------------------------------------------------------------

const quoteIfText = (v) => {
  const t = v.trim();
  if (!t) return '""';
  if (/^\\?"[\s\S]*\\?"$/.test(t) || isNumber(t)) return t;
  return `"${t}"`;
};

// One console command: variable commands translate, everything else is returned unchanged. -> {text, notes}
function convertCommand(text, from, to) {
  const notes = [];
  let out = text;
  if (from === 'ma2' && to === 'ma3') {
    out = text.replace(new RegExp(`^(\\s*)(SetVar|SetUserVar)(\\s+)\\$(${NAME})\\s*=\\s*([\\s\\S]*?)\\s*$`, 'i'), (all, lead, verb, _sp, name, value) => {
      if (!value) {
        notes.push(`grandMA3 has no command to clear $${name}; use DelVar(${/user/i.test(verb) ? 'UserVars' : 'GlobalVars'}(), "${name}") in Lua.`);
        return all;
      }
      return `${lead}${/user/i.test(verb) ? 'SetUserVariable' : 'SetGlobalVariable'} "${name}" ${quoteIfText(value)}`;
    });
    if (/^\s*Add(User)?Var\b/i.test(text)) notes.push('AddVar has no grandMA3 counterpart: AddUserVariable does not add to an existing value. Use SetVar in Lua.');
  } else if (from === 'ma3' && to === 'ma2') {
    out = text.replace(new RegExp(`^(\\s*)(SetUserVariable|SetGlobalVariable)(\\s+)\\\\?"?(${NAME})\\\\?"?\\s*([\\s\\S]*?)\\s*$`, 'i'), (all, lead, verb, _sp, name, value) => `${lead}${/user/i.test(verb) ? 'SetUserVar' : 'SetVar'} $${name} = ${quoteIfText(value)}`);
    if (/^\s*Add(User|Global)Variable\b/i.test(text)) notes.push('AddUserVariable does not add to a value on grandMA3, and grandMA2 AddVar does: check what you meant.');
  }
  return { text: out, notes };
}

// A grandMA2 condition as Lua: {pre, test}, or null when it cannot be translated without changing what it does:
// more than one comparison or anything after the first, "!=" (grandMA2 reads it as "==", which is rarely what was
// meant, so the choice is left to the user), a grandMA2 system variable (GetVar cannot see those on grandMA3), a
// `$` token that is not a plain variable name (`$"a"`, `$1`, `$$`), a quoted number (grandMA2 compares it as a number, GetVar may hold text), an ordering comparison against text
// (Lua raises an error on number < text, grandMA2 sorts numbers first) and an ordering comparison of two variables
// (their types are not known; Lua raises an error on number < text).
// grandMA2 makes a comparison false when a variable is unset or the two sides do not compare, and Lua would raise
// an error, so the variables are read first (`pre`, a `local` declaration or '') and `test` is only true when they
// are set and of the right type: a number for a numeric comparison (tonumber, so "5" works as it does on grandMA2),
// anything for == against text or another variable.
// scopeOf(name) -> 'user' | 'global' (defaults to global).
const PLAIN_VAR = new RegExp(`^\\$${NAME}$`); // any other `$...` token (`$"a"`, `$1`, `$$`) is not a variable: refused
// A Lua string literal for any text: backslash, quote and control characters (a raw newline is not valid) escaped.
const luaStr = (v) => `"${String(v).replace(/[\\"\x00-\x1f\x7f]/g, (c) => (c === '\\' || c === '"' ? `\\${c}` : `\\${String(c.charCodeAt(0)).padStart(3, '0')}`))}"`;

function conditionToLua(expr, scopeOf = () => 'global') {
  const m = COMPARISON.exec(expr);
  if (!m || expr.slice(m[0].length).trim() || /^[>=]/.test(m[3]) || m[2] === '!=') return null;
  const ordering = m[2] !== '==';
  let bad = false;
  const operand = (t) => {
    if (t.startsWith('$')) {
      if (!PLAIN_VAR.test(t) || isSystemVar(t.slice(1), 'ma2')) bad = true;
      return { read: `GetVar(${scopeOf(t.slice(1)) === 'user' ? 'UserVars' : 'GlobalVars'}(), "${t.slice(1)}")` };
    }
    const v = unquoteValue(t);
    if (isNumber(v)) {
      if (t.startsWith('"')) bad = true;
      return { num: String(Number(v)) };
    }
    if (ordering) bad = true;
    return { text: luaStr(v) };
  };
  const sides = [operand(m[1]), operand(m[3])];
  const vars = sides.filter((o) => o.read);
  if (bad || (ordering && vars.length > 1)) return null;
  if (!vars.length) return { pre: '', test: `${sides[0].num || sides[0].text} ${m[2]} ${sides[1].num || sides[1].text}` };
  if (vars.length === 2) {
    // equal as numbers when both are numbers, else as text: what grandMA2 does
    return { pre: `local v, w = ${vars[0].read}, ${vars[1].read}`, test: 'v ~= nil and w ~= nil and (tostring(v) == tostring(w) or tonumber(v) ~= nil and tonumber(v) == tonumber(w))' };
  }
  const o = vars[0];
  const side = (x) => (x === o ? (sides.some((y) => y.text) ? 'tostring(v)' : 'v') : x.num || x.text);
  const numeric = !sides.some((y) => y.text);
  return {
    pre: `local v = ${numeric ? `tonumber((${o.read}))` : o.read}`,
    test: `v ~= nil and ${side(sides[0])} ${m[2]} ${side(sides[1])}`,
  };
}

// `[$x==5] Off Page 3` -> {lua: 'do local v = tonumber((GetVar(...))); if v ~= nil and v == 5 then Cmd("Off Page 3") end end'} or null.
// One statement, so it can replace a line. The last closed [..] counts, as on grandMA2. Null when the bracket ends at
// a "]" inside quotes (grandMA2 and parseBracket would disagree about where the condition stops).
function bracketLineToLua(text, scopeOf) {
  let rest = text.trim();
  const conds = [];
  for (let guard = 0; guard < 20; guard++) {
    const b = /^\[/.test(rest) ? parseBracket(rest) : null;
    if (!b || b.end < 0 || rest.indexOf(']') !== b.end) break;
    conds.push(b.expr);
    rest = rest.slice(b.end + 1).trim();
  }
  if (!conds.length || !rest || /^\[/.test(rest) && parseBracket(rest)) return null;
  const c = conditionToLua(conds[conds.length - 1], scopeOf);
  if (!c) return null;
  const iff = `if ${c.test} then Cmd(${luaStr(rest)}) end`;
  return { lua: c.pre ? `do ${c.pre}; ${iff} end` : iff };
}

// A Lua file: the variable API calls of one console rewritten for the other. -> {text, edits, notes}
function convertLua(src, from, to) {
  const clean = stripComments(src);
  const edits = [];
  const notes = [];
  if (from === 'ma2' && to === 'ma3') {
    const map = { 'gma.show.getvar': 'GetVar(GlobalVars(), ', 'gma.show.setvar': 'SetVar(GlobalVars(), ', 'gma.user.getvar': 'GetVar(UserVars(), ', 'gma.user.setvar': 'SetVar(UserVars(), ' };
    for (const m of clean.matchAll(/\bgma\.(?:show|user)\.(?:getvar|setvar)\s*\(\s*/g)) {
      const key = m[0].replace(/\s*\(\s*$/, '').replace(/\s+/g, '');
      edits.push({ start: m.index, len: m[0].length, newText: map[key] });
    }
    for (const m of clean.matchAll(/\bgma\.cmd(?=\s*\()/g)) edits.push({ start: m.index, len: m[0].length, newText: 'Cmd' });
  } else if (from === 'ma3' && to === 'ma2') {
    for (const m of clean.matchAll(/(?<![.:\w])Cmd(?=\s*\()/g)) edits.push({ start: m.index, len: m[0].length, newText: 'gma.cmd' });
    for (const m of clean.matchAll(/\b(GetVar|SetVar)\s*\(\s*(GlobalVars|UserVars)\s*\(\s*\)\s*,\s*/g)) {
      const scope = m[2] === 'GlobalVars' ? 'show' : 'user';
      edits.push({ start: m.index, len: m[0].length, newText: `gma.${scope}.${m[1] === 'GetVar' ? 'getvar' : 'setvar'}(` });
    }
    for (const m of clean.matchAll(/\bDelVar\s*\(\s*(GlobalVars|UserVars)\s*\(\s*\)\s*,\s*(["'])(\w+)\2\s*\)/g)) {
      edits.push({ start: m.index, len: m[0].length, newText: `gma.cmd("${m[1] === 'GlobalVars' ? 'SetVar' : 'SetUserVar'} $${m[3]} =")` });
    }
    for (const m of clean.matchAll(/\b(?:GetVar|SetVar|DelVar)\s*\(\s*(?:PluginVars|AddonVars)\b/g)) notes.push(`grandMA2 has no plugin or addon variables (at offset ${m.index}).`);
  }
  let text = src;
  for (const e of edits.slice().sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.newText + text.slice(e.start + e.len);
  return { text, edits, notes };
}

// ---- live values ------------------------------------------------------------------------------------------------

// Lines of a grandMA2 `ListVar` reply: `Global : $NAME = value` and `User : $NAME = value`.
function parseListVar(lines) {
  const out = [];
  const seen = new Set(); // the console repeats a reply to every Telnet session that is connected
  for (const line of lines) {
    const m = /^(Global|User)\s*:\s*\$(\w+)\s*=\s?(.*)$/.exec(String(line).trim());
    if (!m || seen.has(`${m[1]}:${m[2].toUpperCase()}`)) continue;
    seen.add(`${m[1]}:${m[2].toUpperCase()}`);
    out.push({ scope: m[1].toLowerCase(), name: m[2], value: m[3].trim(), system: m[1] === 'Global' && isSystemVar(m[2], 'ma2') });
  }
  return out;
}

// Lua for the bridge: the current value of each name in each scope -> `scope|name|type|value` records.
const REC = ';;;';
function ma3VarsLua(names) {
  const list = names.filter((n) => VALID_NAME.test(n)).map((n) => `"${n}"`).join(',');
  return [
    'local r = {}',
    `for _, n in ipairs({${list}}) do`,
    '  for _, sc in ipairs({{"global", GlobalVars}, {"user", UserVars}}) do',
    '    local v = GetVar(sc[2](), n)',
    '    if v ~= nil then r[#r + 1] = sc[1] .. "|" .. n .. "|" .. type(v) .. "|" .. tostring(v):gsub("[|\\r\\n]", " ") end',
    '  end',
    'end',
    `return table.concat(r, "${REC}")`,
    '',
  ].join('\n');
}
function ma2VarsLua(names) {
  const list = names.filter((n) => VALID_NAME.test(n)).map((n) => `"${n}"`).join(',');
  return [
    'local r = {}',
    `for _, n in ipairs({${list}}) do`,
    '  for _, sc in ipairs({{"global", gma.show.getvar}, {"user", gma.user.getvar}}) do',
    '    local v = sc[2](n)',
    '    if v ~= nil then r[#r + 1] = sc[1] .. "|" .. n .. "|string|" .. tostring(v):gsub("[|\\r\\n]", " ") end',
    '  end',
    'end',
    `return table.concat(r, "${REC}")`,
    '',
  ].join('\n');
}
function parseVarValues(text) {
  if (!text) return [];
  return text.split(REC).map((rec) => {
    const m = /^(global|user)\|([^|]*)\|([^|]*)\|([\s\S]*)$/.exec(rec);
    return m ? { scope: m[1], name: m[2], type: m[3], value: m[4] } : null;
  }).filter(Boolean);
}

// Lua that sets or clears one variable on grandMA3 (a numeric value is stored as a number).
function ma3SetLua(scope, name, value) {
  if (!VALID_NAME.test(name)) throw new Error(`Not a variable name: ${name}`);
  const fn = scope === 'global' ? 'GlobalVars' : 'UserVars';
  if (value === null || value === undefined) return `DelVar(${fn}(), "${name}")\nreturn "ok"`;
  const lit = isNumber(value) ? String(Number(value)) : `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
  return `SetVar(${fn}(), "${name}", ${lit})\nreturn "ok"`;
}

// grandMA2 command lines to set or clear one variable.
function ma2SetCommand(scope, name, value) {
  if (!VALID_NAME.test(name)) throw new Error(`Not a variable name: ${name}`);
  const verb = scope === 'global' ? 'SetVar' : 'SetUserVar';
  if (value === null || value === undefined || value === '') return `${verb} $${name} =`;
  return `${verb} $${name} = ${isNumber(value) ? String(value).trim() : `"${String(value).replace(/"/g, '')}"`}`;
}

// {added, removed, changed} between two lists of {scope, name, value}.
function diffVars(before, after, target = 'ma2') {
  const k = (v) => `${v.scope}:${keyOf(v.name, target)}`;
  const a = new Map(before.map((v) => [k(v), v]));
  const b = new Map(after.map((v) => [k(v), v]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, v] of b) {
    if (!a.has(key)) added.push(v);
    else if (String(a.get(key).value) !== String(v.value)) changed.push({ scope: v.scope, name: v.name, from: a.get(key).value, to: v.value });
  }
  for (const [key, v] of a) if (!b.has(key)) removed.push(v);
  return { added, removed, changed };
}

// What puts the console back to a snapshot: values to set and variables to clear (system variables are never touched).
function restorePlan(snapshot, current, target = 'ma2') {
  const d = diffVars(snapshot, current, target);
  const set = [...d.removed, ...d.changed.map((c) => ({ scope: c.scope, name: c.name, value: c.from }))].filter((v) => !isSystemVar(v.name, target) || v.scope !== 'global');
  const clear = d.added.filter((v) => !(v.scope === 'global' && isSystemVar(v.name, target)));
  return { set, clear };
}

module.exports = {
  MA2_SYSTEM_VARS,
  isSystemVar,
  keyOf,
  quoteMask,
  splitChain,
  scanCommand,
  scanLua,
  stripComments,
  flattenCommand,
  lintVariables,
  evalCondition,
  evalLine,
  compareValues,
  expandCommand,
  parseRange,
  applyTemplate,
  planRangeRename,
  planInline,
  convertCommand,
  convertLua,
  conditionToLua,
  bracketLineToLua,
  parseListVar,
  ma3VarsLua,
  ma2VarsLua,
  parseVarValues,
  ma3SetLua,
  ma2SetCommand,
  diffVars,
  restorePlan,
  unquoteValue,
  isNumber,
  KEYWORDS,
};
