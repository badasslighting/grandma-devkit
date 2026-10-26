'use strict';

// Conditional commands in console command strings. Behaviour was checked on onPC (MA2 3.9.61.1, MA3 2.5.1.0):
//  - grandMA2 runs the rest of a line only if a leading [condition] is true. It compares text, and the
//    operators are == > < <= >= (a single =, != and the like never match, so the line silently never runs).
//  - grandMA3 does not run a command that starts with [condition]; conditions belong in Lua.
//  - `If` is a selection filter on both consoles, not a branch: `If $var==1 Go+` does not test anything.

const CALL = /\b(?:Cmd|CmdIndirect|CmdIndirectWait|gma\.cmd)\s*\(\s*$/;

const KEYWORD_DOCS = {
  if: 'Filter: the command only acts on the objects that match what follows. It is not a branch; for a condition use `[$var==1]` at the start of a grandMA2 line, or Lua on either console.',
  endif: 'Ends an `If` filter early, so the rest of the command follows it: `Store If Group 5 EndIf Preset 1.1`.',
  ifoutput: 'Filter: only objects that have output.',
  ifactive: 'Filter: only objects that are active.',
  ifprog: 'Filter: only objects that are in the programmer.',
};

const BRACKET_DOC = [
  '**Condition** (grandMA2): the rest of the line runs only if the condition is true.',
  '',
  'Operators: `==` `>` `<` `<=` `>=`. Both sides are compared as text, character by character, so `"61"` is greater than `"599"`. User variables are written `$name`; set them with `SetVar $name = value`.',
  '',
  '`[$myvar==5] Off Page 3`',
].join('\n');

// Every string literal that is the first argument of a console-command call (Cmd, CmdIndirect, CmdIndirectWait,
// gma.cmd): {offset, text, quote, dynamic}. offset is where the text starts in src, and dynamic marks a string
// that continues with `..`, so what it holds is only the start of the command.
function commandStrings(src) {
  const out = [];
  const longOpen = (i, dashes) => /^(=*)\[/.exec(src.slice(i + (dashes ? 3 : 1), i + (dashes ? 3 : 1) + 40));
  const skipLong = (i, open, dashes) => {
    const from = i + (dashes ? 3 : 1) + open[0].length;
    const close = src.indexOf(`]${open[1]}]`, from);
    return close < 0 ? src.length : close + open[1].length + 2;
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '-' && src[i + 1] === '-') {
      const open = src[i + 2] === '[' ? longOpen(i, true) : null;
      if (open) i = skipLong(i, open, true);
      else {
        const nl = src.indexOf('\n', i);
        i = nl < 0 ? src.length : nl;
      }
    } else if (ch === '[') {
      const open = longOpen(i, false);
      i = open ? skipLong(i, open, false) : i + 1;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      if (src[j] === ch && CALL.test(src.slice(Math.max(0, i - 40), i))) {
        out.push({ offset: i + 1, text: src.slice(i + 1, j), quote: ch, dynamic: /^\s*\.\./.test(src.slice(j + 1, j + 8)) });
      }
      i = j + 1;
    } else i++;
  }
  return out;
}

// The leading [condition] of a command: {start, end, expr, rest}, end -1 while the bracket is still open.
function parseBracket(text) {
  const lead = /^\s*\[/.exec(text);
  if (!lead) return null;
  const start = lead[0].length - 1;
  let quote = null;
  for (let i = start + 1; i < text.length; i++) {
    let ch = text[i];
    if (ch === '\\') {
      i++; // a Lua-escaped quote (\") still opens or closes a quoted value
      ch = text[i];
      if (ch !== '"' && ch !== "'") continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ']') return { start, end: i, expr: text.slice(start + 1, i), rest: text.slice(i + 1) };
  }
  return { start, end: -1, expr: text.slice(start + 1), rest: '' };
}

const maskQuoted = (s) => s.replace(/\\?"[^"]*?\\?"|\\?'[^']*?\\?'/g, (m) => '_'.repeat(m.length));
const VALID_OP = /==|<=|>=|<|>/;
const BAD_OP = /!=|~=|<>|(?<![=<>!~])=(?!=)/;
const COMPARISON = /==|!=|~=|<=|>=|\$\w+\s*[<>]/;

// Problems in the text of one command string: [{offset, len, rule, message, severity}], offsets relative to the text.
// opts.dynamic: the string is only the start of a longer command, so a missing `]` or command is not a mistake.
function checkCommand(text, target, opts = {}) {
  const issues = [];
  const add = (offset, len, rule, message, severity = 'warning') => issues.push({ offset, len, rule, message, severity });
  const b = parseBracket(text);
  if (b && target !== 'ma2') {
    add(b.start, (b.end < 0 ? text.length : b.end + 1) - b.start, 'bracket-ma3', 'grandMA3 does not run a command that starts with a [condition] (checked on 2.5.1.0); test it in Lua instead: if GetVar(UserVars(), "name") == 1 then Cmd("...") end');
  } else if (b) {
    const span = (b.end < 0 ? text.length : b.end + 1) - b.start;
    const expr = maskQuoted(b.expr);
    if (b.end < 0 && !opts.dynamic) add(b.start, span, 'bracket-unclosed', 'This [condition] has no closing "]".');
    else if (!b.expr.trim() && b.end >= 0) add(b.start, span, 'bracket-empty', 'Empty [condition].');
    else if (b.expr.trim()) {
      const bad = BAD_OP.exec(expr);
      if (bad) add(b.start + 1 + bad.index, bad[0].length, 'bracket-operator', `"${bad[0]}" is not a grandMA2 comparison operator (use == > < <= >=); the condition never matches, so the command never runs.`);
      else if (!VALID_OP.test(expr)) add(b.start, span, 'bracket-no-operator', 'This [condition] has no comparison operator (== > < <= >=).', 'hint');
    }
    if (b.end >= 0 && !b.rest.trim() && !opts.dynamic) add(b.start, span, 'bracket-no-command', 'Nothing follows this [condition]; there is no command to run.');
  }
  // If / EndIf, outside the bracket and quotes
  const bodyStart = b ? (b.end < 0 ? text.length : b.end + 1) : 0;
  const body = maskQuoted(text.slice(bodyStart));
  const words = [...body.matchAll(/\b(If|EndIf)\b/gi)];
  let open = false;
  words.forEach((m, k) => {
    const isEnd = m[1].toLowerCase() === 'endif';
    const at = bodyStart + m.index;
    if (isEnd) {
      if (!open) add(at, m[1].length, 'endif-without-if', 'EndIf without a preceding If.');
      open = false;
      return;
    }
    open = true;
    const next = words.slice(k + 1).find((w) => w[1].toLowerCase() === 'endif');
    const tail = body.slice(m.index + m[1].length, next ? next.index : body.length);
    if (COMPARISON.test(tail)) {
      add(at, m[1].length, 'if-not-branch', `"If" filters the objects a command acts on; it is not a branch, so this comparison tests nothing. ${target === 'ma2' ? 'Put the condition in square brackets at the start of the line (e.g. [$var==1] Go+), or use a Lua if.' : 'grandMA3 has no condition syntax in command lines; test it in Lua and then call Cmd().'}`);
    }
  });
  return issues;
}

// The text after a closed leading [condition], or the text unchanged.
const afterCondition = (text) => {
  const b = parseBracket(text);
  return b && b.end >= 0 ? b.rest : text;
};

module.exports = { commandStrings, parseBracket, checkCommand, afterCondition, KEYWORD_DOCS, BRACKET_DOC };
