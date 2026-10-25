'use strict';

// The grandMA2 Lua API (`gma.*`). Unlike grandMA3 there is no HelpLua dump to read it from, so this
// list is curated: every function here is documented by MA or was seen working on onPC 3.9.61. Each
// entry is [path, params, returns, description]; a parameter ending in "?" is optional.
const ENTRIES = [
  ['gma.cmd', ['command'], 'nothing', 'Run a command-line command. Synchronous: about 0.46 s per call on onPC.'],
  ['gma.feedback', ['text'], 'nothing', 'Print to the command-line feedback.'],
  ['gma.echo', ['text'], 'nothing', 'Print to the System Monitor.'],
  ['gma.sleep', ['seconds'], 'nothing', 'Pause the plugin; the console keeps running meanwhile.'],
  ['gma.gettime', [], 'number', 'Seconds since the console started.'],
  ['gma.build_date', [], 'string', 'Build date of the software, such as "Jul 15 2025".'],
  ['gma.build_time', [], 'string', 'Build time of the software.'],
  ['gma.git_version', [], 'string', 'Git revision the software was built from.'],
  ['gma.gethardwaretype', [], 'string', 'Hardware the software runs on, such as "GMA2".'],
  ['gma.timestamp.amount', [], 'number', 'Number of recorded timestamps.'],
  ['gma.timestamp.name', ['index'], 'string', 'Name of a recorded timestamp.'],
  ['gma.timestamp.time', ['index'], 'number', 'Time of a recorded timestamp in seconds.'],
  ['gma.draw.getperformance', ['...'], 'value', 'Drawing performance figures. Parameters not documented.'],
  ['gma.network.getprimaryip', [], 'string', 'Primary network address of this station.'],
  ['gma.network.getsecondaryip', [], 'string', 'Secondary network address of this station.'],
  ['gma.network.gethosttype', [], 'string', 'Host type, such as "Console".'],
  ['gma.network.gethostsubtype', [], 'string', 'Host subtype, such as "onPC".'],
  ['gma.network.gethostdata', ['...'], 'value', 'Data about a host in the session. Parameters not documented.'],
  ['gma.network.getsessionname', [], 'string', 'Name of the MA-Net session.'],
  ['gma.network.getsessionnumber', [], 'number', 'Number of the MA-Net session.'],
  ['gma.network.getslot', [], 'number', 'MA-Net slot of this station.'],
  ['gma.network.getmanetslot', ['...'], 'value', 'MA-Net slot data. Parameters not documented.'],
  ['gma.network.getstatus', [], 'string', 'Role of this station in the session, such as "Master".'],
  ['gma.network.getperformance', ['...'], 'value', 'Network performance figures. Parameters not documented.'],
  ['gma.canbus.ball', ['...'], 'value', 'CAN bus trackball data. Parameters not documented.'],
  ['gma.canbus.encoder', ['...'], 'value', 'CAN bus encoder data. Parameters not documented.'],
  ['gma.canbus.fader', ['...'], 'value', 'CAN bus fader data. Parameters not documented.'],
  ['gma.canbus.hardkey', ['...'], 'value', 'CAN bus hard key data. Parameters not documented.'],
  ['gma.canbus.wheel', ['...'], 'value', 'CAN bus wheel data. Parameters not documented.'],
  ['gma.timer', ['callback', 'interval', 'count', 'cleanup?'], 'nothing', 'Call a function every `interval` seconds, `count` times.'],
  ['gma.textinput', ['title', 'default?'], 'string or nil', 'Text input pop-up. Returns the typed text, or nil on cancel.'],
  ['gma.export', ['file', 'table'], 'boolean', 'Export a Lua table as XML.'],
  ['gma.import', ['file'], 'table', 'Import an XML file as a Lua table.'],
  ['gma.export_csv', ['file', 'table'], 'boolean', 'Export a Lua table as CSV.'],
  ['gma.export_json', ['file', 'table'], 'boolean', 'Export a Lua table as JSON.'],
  ['gma.gui.confirm', ['title', 'message'], 'true or nil', 'Ok/Cancel pop-up. Returns true, or nil on Cancel (not false).'],
  ['gma.gui.msgbox', ['title', 'message'], 'nothing', 'Message pop-up.'],
  ['gma.gui.progress.start', ['title'], 'handle', 'Start a progress bar and return its handle.'],
  ['gma.gui.progress.stop', ['handle'], 'nothing', 'Close a progress bar.'],
  ['gma.gui.progress.settext', ['handle', 'text'], 'nothing', 'Set the text of a progress bar.'],
  ['gma.gui.progress.setrange', ['handle', 'from', 'to'], 'nothing', 'Set the range of a progress bar.'],
  ['gma.gui.progress.set', ['handle', 'value'], 'nothing', 'Set the position of a progress bar.'],
  ['gma.show.getdmx', ['address'], 'number', 'Read a DMX value, e.g. 101 or 1.101.'],
  ['gma.show.getvar', ['name'], 'value', 'Read a show variable. An unset name returns no value (not nil).'],
  ['gma.show.setvar', ['name', 'value'], 'nothing', 'Write a show variable.'],
  ['gma.show.getobj.handle', ['address'], 'handle or nil', 'Handle of the object a command-line address names, e.g. "Group 5". Nil when empty.'],
  ['gma.show.getobj.index', ['handle'], 'number', 'Index of an object in its parent.'],
  ['gma.show.getobj.number', ['handle'], 'number', 'Pool number of an object.'],
  ['gma.show.getobj.class', ['handle'], 'string', 'Class of an object, such as CMD_MACRO or CMD_SEQUENCE.'],
  ['gma.show.getobj.name', ['handle'], 'string', 'Name of an object.'],
  ['gma.show.getobj.label', ['handle'], 'string or nil', 'Label of an object.'],
  ['gma.show.getobj.amount', ['handle'], 'number', 'Number of child slots, including empty ones.'],
  ['gma.show.getobj.child', ['handle', 'index'], 'handle or nil', 'Child by index. Nil for an empty slot.'],
  ['gma.show.getobj.parent', ['handle'], 'handle', 'Parent object, such as the pool a preset sits in.'],
  ['gma.show.getobj.verify', ['handle'], 'boolean', 'Whether a handle still points at an object.'],
  ['gma.show.getobj.compare', ['handle', 'other'], 'boolean', 'Whether two handles name the same object.'],
  ['gma.show.property.amount', ['handle'], 'number', 'Number of properties of an object.'],
  ['gma.show.property.name', ['handle', 'index'], 'string', 'Name of a property, counting from 0.'],
  ['gma.show.property.get', ['handle', 'index_or_name'], 'string', 'Value of a property.'],
  ['gma.user.getvar', ['name'], 'value', 'Read a user variable (case-insensitive, no $). An unset name returns no value.'],
  ['gma.user.setvar', ['name', 'value'], 'nothing', 'Write a user variable.'],
  ['gma.user.getcmddest', [], 'handle', 'Current command destination.'],
  ['gma.user.getselectedexec', [], 'handle', 'Currently selected executor.'],
];

const toParam = (p) => {
  if (p === '...') return { name: '...', optional: true, label: '...' }; // parameters the console does not document
  const optional = p.endsWith('?');
  const name = optional ? p.slice(0, -1) : p;
  return { name, optional, label: name };
};

const FUNCTIONS = ENTRIES.map(([path, params, returns, doc]) => {
  const ps = params.map(toParam);
  const shown = ps.map((p) => (p.name === '...' ? '...' : p.optional ? `[${p.name}]` : p.name)).join(', ');
  return { path, name: path.split('.').pop(), params: ps, returns, doc, signature: `${path}(${shown})${returns === 'nothing' ? '' : ': ' + returns}` };
});

const BY_PATH = new Map(FUNCTIONS.map((f) => [f.path, f]));

// Namespaces seen in the API that hold more than the listed functions.
const OTHER_NAMESPACES = ['gma.network', 'gma.canbus'];

// Names that can follow `prefix.` (prefix like "gma.show"): functions and sub-namespaces.
function members(prefix) {
  const out = new Map();
  const want = prefix + '.';
  for (const f of FUNCTIONS) {
    if (!f.path.startsWith(want)) continue;
    const rest = f.path.slice(want.length);
    const next = rest.split('.')[0];
    if (rest.includes('.')) out.set(next, { name: next, namespace: true, path: want + next });
    else out.set(next, { name: next, fn: f, path: f.path });
  }
  if (prefix === 'gma') for (const ns of OTHER_NAMESPACES) out.set(ns.split('.')[1], { name: ns.split('.')[1], namespace: true, path: ns });
  return [...out.values()];
}

// The dotted path being completed at the end of `before`: "x = gma.show.get" -> {prefix: 'gma.show', partial: 'get'}.
function memberContext(before) {
  const m = /\b(gma(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*)?$/.exec(before);
  return m ? { prefix: m[1], partial: m[2] || '' } : null;
}

// The full dotted word under a position in `line`, ending at the identifier that contains `col`.
function pathAt(line, col) {
  const left = /[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.exec(line.slice(0, col));
  const right = /^\w*/.exec(line.slice(col));
  if (!left) return null;
  const full = left[0] + right[0];
  return /^gma(\.|$)/.test(full) ? full : null;
}

// The dotted name of the call the cursor is inside, and which argument: like activeCall but for `a.b.c(`.
function activeCallPath(rawText) {
  const text = rawText.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (s) => '_'.repeat(s.length));
  if (/["']/.test(text)) return null;
  let depth = 0;
  let commas = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')' || ch === '}' || ch === ']') depth++;
    else if (ch === '(' || ch === '{' || ch === '[') {
      if (depth === 0) {
        if (ch !== '(') return null;
        const m = /([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*$/.exec(text.slice(0, i));
        return m ? { path: m[1], argIndex: commas } : null;
      }
      depth--;
    } else if (ch === ',' && depth === 0) commas++;
  }
  return null;
}

module.exports = { FUNCTIONS, BY_PATH, members, memberContext, pathAt, activeCallPath };
