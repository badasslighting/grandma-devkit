'use strict';

// Parses the text written by the console's `HelpLua` command (grandMA3_lua_functions.txt).
// Each API line is `Name(params): returns`; section banners switch between the
// free-function API and the object API (methods taking the object handle first).

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function parseParams(paramText) {
  const text = paramText.trim();
  if (!text || text === 'nothing') return [];
  const params = [];
  let open = 0; // unclosed '[' carried across segments
  for (const seg of splitTopLevel(text)) {
    const optional = open > 0 || seg.trim().startsWith('[');
    for (const ch of seg) {
      if (ch === '[') open++;
      else if (ch === ']') open = Math.max(0, open - 1);
    }
    const label = seg.replace(/[[\]]/g, '').trim();
    const colon = label.indexOf(':');
    const type = colon > 0 ? label.slice(0, colon).trim() : '';
    const rest = colon > 0 ? label.slice(colon + 1).trim() : label;
    let name = (rest.match(/^[A-Za-z_][\w-]*/) || ['arg'])[0].replace(/-/g, '_');
    if (label.startsWith('{')) name = 'options';
    else if (label.startsWith('...')) name = '...';
    params.push({ label, type, name, optional });
  }
  return params;
}

function parseLine(line) {
  const m = line.match(/^([A-Za-z_]\w*)\(/);
  if (!m) return null;
  let depth = 0;
  let end = -1;
  for (let i = m[1].length; i < line.length; i++) {
    if (line[i] === '(') depth++;
    else if (line[i] === ')' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const paramText = line.slice(m[1].length + 1, end);
  const returns = line.slice(end + 1).replace(/^\s*:\s*/, '').trim();
  return { name: m[1], signature: line.trim(), params: parseParams(paramText), returns };
}

function parseHelpLua(text) {
  const api = { global: [], object: [] };
  let section = 'global';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^Object API$/i.test(line)) section = 'object';
    else if (/^Object-Free API$/i.test(line)) section = 'global';
    const fn = parseLine(line);
    if (fn) api[section].push(fn);
  }
  return api;
}

module.exports = { parseHelpLua, parseParams, parseLine };
