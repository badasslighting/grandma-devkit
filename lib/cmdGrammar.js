'use strict';
const GRAMMAR = require('../data/grammar.json');
const { parseBracket, afterCondition } = require('./conditions');
const rules = require('./rules'); // used at call time only, so a later rules.js -> cmdGrammar require cannot cycle

// Grammar checks for one console command string, read from data/grammar.json (the MA2 3.9 / MA3 2.3 manual keyword
// pages). The manuals are incomplete and differ between consoles, so every rule here is a hint and leans towards
// missing a problem: only the first word of a ";" segment is checked as a keyword (unquoted names are legal
// elsewhere), and a string that is only part of a longer command (Lua concatenation, string.format) is not checked.

const CONSOLE = { ma2: 'grandMA2', ma3: 'grandMA3' };
const IS_WORD = /^[A-Za-z][A-Za-z0-9]*[+-]?$/;

// Verbs that need something to act on, on both consoles: every syntax line of their manual page names an object or
// a file after the verb. Not taken from takesObject in grammar.json, which is wrong for bare commands like Go+, Off
// and Store. Appearance is left out: on grandMA3 it is an object (Assign Appearance 3 At ...), not a verb.
const NEEDS_OBJECT = ['Delete', 'Copy', 'Move', 'Label', 'Assign', 'Import', 'Export'];

// Accepted with any keyword: MA asks for confirmation on many commands whose manual page lists no options.
const ANY_OPTIONS = ['noconfirm', 'noconfirmation'];

function prepare(id) {
  const g = GRAMMAR[id];
  const words = Object.keys(g.keywords).filter((k) => IS_WORD.test(g.keywords[k].name));
  const names = words.map((k) => g.keywords[k].name);
  // Keywords whose options are free-form (Assign ... /[property]=value) or not listed: their /flags are not checked.
  const freeForm = new Set(words.filter((k) => !g.keywords[k].options && g.keywords[k].syntaxText.some((l) => l.includes('/'))));
  return { id, g, prefixes: [...words, ...Object.keys(g.aliases)], names, freeForm, onlyIn: new Set(GRAMMAR.onlyIn[id].map((n) => n.toLowerCase())) };
}
const DATA = { ma2: prepare('ma2'), ma3: prepare('ma3') };
const SIGNED = new Set(['go+', 'go-', ...['ma2', 'ma3'].flatMap((id) => Object.keys(GRAMMAR[id].keywords).filter((k) => /^[a-z]\w*[+-]$/.test(k)))]);

// Tokens of a command, each {type, text, start, end} with end exclusive. Types: condition (a leading grandMA2
// [condition], `open` while it has no "]"), word, number, quote, option (`name` lower case, any =value included),
// variable ($name), sign (+ -), separator (;), symbol. Go+ and Go- are one word.
function tokenize(command) {
  const tokens = [];
  let rest = command;
  for (;;) {
    const next = afterCondition(rest);
    if (next === rest) break;
    const at = command.length - rest.length;
    const b = parseBracket(rest);
    tokens.push({ type: 'condition', text: command.slice(at + b.start, at + b.end + 1), start: at + b.start, end: at + b.end + 1 });
    rest = next;
  }
  const open = parseBracket(rest);
  if (open && open.end < 0) {
    const at = command.length - rest.length + open.start;
    tokens.push({ type: 'condition', text: command.slice(at), start: at, end: command.length, open: true });
    return tokens;
  }
  let i = command.length - rest.length;
  const s = command;
  const push = (type, start, end, extra) => tokens.push({ type, text: s.slice(start, end), start, end, ...extra });
  while (i < s.length) {
    const ch = s[i];
    let m;
    if (/\s/.test(ch)) i++;
    else if (ch === ';') push('separator', i, ++i);
    else if (ch === '"' || ch === "'" || (ch === '\\' && (s[i + 1] === '"' || s[i + 1] === "'"))) {
      const q = ch === '\\' ? s[i + 1] : ch;
      const close = s.indexOf(q, i + (ch === '\\' ? 2 : 1));
      const end = close < 0 ? s.length : close + 1;
      push('quote', i, end);
      i = end;
    } else if ((m = /^\/([A-Za-z_]\w*)(?:=(?:\\?"[^"]*"|'[^']*'|[^\s;]*))?/.exec(s.slice(i)))) {
      push('option', i, i + m[0].length, { name: m[1].toLowerCase() });
      i += m[0].length;
    } else if ((m = /^\d+(?:\.\d+)*/.exec(s.slice(i)))) {
      push('number', i, (i += m[0].length));
    } else if ((m = /^[A-Za-z_]\w*/.exec(s.slice(i)))) {
      let end = i + m[0].length;
      if (/[+-]/.test(s[end] || '') && !/\w/.test(s[end + 1] || '') && SIGNED.has((m[0] + s[end]).toLowerCase())) end++;
      push('word', i, end);
      i = end;
    } else if ((m = /^\$\w+/.exec(s.slice(i)))) {
      push('variable', i, (i += m[0].length));
    } else if (ch === '+' || ch === '-') push('sign', i, ++i);
    else if ((m = /^(?:<<<|>>>)/.exec(s.slice(i)))) push('symbol', i, (i += 3));
    else push('symbol', i, ++i);
  }
  return tokens;
}

// The keyword a word names exactly on one console (name, alias, or Go+/Go- for grandMA2's Go), or null.
function keyword(word, d) {
  let low = word.toLowerCase();
  if (d.id === 'ma2' && (low === 'go+' || low === 'go-')) low = 'go';
  if (d.g.keywords[low]) return d.g.keywords[low];
  const alias = d.g.aliases[low];
  return alias ? d.g.keywords[alias.toLowerCase()] : null;
}

// A keyword or the start of one (MA accepts abbreviations and resolves the ambiguous ones itself: G, F, Seq).
function known(word, d) {
  if (keyword(word, d)) return true;
  const low = word.toLowerCase().replace(/^([a-z_]+)\d+$/, '$1'); // Fixture1, Exec2
  return d.prefixes.some((k) => k.startsWith(low));
}

// Keyword names closest to a word, by the same distance and limits as rules.js closest().
function nearest(word, names) {
  const low = word.toLowerCase();
  let best = [];
  let bestD = Infinity;
  for (const n of names) {
    const dist = rules.distance(low, n.toLowerCase());
    if (dist < bestD) [best, bestD] = [[n], dist];
    else if (dist === bestD && !best.includes(n)) best.push(n);
  }
  const limit = word.length >= 8 ? 2 : word.length >= 5 ? 1 : 0;
  return bestD <= limit ? best : [];
}

// A flag matches an option when it starts with the same letter and its letters appear in order in it (/nc, /ka, /o).
function flagMatches(flag, option) {
  if (flag[0] !== option[0]) return false;
  let j = 0;
  for (const ch of option) if (ch === flag[j]) j++;
  return j === flag.length;
}

// Only part of a longer command: concatenated in Lua, a string.format template, or cut off.
const isDynamic = (command) => /["']\s*\.\.|\.\.\s*["']|\.\.\s*$|%[-\d.]*[sdiqfx]|\s$/.test(command);

// Problems in one command string: [{start, end, message, rule, severity, fix?}], start/end character offsets
// (end exclusive), fix {kind: 'replace', text} for the [start, end) range. opts.dynamic: the string is only the
// start of a longer command, so nothing is checked.
function checkGrammar(command, target, opts = {}) {
  if (opts.dynamic || isDynamic(command)) return [];
  const d = DATA[target === 'ma2' ? 'ma2' : 'ma3'];
  const other = DATA[d.id === 'ma2' ? 'ma3' : 'ma2'];
  const tokens = tokenize(command);
  if (tokens.some((t) => t.open)) return [];
  const out = [];
  const add = (t, rule, message, fix) => out.push({ start: t.start, end: t.end, message, rule, severity: 'hint', ...(fix ? { fix: { kind: 'replace', text: fix } } : {}) });
  const isWord = (t, w) => t && t.type === 'word' && t.text.toLowerCase() === w;

  const segments = [[]];
  for (const t of tokens) {
    if (t.type === 'separator') segments.push([]);
    else if (t.type !== 'condition') segments[segments.length - 1].push(t);
  }

  for (const seg of segments) {
    const first = seg[0];
    if (!first) continue;
    const verb = first.type === 'word' ? keyword(first.text, d) : null;

    // -- first word: a keyword of this console
    if (first.type === 'word' && !known(first.text, d) && !GRAMMAR.unknownKeywordIgnorePrefixes.some((p) => first.text.startsWith(p))) {
      if (other.onlyIn.has(first.text.toLowerCase()) && keyword(first.text, other)) {
        const name = keyword(first.text, other).name;
        add(first, 'grammar-other-console', `"${name}" is a ${CONSOLE[other.id]} keyword; the ${CONSOLE[d.id]} manual does not list it.`);
      } else {
        const near = nearest(first.text, d.names);
        const hint = near.length ? ` Did you mean ${near.map((n) => `"${n}"`).join(' or ')}?` : '';
        add(first, 'grammar-unknown-keyword', `"${first.text}" is not a ${CONSOLE[d.id]} keyword.${hint}`, near.length === 1 ? near[0] : null);
      }
    }

    // -- /options: listed for some keyword in the segment
    if (verb) {
      const kws = seg.filter((t) => t.type === 'word').map((t) => keyword(t.text, d)).filter(Boolean);
      const lists = kws.filter((k) => k.options);
      const free = kws.some((k) => d.freeForm.has(k.name.toLowerCase()));
      if (lists.length && !free) {
        const all = [...new Set([...lists.flatMap((k) => k.options), ...ANY_OPTIONS])];
        for (const t of seg) {
          if (t.type !== 'option' || all.some((o) => flagMatches(t.name, o))) continue;
          const owners = [...new Set(lists.map((k) => k.name))].join(' or ');
          add(t, 'grammar-unknown-option', `"/${t.name}" is not an option of ${owners} in the ${CONSOLE[d.id]} manual.`);
        }
      }
    }

    // -- a verb that needs an object, with nothing after it but options
    if (first.type === 'word' && verb && NEEDS_OBJECT.includes(verb.name) && first.text.toLowerCase() === verb.name.toLowerCase() && seg.slice(1).every((t) => t.type === 'option')) {
      add(first, 'grammar-verb-no-object', `${verb.name} needs something to act on, but nothing follows it.`);
    }

    // -- Thru with no start of range
    if (isWord(first, 'thru')) add(first, 'grammar-thru-bare', '"Thru" at the start of a command has no start of range; put an object or a number before it (Fixture 1 Thru 10).');
    seg.forEach((t, k) => {
      if (k > 0 && isWord(t, 'thru') && isWord(seg[k - 1], 'thru')) add(t, 'grammar-thru-bare', 'Two "Thru" in a row.');
    });

    // -- At with nothing after it
    seg.forEach((t, k) => {
      if (isWord(t, 'at') && k === seg.length - 1) add(t, 'grammar-at-empty', 'Nothing follows "At"; give a value or a target (At 50, At Preset 4.1).');
    });
  }
  return out;
}

module.exports = { tokenize, checkGrammar, NEEDS_OBJECT };
