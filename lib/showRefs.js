'use strict';
const { tokenize, isDynamic } = require('./cmdGrammar');
const { isTruncated } = require('./showCache');

// Show-aware hints for one console command string: a reference such as `Go+ Sequence 12` or `Macro 5` to an object
// that is not in the show the extension last read from the console (lib/showCache.js). A wrong hint here sends the
// user hunting for a problem that is not there, so every rule leans towards saying nothing:
// - only commands whose verb needs the object to exist are checked (MUST_EXIST, or a bare object such as `Macro 5`
//   whose default action runs or selects it); a segment with a verb that can create an object (CREATES) anywhere
//   in it is never checked, nor the object after At / Into except a Preset applied to a selection;
// - a kind is checked only when the show cache lists it and the list was not cut off at the cache cap;
// - only literal numbers and quoted names; a name only when the names of that kind are unique in the cache;
// - a range is flagged only when none of its numbers exist, and never when it is longer than RANGE_CAP.

const KINDS = ['Group', 'Sequence', 'Macro', 'Plugin', 'Layout', 'World', 'Filter', 'Timer', 'Timecode', 'Preset', 'Effect'];
const BY_LOWER = new Map(KINDS.map((k) => [k.toLowerCase(), k]));

// Verbs that do nothing (or error) when the object is not there. Full names only: an abbreviation is not checked.
const MUST_EXIST = ['Go', 'Go+', 'Go-', 'GoBack', 'Goto', 'Call', 'Off', 'On', 'Kill', 'Toggle', 'Select', 'Delete', 'Update', 'Park', 'Unpark', 'Top', 'Pause', 'Flash', 'Release'];
// A first word that is an object: the command runs the object's default action (select, go, call).
const BARE = ['Group', 'Preset', 'Macro', 'Plugin', 'Sequence', 'World', 'Filter', 'Fixture', 'Channel', 'Executor'];
// Verbs that make, fill or rename an object, so the number they name may well be new: Label, Appearance and Edit
// create an empty pool object on an unused number.
const CREATES = ['Store', 'Copy', 'Move', 'Clone', 'Import', 'Assign', 'Label', 'Appearance', 'Edit', 'Insert', 'Record', 'Paste', 'Cut'];
const RANGE_CAP = 200;
const NEAR = 10; // existing numbers at most this far away are named in the message

const lowerMap = (list) => new Map(list.map((v) => [v.toLowerCase(), v]));
const MUST = lowerMap(MUST_EXIST);
const BARE_SET = new Set(BARE.map((v) => v.toLowerCase()));
const CREATES_SET = new Set(CREATES.map((v) => v.toLowerCase()));

const kindOf = (t) => (t && t.type === 'word' ? BY_LOWER.get(t.text.toLowerCase()) : undefined);
const isWord = (t, w) => t && t.type === 'word' && t.text.toLowerCase() === w;
// A literal object number: an integer, or for presets type.number.
const literal = (kind, text) => (kind === 'Preset' ? /^\d+\.\d+$/ : /^\d+$/).test(text);
const nameOf = (text) => text.replace(/^\\?["']/, '').replace(/\\?["']$/, '');

// Integer range from..to (either order) for plain numbers, or within one preset type; null when not expandable.
function expand(kind, from, to) {
  const split = (s) => (kind === 'Preset' ? s.split('.') : ['', s]);
  const [ta, a] = split(from);
  const [tb, b] = split(to);
  if (ta !== tb) return null;
  const lo = Math.min(+a, +b);
  const hi = Math.max(+a, +b);
  const capped = hi - lo + 1 > RANGE_CAP;
  const nos = [];
  for (let n = lo; n <= hi && nos.length < RANGE_CAP; n++) nos.push(kind === 'Preset' ? `${ta}.${n}` : String(n));
  return { nos, capped };
}

// Object references in a command: [{kind, no | name, start, end, verb, range?}], start/end character offsets (end
// exclusive). verb is the segment's verb, or null for a bare object. A Thru range is expanded to one entry per
// number (at most RANGE_CAP), each with the same span and range {from, to, capped}. Only references in segments that
// need their objects to exist are returned (see the rules at the top).
function extractRefs(command, target, opts = {}) {
  if (opts.dynamic || isDynamic(command)) return [];
  const tokens = tokenize(command);
  if (tokens.some((t) => t.open)) return [];
  const segments = [[]];
  for (const t of tokens) {
    if (t.type === 'separator') segments.push([]);
    else if (t.type !== 'condition') segments[segments.length - 1].push(t);
  }
  const out = [];
  for (const seg of segments) {
    const first = seg[0];
    if (!first || first.type !== 'word') continue;
    const low = first.text.toLowerCase();
    let verb;
    if (MUST.has(low)) verb = MUST.get(low);
    else if (BARE_SET.has(low)) verb = null;
    else continue;
    if (seg.some((t) => t.type === 'word' && CREATES_SET.has(t.text.toLowerCase()))) continue;

    let afterAt = false;
    let firstKind = null;
    let i = 0;
    while (i < seg.length) {
      const t = seg[i];
      if (isWord(t, 'at') || isWord(t, 'into')) {
        afterAt = true;
        i++;
        continue;
      }
      const kind = kindOf(t);
      if (!kind) {
        i++;
        continue;
      }
      // After At only a preset applied to a selection is a source; anything else may be a destination.
      const keep = !afterAt || (kind === 'Preset' && firstKind !== 'Preset');
      firstKind = firstKind || kind;
      i++;
      for (;;) {
        const item = seg[i];
        if (item && item.type === 'number') {
          let endTok = item;
          let to = null;
          let open = false;
          if (isWord(seg[i + 1], 'thru')) {
            if (seg[i + 2] && seg[i + 2].type === 'number') [to, endTok, i] = [seg[i + 2].text, seg[i + 2], i + 3];
            else if (kindOf(seg[i + 2]) === kind && seg[i + 3] && seg[i + 3].type === 'number') [to, endTok, i] = [seg[i + 3].text, seg[i + 3], i + 4];
            else [open, i] = [true, i + 2];
          } else i++;
          if (!keep || open || !literal(kind, item.text) || (to !== null && !literal(kind, to))) {
            /* not checkable */
          } else if (to === null) {
            out.push({ kind, no: item.text, start: item.start, end: item.end, verb });
          } else {
            const r = expand(kind, item.text, to);
            if (r) {
              const range = { from: item.text, to, capped: r.capped };
              for (const no of r.nos) out.push({ kind, no, start: item.start, end: endTok.end, verb, range });
            }
          }
        } else if (item && item.type === 'quote') {
          const name = nameOf(item.text);
          if (keep && name && !/[*?]/.test(name)) out.push({ kind, name, start: item.start, end: item.end, verb });
          i++;
        } else break;
        // `+ 5` continues the list of this kind; `+ Group 5` is picked up by the outer loop
        if (seg[i] && seg[i].type === 'sign' && seg[i + 1] && (seg[i + 1].type === 'number' || seg[i + 1].type === 'quote')) i++;
        else break;
      }
    }
  }
  return out;
}

// Existing numbers next to a missing one (same preset type), within NEAR.
function nearest(kind, no, list) {
  const [type, n] = kind === 'Preset' ? no.split('.') : ['', no];
  let below = null;
  let above = null;
  for (const o of list) {
    const [ot, on] = kind === 'Preset' ? String(o.no).split('.') : ['', String(o.no)];
    if (ot !== type || !/^\d+$/.test(on)) continue;
    const v = +on;
    if (v < +n && v >= +n - NEAR && (below === null || v > below)) below = v;
    if (v > +n && v <= +n + NEAR && (above === null || v < above)) above = v;
  }
  return [below, above].filter((v) => v !== null).map((v) => (kind === 'Preset' ? `${type}.${v}` : String(v)));
}

// Hints for references to objects that are not in `show` ({Kind: [{no, name}]}, from parseShow). Findings
// {start, end, message, rule: 'show-missing-object', severity: 'hint'}; none at all without show data.
function checkShowRefs(command, target, show, opts = {}) {
  if (!show || !Object.keys(show).length) return [];
  const usable = (kind) => show[kind] && show[kind].length && !isTruncated(show, kind);
  const has = (kind, no) => show[kind].some((o) => String(o.no) === no);
  const out = [];
  const add = (r, message) => out.push({ start: r.start, end: r.end, message, rule: 'show-missing-object', severity: 'hint' });
  const ranges = new Map();
  for (const r of extractRefs(command, target, opts)) {
    if (!usable(r.kind)) continue;
    if (r.range) {
      if (!ranges.has(r.range)) ranges.set(r.range, []);
      ranges.get(r.range).push(r);
    } else if (r.name !== undefined) {
      const names = show[r.kind].map((o) => String(o.name).toLowerCase());
      if (new Set(names).size !== names.length) continue;
      if (!names.includes(r.name.toLowerCase())) add(r, `${r.kind} "${r.name}" is not in the loaded show.`);
    } else if (!has(r.kind, r.no)) {
      const near = nearest(r.kind, r.no, show[r.kind]);
      add(r, `${r.kind} ${r.no} is not in the loaded show${near.length ? ` (nearest: ${near.join(', ')})` : ''}.`);
    }
  }
  for (const [range, refs] of ranges) {
    if (range.capped || refs.some((r) => has(r.kind, r.no))) continue;
    add(refs[0], `${refs[0].kind} ${range.from} Thru ${range.to}: none of these are in the loaded show.`);
  }
  return out.sort((a, b) => a.start - b.start);
}

module.exports = { extractRefs, checkShowRefs, MUST_EXIST, CREATES, RANGE_CAP };
