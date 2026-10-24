'use strict';

// Comments become blanks; strings keep their quotes and length so an argument still counts as one.
// Line structure is preserved so line numbers stay valid.
function maskCode(src) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  const mask = (s) => s.replace(/[^\n]/g, '_');
  return src
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, blank)
    .replace(/--[^\n]*/g, blank)
    .replace(/\[(=*)\[[\s\S]*?\]\1\]|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, mask);
}

module.exports = { maskCode };
