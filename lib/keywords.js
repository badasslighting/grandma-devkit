'use strict';

// The grandMA3 command keywords documented in the onPC 2.5 help (data/keywords.json): name, one-line
// description, shortcut and manual page. Used for hover and completion inside Cmd("...") strings.
const LIST = require('../data/keywords.json');

const BY_NAME = new Map();
for (const k of LIST) {
  BY_NAME.set(k.name.toLowerCase(), k);
  if (k.short) BY_NAME.set(k.short.toLowerCase(), BY_NAME.get(k.short.toLowerCase()) || k);
}

// The documented keyword spelled `word` (name or shortcut, any case), or null.
function keywordInfo(word) {
  return BY_NAME.get(String(word || '').toLowerCase()) || null;
}

function keywordMarkdown(k) {
  const lines = [`**${k.name}**${k.short ? ` (shortcut \`${k.short}\`)` : ''}`];
  if (k.doc) lines.push('', k.doc);
  lines.push('', `[Manual page](${k.url})`);
  return lines.join('\n');
}

// Documented keywords whose name is one plain word: the ones a command line can start or continue with.
const WORDS = LIST.filter((k) => /^[A-Za-z][A-Za-z0-9+-]*$/.test(k.name));

module.exports = { keywordInfo, keywordMarkdown, KEYWORDS: LIST, WORDS };
