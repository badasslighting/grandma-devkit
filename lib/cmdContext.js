'use strict';
const COMMANDS = require('../data/commands.json');

const CMD_CALL = /\b(Cmd|CmdIndirect|CmdIndirectWait|gma\.cmd)\s*\(\s*$/;

// Is the cursor inside a string literal on this line, and is that string the command passed to Cmd()?
// Returns null outside a string, else {inCmd, text} where text is the string so far.
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
  return { inCmd: CMD_CALL.test(before.slice(0, open)), text: before.slice(open + 1) };
}

const lower = (kind) => new Map(COMMANDS[kind].map(([n]) => [n.toLowerCase(), n]));
const VERBS = lower('verb');
const OBJECTS = lower('object');

// Keywords worth offering after the text typed so far, best first: a verb opens a command, an object
// follows a verb, modifiers follow an object or a number. Each entry is {name, kind, doc, rank}.
function suggestKeywords(text) {
  const words = text.split(/\s+/);
  const prev = (words.length > 1 ? words[words.length - 2] : '').toLowerCase();
  const order =
    !prev ? ['verb', 'object', 'modifier'] : VERBS.has(prev) ? ['object', 'modifier', 'verb'] : OBJECTS.has(prev) || /^[\d.+-]+$/.test(prev) ? ['modifier', 'object', 'verb'] : ['modifier', 'object', 'verb'];
  const out = [];
  order.forEach((kind, rank) => {
    for (const [name, doc] of COMMANDS[kind]) out.push({ name, kind, doc, rank });
  });
  return out;
}

module.exports = { stringContext, suggestKeywords };
