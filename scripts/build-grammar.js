'use strict';
// Builds data/grammar.json from the keyword pages harvested out of the grandMA2 3.9 and grandMA3 2.3 manuals
// (data/grammar-src/*-syntax-raw.json). Every field is read mechanically from the manual's syntax lines,
// option lists and examples; where the manual says nothing the field is null, which means "do not check".
// Output is deterministic: keys and lists are sorted, nothing depends on time or file order.
//   node scripts/build-grammar.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'grammar-src');
const OUT = path.join(ROOT, 'data', 'grammar.json');

const IDENT = /^[A-Za-z][A-Za-z0-9]*[+-]?$/;
const SYMBOLS = [';', '/', '.', '=', '$', '#', '<<<', '>>>', '-', '+', '*', '%', '@', '[', '(', '"'];

// The typed form of a keyword from its page title: "Store" -> "Store", "<<< (GoFastBackward)" -> "<<<",
// "CueOutDelay Keywords" -> "CueOutDelay", "At @ Character" -> "At", "- [Minus]" -> "-". Page titles that
// name no keyword ("VPU pixel mapper view", "Quotation Marks ...") give null.
function keywordName(title) {
  const t = title.replace(/\s+Keywords?$/i, '').replace(/\s+Character$/i, '').trim();
  if (IDENT.test(t)) return t;
  const first = t.split(/\s+/)[0];
  if (SYMBOLS.includes(first)) return first;
  if (/^#\[/.test(t)) return '#';
  if (IDENT.test(first) && /^(?:[^A-Za-z0-9\s]+|\([^)]*\)|\[[^\]]*\])$/.test(t.slice(first.length).trim())) {
    // "At @", "Asterisk *", "Dollar $", "Slash /": the symbol is the keyword, the word only names it
    const sym = t.slice(first.length).trim().split(/\s+/)[0];
    if (SYMBOLS.includes(sym)) return sym === '@' ? first : sym;
    return first;
  }
  return null;
}

// Syntax lines are mixed with prose from the page; keep the ones that read like syntax.
const isSyntaxLine = (line, name) => {
  const l = line.trim();
  if (!l || l.length > 200) return false;
  if (/^[[(/]/.test(l)) return true;
  const first = l.split(/[\s([/]/)[0];
  return first.toLowerCase() === name.toLowerCase() || (IDENT.test(first) && /[[(]/.test(l) && !/[.:]$/.test(l));
};

const OBJECT_ARG = /^\[(?:[A-Za-z ]*?(?:object|executor|selection|cue object|attribute|fixture|channel|dmx|effect|station|timecode)[A-Za-z0-9 -]*(?:-?list)?[A-Za-z0-9 -]*)\]/i;

// Fields read from the syntax lines of one keyword.
function fromSyntax(name, lines, raw) {
  const low = name.toLowerCase();
  const text = lines.join(' ');
  const own = lines.filter((l) => l.trim().toLowerCase().startsWith(low) || (raw.alias && l.trim().toLowerCase().startsWith(raw.alias)));
  const rest = own.map((l) => l.trim().slice(l.trim().split(/[\s([/]/)[0].length).trim());
  let takesObject = null;
  if (own.length) {
    const required = rest.map((r) => OBJECT_ARG.test(r));
    const bare = rest.some((r) => r === '' || /^\(/.test(r) || /^\/|^On\b|^Off\b/i.test(r));
    if (bare) takesObject = false;
    else if (required.every(Boolean)) takesObject = true;
  }
  // The manual describes a default object or the selected executor: the bare verb is valid.
  const prose = `${raw.description || ''} ${raw.notes || ''}`;
  if (takesObject && /\bif no\b|\bdefault\b|\bselected\b|\bwithout\b/i.test(prose)) takesObject = false;
  if (takesObject && (raw.examples || []).some((e) => new RegExp(`>\\s*${low.replace(/[+-]/g, '\\$&')}\\s*(?:/.*)?$`, 'i').test(e.trim()))) takesObject = false;
  return {
    takesObject,
    takesName: lines.length ? /"[^"]*"|\bname\b/i.test(text) : null,
    takesNumber: lines.length ? /\b(?:number|id|value|index)\b|\[\d|_Number/i.test(text) : null,
    rangeable: lines.length || raw.examples ? /-list\]|object list|\bthru\b/i.test(text) || (raw.examples || []).some((e) => new RegExp(`\\b${low.replace(/[+-]/g, '\\$&')}\\b.*\\bthru\\b`, 'i').test(e)) : null,
  };
}

// Options: the page's option list plus option keywords listed one per line under the syntax (Reboot, ShutDown).
// A keyword whose syntax sets free-form parameters with a slash (Assign ... /[parameter]=value) gets null.
function optionList(raw, lines) {
  const set = new Set();
  for (const o of raw.options || []) {
    const m = /^\/\s*([A-Za-z][\w]*)/.exec(o.trim());
    if (m) set.add(m[1].toLowerCase());
  }
  for (const l of lines) {
    const m = /^\/([A-Za-z]\w*)$/.exec(l.trim());
    if (m) set.add(m[1].toLowerCase());
  }
  if (lines.some((l) => /\/\s*\[?\s*(?:parameter|property)/i.test(l))) return null;
  return set.size ? [...set].sort() : null;
}

function build(file, consoleId) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8'));
  const keywords = {};
  const aliases = {};
  for (const k of raw.keywords) {
    const name = keywordName(k.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (keywords[key]) continue; // a second page for the same keyword (e.g. "At" and "At @ Character")
    const lines = (k.syntax || []).filter((l) => isSyntaxLine(l, name)).map((l) => l.trim());
    // The first word of the keyword's own syntax lines, when it is not the keyword's name, is the form you
    // type: "Go [Object]" on the Go+ page, "CD [Element-index]" on the ChangeDest page.
    for (const l of lines) {
      const first = l.split(/[\s([/]/)[0];
      if (IDENT.test(first) && first.toLowerCase() !== key && new RegExp(`^${first}\\s*(?:\\[|$|\\.\\.|/)`, 'i').test(l)) {
        const fl = first.toLowerCase();
        if (key.startsWith(fl) || (first.length <= 3 && /^[A-Z]+$/.test(first))) aliases[fl] = aliases[fl] || name;
      }
    }
    const alias = Object.keys(aliases).find((a) => aliases[a] === name);
    const isWord = IDENT.test(name);
    const syn = isWord ? fromSyntax(name, lines, { ...k, alias }) : { takesObject: null, takesName: null, takesNumber: null, rangeable: null };
    let kind = k.kind || null;
    if (!kind && isWord && lines.length) {
      if (lines.some((l) => new RegExp(`^\\(?\\[Function\\]\\)?\\s+${name.replace(/[+-]/g, '\\$&')}\\b`, 'i').test(l))) kind = 'object';
      else if (syn.takesObject !== null || lines.every((l) => l.toLowerCase().startsWith(key))) kind = 'verb';
    }
    if (!isWord) kind = 'operator';
    keywords[key] = {
      name,
      kind,
      options: optionList(k, k.syntax || []),
      takesObject: syn.takesObject,
      takesName: syn.takesName,
      takesNumber: syn.takesNumber,
      rangeable: syn.rangeable,
      syntaxText: lines,
    };
  }
  for (const a of Object.keys(aliases)) if (keywords[a]) delete aliases[a];
  let objectTypes;
  if (raw.objectKeywordList) {
    objectTypes = raw.objectKeywordList.filter((o) => keywords[o]).map((o) => keywords[o].name);
    for (const k of Object.values(keywords)) if (k.kind === 'object' && !objectTypes.includes(k.name)) objectTypes.push(k.name);
  } else objectTypes = Object.values(keywords).filter((k) => k.kind === 'object').map((k) => k.name);
  return { source: raw.source, keywords: sortKeys(keywords), aliases: sortKeys(aliases), objectTypes: [...new Set(objectTypes)].sort() };
}

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

function main() {
  const ma2 = build('ma2-syntax-raw.json', 'ma2');
  const ma3 = build('ma3-syntax-raw.json', 'ma3');
  const words = (g) => Object.keys(g.keywords).filter((k) => IDENT.test(g.keywords[k].name));
  const onlyIn = {
    ma2: words(ma2).filter((k) => !ma3.keywords[k] && !ma3.aliases[k]).map((k) => ma2.keywords[k].name),
    ma3: words(ma3).filter((k) => !ma2.keywords[k] && !ma2.aliases[k]).map((k) => ma3.keywords[k].name),
  };
  const out = { generatedBy: 'scripts/build-grammar.js', ma2, ma3, onlyIn };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`grammar.json: ma2 ${Object.keys(ma2.keywords).length} keywords, ma3 ${Object.keys(ma3.keywords).length}; only ma2 ${onlyIn.ma2.length}, only ma3 ${onlyIn.ma3.length}`);
}

if (require.main === module) main();
module.exports = { keywordName, build };
