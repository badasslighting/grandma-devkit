'use strict';
const { commandStrings } = require('./conditions');
const { bracketLineToLua } = require('./variables');

// Quick fix for the `bracket-ma3` warning: one Lua line `Cmd("[$x > 1] Go+ Executor 1")` becomes
// `if GetVar(GlobalVars(), "x") > 1 then Cmd("Go+ Executor 1") end`. Pure text in, text out.

const ESCAPES = { '\\': '\\', '"': '"', "'": "'" };

// The value of a Lua string literal body, or null for an escape this does not read (\n, \z, \x41, \065, \u{..}, a
// line continuation) or a control character: a console command has none of those.
function decodeLuaString(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') {
      out += body[i];
      continue;
    }
    const e = body[++i];
    if (!(e in ESCAPES)) return null;
    out += ESCAPES[e];
  }
  return /[\u0000-\u001f]/.test(out) ? null : out;
}

// line: one line of Lua that is a whole `Cmd("...")` or `gma.cmd("...")` statement (optional `;` and trailing
// comment). scopeOf(name) -> 'user' | 'global'. -> {text} to put in place of the line, or null when the line
// is another shape, the string is built with `..`, or the condition cannot be translated without changing what it
// does (see conditionToLua in variables.js).
function bracketCallToLuaIf(line, scopeOf) {
  const head = /^(\s*)(?:Cmd|gma\.cmd)\s*\(\s*(["'])/.exec(line);
  if (!head) return null;
  const s = commandStrings(line)[0];
  if (!s || s.dynamic || s.offset !== head[0].length || s.quote !== head[2]) return null;
  const tail = /^\s*\)\s*;?\s*(--.*)?$/.exec(line.slice(s.offset + s.text.length + 1));
  if (!tail) return null;
  const command = decodeLuaString(s.text);
  const converted = command === null ? null : bracketLineToLua(command, scopeOf);
  if (!converted) return null;
  return { text: head[1] + converted.lua + (tail[1] ? ' ' + tail[1] : '') };
}

module.exports = { bracketCallToLuaIf, decodeLuaString };
