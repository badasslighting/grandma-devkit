'use strict';

// What a grandMA3 plugin manifest may contain, as seen in real plugin XML files. Only elements and
// attributes known to occur are listed, so completion never offers something the console may not read.
const SCHEMA = {
  GMA3: {
    doc: 'Root element of a grandMA3 XML file.',
    children: ['Info', 'Plugin'],
    attrs: { DataVersion: 'Version of the XML format, four numbers such as 2.0.0.0. The console warns when it is newer than the software.' },
  },
  Info: {
    doc: 'Header the console writes into exports.',
    children: [],
    attrs: { datetime: 'When the file was exported.', showfile: 'Show file the export came from.' },
  },
  Plugin: {
    doc: 'One plugin: a name, a version and the Lua files that make it up.',
    children: ['ComponentLua'],
    attrs: {
      Name: 'Plugin name shown in the plugin pool. Required.',
      Version: 'Plugin version, for example 0.1.0.',
      Author: 'Who wrote the plugin.',
    },
  },
  ComponentLua: {
    doc: 'One Lua file of the plugin. The first component is the one the console runs.',
    children: [],
    attrs: {
      Name: 'Component name. Required.',
      FileName: 'Lua file next to the manifest. Required.',
    },
  },
};

const DATA_VERSIONS = ['2.0.0.0', '1.9.0.0', '1.8.0.0'];
const FORMAT = { DataVersion: /^\d+(\.\d+){3}$/, Version: /^\d+(\.\d+){1,3}$/ };

// Position-based context for completion: are we naming an element, an attribute or a value?
function contextAt(before) {
  const lt = before.lastIndexOf('<');
  if (lt === -1 || before.lastIndexOf('>') > lt) return { kind: 'text', parent: parentOf(before) };
  const tag = before.slice(lt + 1);
  if (/^[!?\/]/.test(tag)) return { kind: 'none' };
  const nameMatch = /^([A-Za-z_][\w.-]*)?$/.exec(tag);
  if (nameMatch) return { kind: 'element', parent: parentOf(before.slice(0, lt)), partial: nameMatch[1] || '' };
  const el = /^([A-Za-z_][\w.-]*)\s/.exec(tag);
  if (!el) return { kind: 'none' };
  const used = [...tag.matchAll(/([A-Za-z_][\w.-]*)\s*=\s*"[^"]*"/g)].map((m) => m[1]);
  const value = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)$/.exec(tag);
  if (value) return { kind: 'value', element: el[1], attr: value[1], partial: value[2] };
  return { kind: 'attribute', element: el[1], used, partial: (/([A-Za-z_][\w.-]*)$/.exec(tag) || [])[1] || '' };
}

// Innermost element still open at the end of `text`.
function parentOf(text) {
  const stack = [];
  for (const m of text.matchAll(/<(\/?)([A-Za-z_][\w.-]*)[^>]*?(\/?)>/g)) {
    if (m[1]) stack.pop();
    else if (!m[3]) stack.push(m[2]);
  }
  return stack[stack.length - 1] || null;
}

function valuesFor(element, attr) {
  if (element === 'GMA3' && attr === 'DataVersion') return DATA_VERSIONS;
  return [];
}

// Problems with element/attribute names and value formats; {line, message, severity}, 0-based lines.
function schemaProblems(xml) {
  const problems = [];
  const lineOf = (i) => xml.slice(0, i).split('\n').length - 1;
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w.-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, rest, selfClose] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const parent = stack[stack.length - 1];
    const spec = SCHEMA[name];
    if (!spec) {
      problems.push({ line: lineOf(m.index), message: `Unknown element <${name}>.`, severity: 'warning' });
    } else {
      if (parent && SCHEMA[parent] && !SCHEMA[parent].children.includes(name))
        problems.push({ line: lineOf(m.index), message: `<${name}> is not expected inside <${parent}>.`, severity: 'warning' });
      for (const a of rest.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g)) {
        if (!(a[1] in spec.attrs)) problems.push({ line: lineOf(m.index), message: `Unknown attribute "${a[1]}" on <${name}>.`, severity: 'warning' });
        else if (FORMAT[a[1]] && !FORMAT[a[1]].test(a[2]))
          problems.push({ line: lineOf(m.index), message: `${a[1]} "${a[2]}" should look like ${a[1] === 'DataVersion' ? '2.0.0.0' : '0.1.0'}.`, severity: 'warning' });
      }
    }
    if (!selfClose) stack.push(name);
  }
  return problems;
}

module.exports = { SCHEMA, DATA_VERSIONS, contextAt, parentOf, valuesFor, schemaProblems };
