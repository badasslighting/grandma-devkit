'use strict';

// Macro files hold console command lines, so the command-line checks and variable features apply to them too:
//  - `.gma2macro` / `.gma3macro`: plain text, one macro line per line (the format of the .txt to Macros tool).
//    Blank lines, `#` and `//` comments and `@directive` lines are not commands.
//  - exported XML: grandMA2 `<Macroline><text>..</text></Macroline>`, grandMA3 `<MacroLine Command=".." />`.
//    The text is XML-escaped (&quot; and so on), so every segment keeps a map from its characters back to the file.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// {text, map}: the entities decoded, and map[i] the offset in `raw` of decoded code unit i (map[text.length] = raw.length).
function decode(raw) {
  let text = '';
  const map = [];
  for (let i = 0; i < raw.length; ) {
    if (raw[i] === '&') {
      const m = /^&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/i.exec(raw.slice(i, i + 10));
      if (m) {
        const e = m[1];
        const ch = e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()];
        for (let k = 0; k < ch.length; k++) map.push(i);
        text += ch;
        i += m[0].length;
        continue;
      }
    }
    map.push(i);
    text += raw[i++];
  }
  map.push(raw.length);
  return { text, map };
}

// 'text' for .gma2macro / .gma3macro, 'xml' for an XML file that holds macros, else null.
function macroKind(fileName, text) {
  const name = String(fileName || '').toLowerCase();
  if (/\.gma[23]macro$/.test(name)) return { kind: 'text', target: name.endsWith('.gma2macro') ? 'ma2' : 'ma3' };
  if (!name.endsWith('.xml')) return null;
  const head = String(text || '').slice(0, 4000);
  if (/<GMA3\b/.test(head) && /<Macro\b/.test(text)) return { kind: 'xml', target: 'ma3' };
  if (/<MA\b[^>]*grandma2/i.test(head) && /<Macro\b/.test(text)) return { kind: 'xml', target: 'ma2' };
  return null;
}

// Command segments of a macro file: [{start (raw offset of the first character), text, map}]; map is null when the
// text is the file's own text.
function commandSegments(text, fileName) {
  const k = macroKind(fileName, text);
  if (!k) return { kind: null, target: null, segments: [] };
  const segments = [];
  if (k.kind === 'text') {
    let at = 0;
    for (const line of text.split('\n')) {
      const body = line.replace(/\r$/, '');
      const lead = /^\s*/.exec(body)[0].length;
      const t = body.slice(lead);
      if (t && !/^(#|\/\/|@)/.test(t)) segments.push({ start: at + lead, text: t.replace(/\s+$/, ''), map: null });
      at += line.length + 1;
    }
  } else {
    const re = k.target === 'ma2' ? /<Macroline\b[^>]*>\s*<text>([\s\S]*?)<\/text>/gi : /<MacroLine\b[^>]*?\bCommand="([^"]*)"/gi;
    for (const m of text.matchAll(re)) {
      const raw = m[1];
      const d = decode(raw);
      segments.push({ start: m.index + m[0].length - raw.length - (k.target === 'ma2' ? '</text>'.length : 1), text: d.text, map: d.map });
    }
  }
  return { kind: k.kind, target: k.target, segments };
}

// Position in the file of `len` characters at `start` of a segment's text -> {start, len}.
function toRaw(seg, start, len) {
  if (!seg.map) return { start: seg.start + start, len };
  const a = seg.map[Math.min(start, seg.map.length - 1)];
  const z = seg.map[Math.min(start + len, seg.map.length - 1)];
  return { start: seg.start + a, len: z - a };
}

// The text to write back for a replacement inside a segment (XML needs & < > " escaped).
function encodeFor(seg, replacement) {
  return seg.map ? replacement.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : replacement;
}

module.exports = { decode, macroKind, commandSegments, toRaw, encodeFor };
