'use strict';
const COMMANDS = require('../data/commands.json');
const { parseBracket, afterCondition, KEYWORD_DOCS, BRACKET_DOC } = require('./conditions');

const CMD_CALL = /\b(Cmd|CmdIndirect|CmdIndirectWait|gma\.cmd)\s*\(\s*$/;

// Is the cursor inside a string literal on this line, and is that string the command passed to Cmd()?
// Returns null outside a string, else {inCmd, text, quote, call}: text is the string so far, quote its
// opening character and call the function the string is the first argument of ('' when it is not).
function stringContext(before) {
  let quote = null;
  let open = -1;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      open = i;
    } else if (ch === '-' && before[i + 1] === '-') return null; // comment
  }
  if (!quote) return null;
  const head = before.slice(0, open);
  const call = (/([A-Za-z_][\w.]*)\s*\(\s*$/.exec(head) || [])[1] || '';
  return { inCmd: CMD_CALL.test(head), text: before.slice(open + 1), quote, call };
}

const lower = (kind) => new Map(COMMANDS[kind].map(([n]) => [n.toLowerCase(), n]));
const VERBS = lower('verb');
const OBJECTS = lower('object');

// Keywords worth offering after the text typed so far, best first: a verb opens a command, an object
// follows a verb, modifiers follow an object or a number. A closed leading [condition] is skipped, and
// after If the objects it filters come first. Each entry is {name, kind, doc, rank}.
function suggestKeywords(text) {
  const words = afterCondition(text).split(/\s+/);
  const prev = (words.length > 1 ? words[words.length - 2] : '').toLowerCase();
  const order =
    !prev ? ['verb', 'object', 'modifier'] : prev === 'if' ? ['object', 'modifier', 'verb'] : VERBS.has(prev) ? ['object', 'modifier', 'verb'] : OBJECTS.has(prev) || /^[\d.+-]+$/.test(prev) ? ['modifier', 'object', 'verb'] : ['modifier', 'object', 'verb'];
  const out = [];
  order.forEach((kind, rank) => {
    for (const [name, doc] of COMMANDS[kind]) out.push({ name, kind, doc, rank });
  });
  return out;
}

const OPERATORS = [
  ['==', 'Equal (text comparison).'],
  ['>', 'Greater than (text comparison).'],
  ['<', 'Less than (text comparison).'],
  ['>=', 'Greater than or equal (text comparison).'],
  ['<=', 'Less than or equal (text comparison).'],
];

// What to offer inside a grandMA2 [condition] that is still open: comparison operators once a value has been
// typed, then the closing bracket. Returns null outside one (and always for grandMA3, which has none).
// Each entry is {name, doc, insert}.
function conditionSuggestions(text, target) {
  if (target !== 'ma2') return null;
  const b = parseBracket(text);
  if (!b || b.end >= 0) return null;
  const expr = b.expr.replace(/"[^"]*"|'[^']*'/g, '_');
  if (!expr.trim()) return [];
  if (/==|<=|>=|<|>/.test(expr)) return [{ name: ']', doc: 'Close the condition; the command follows.', insert: '] ' }];
  return OPERATORS.map(([name, doc]) => ({ name, doc, insert: name }));
}

// Markdown for the word at `character` when it sits in a console command string: the If-family keywords,
// and, on grandMA2, anything inside a [condition]. Returns {start, end, markdown} or null.
function commandHover(line, character, target) {
  const re = /[A-Za-z_]\w*/g;
  let m;
  while ((m = re.exec(line))) {
    if (m.index <= character && character <= m.index + m[0].length) break;
  }
  if (!m) return null;
  const ctx = stringContext(line.slice(0, m.index));
  if (!ctx || !ctx.inCmd) return null;
  const doc = KEYWORD_DOCS[m[0].toLowerCase()];
  const b = target === 'ma2' ? parseBracket(ctx.text) : null;
  if (b && b.end < 0) return { start: m.index, end: m.index + m[0].length, markdown: BRACKET_DOC };
  if (!doc) return null;
  return { start: m.index, end: m.index + m[0].length, markdown: `**${m[0]}**: ${doc}` };
}

module.exports = { stringContext, suggestKeywords, conditionSuggestions, commandHover };
