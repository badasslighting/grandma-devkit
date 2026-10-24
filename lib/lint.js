'use strict';

// Finds `while true do` loops that can never hand control back to the console:
// no coroutine.yield, break or return anywhere in the loop body. Returns 0-based line numbers.

function stripNonCode(src) {
  // Blank out comments and strings, keeping line structure so line numbers stay valid.
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  return src
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, blank)
    .replace(/--[^\n]*/g, blank)
    .replace(/\[(=*)\[[\s\S]*?\]\1\]/g, blank)
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, blank);
}

const TOKEN = /\b(function|if|do|repeat|end|until|while|for)\b/g;

function findBlockingLoops(src) {
  const code = stripNonCode(src);
  const findings = [];
  const loopRe = /\bwhile\s+(true|1)\s+do\b/g;
  let m;
  while ((m = loopRe.exec(code))) {
    const bodyStart = m.index + m[0].length;
    TOKEN.lastIndex = bodyStart;
    let depth = 1;
    let t;
    let bodyEnd = code.length;
    while ((t = TOKEN.exec(code))) {
      const w = t[1];
      if (w === 'function' || w === 'if' || w === 'do' || w === 'repeat') depth++;
      else if (w === 'end' || w === 'until') depth--;
      if (depth === 0) {
        bodyEnd = t.index;
        break;
      }
    }
    const body = code.slice(bodyStart, bodyEnd);
    if (!/\b(coroutine\.yield|break|return)\b/.test(body)) {
      findings.push({ line: code.slice(0, m.index).split('\n').length - 1, text: m[0] });
    }
  }
  return findings;
}

module.exports = { findBlockingLoops, stripNonCode };
