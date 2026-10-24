'use strict';

// What a plugin manifest may contain, as seen in real plugin XML files. Only elements and attributes
// known to occur are listed, so completion never offers something the console may not read.
// `snippet` lists the attributes a completion inserts for a new element.
const SCHEMA = {
  GMA3: {
    doc: 'Root element of a grandMA3 XML file.',
    children: ['Info', 'Plugin'],
    snippet: ['DataVersion'],
    attrs: { DataVersion: 'Version of the XML format, four numbers such as 2.0.0.0. The console warns when it is newer than the software.' },
  },
  Info: {
    doc: 'Header the console writes into exports.',
    children: [],
    snippet: [],
    attrs: { datetime: 'When the file was exported.', showfile: 'Show file the export came from.' },
  },
  Plugin: {
    doc: 'One plugin: a name, a version and the Lua files that make it up.',
    children: ['ComponentLua'],
    snippet: ['Name', 'Version'],
    attrs: {
      Name: 'Plugin name shown in the plugin pool. Required.',
      Version: 'Plugin version, for example 0.1.0.',
      Author: 'Who wrote the plugin.',
    },
  },
  ComponentLua: {
    doc: 'One Lua file of the plugin. The first component is the one the console runs.',
    children: [],
    snippet: ['Name', 'FileName'],
    attrs: {
      Name: 'Component name. Required.',
      FileName: 'Lua file next to the manifest. Required.',
    },
  },
};

// grandMA2 plugin manifests: one self-closing <Plugin> naming a single Lua file.
const SCHEMA_MA2 = {
  MA: {
    doc: 'Root element of a grandMA2 XML file.',
    children: ['Info', 'Plugin'],
    snippet: ['xmlns', 'major_vers', 'minor_vers', 'stream_vers'],
    attrs: {
      xmlns: 'Namespace, http://schemas.malighting.de/grandma2/xml/MA',
      'xmlns:xsi': 'XML Schema instance namespace.',
      'xsi:schemaLocation': 'Where the XML schema for this software version lives.',
      major_vers: 'Major software version, for example 3.',
      minor_vers: 'Minor software version, for example 9.',
      stream_vers: 'Stream (build) version, for example 61.',
    },
  },
  Info: {
    doc: 'Header the console writes into exports.',
    children: [],
    snippet: [],
    attrs: { datetime: 'When the file was exported.', showfile: 'Show file the export came from.' },
  },
  Plugin: {
    doc: 'One plugin and the Lua file it runs.',
    children: [],
    snippet: ['index', 'execute_on_load', 'name', 'luafile'],
    attrs: {
      index: 'Pool slot the plugin is imported into by default; 0 lets the import command decide.',
      execute_on_load: '1 runs the plugin when the show loads, 0 does not.',
      name: 'Plugin name. Required.',
      luafile: 'Lua file next to the manifest. Required.',
    },
  },
};

const DATA_VERSIONS = ['2.0.0.0', '1.9.0.0', '1.8.0.0'];
const FORMAT = {
  DataVersion: /^\d+(\.\d+){3}$/,
  Version: /^\d+(\.\d+){1,3}$/,
  major_vers: /^\d+$/,
  minor_vers: /^\d+$/,
  stream_vers: /^\d+$/,
  index: /^\d+$/,
  execute_on_load: /^[01]$/,
};
const EXAMPLE = { DataVersion: '2.0.0.0', Version: '0.1.0', major_vers: '3', minor_vers: '9', stream_vers: '61', index: '0', execute_on_load: '0' };

const isMa2 = (xml) => /<MA\b/.test(xml) && !/<GMA3\b/.test(xml);
const schemaFor = (xml) => (isMa2(xml) ? SCHEMA_MA2 : SCHEMA);
const rootOf = (xml) => (isMa2(xml) ? 'MA' : 'GMA3');

// Position-based context for completion: are we naming an element, an attribute or a value?
function contextAt(before) {
  const lt = before.lastIndexOf('<');
  if (lt === -1 || before.lastIndexOf('>') > lt) return { kind: 'text', parent: parentOf(before) };
  const tag = before.slice(lt + 1);
  if (/^[!?/]/.test(tag)) return { kind: 'none' };
  const nameMatch = /^([A-Za-z_][\w.-]*)?$/.exec(tag);
  if (nameMatch) return { kind: 'element', parent: parentOf(before.slice(0, lt)), partial: nameMatch[1] || '' };
  const el = /^([A-Za-z_][\w.-]*)\s/.exec(tag);
  if (!el) return { kind: 'none' };
  const used = [...tag.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*"[^"]*"/g)].map((m) => m[1]);
  const value = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)$/.exec(tag);
  if (value) return { kind: 'value', element: el[1], attr: value[1], partial: value[2] };
  return { kind: 'attribute', element: el[1], used, partial: (/([A-Za-z_][\w.:-]*)$/.exec(tag) || [])[1] || '' };
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
  if (element === 'Plugin' && attr === 'execute_on_load') return ['0', '1'];
  return [];
}

// Problems with element/attribute names and value formats; {line, message, severity}, 0-based lines.
function schemaProblems(xml) {
  const schema = schemaFor(xml);
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
    const spec = schema[name];
    if (!spec) {
      problems.push({ line: lineOf(m.index), message: `Unknown element <${name}>.`, severity: 'warning' });
    } else {
      if (parent && schema[parent] && !schema[parent].children.includes(name))
        problems.push({ line: lineOf(m.index), message: `<${name}> is not expected inside <${parent}>.`, severity: 'warning' });
      for (const a of rest.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g)) {
        if (!(a[1] in spec.attrs)) problems.push({ line: lineOf(m.index), message: `Unknown attribute "${a[1]}" on <${name}>.`, severity: 'warning' });
        else if (FORMAT[a[1]] && !FORMAT[a[1]].test(a[2]))
          problems.push({ line: lineOf(m.index), message: `${a[1]} "${a[2]}" should look like ${EXAMPLE[a[1]]}.`, severity: 'warning' });
      }
    }
    if (!selfClose) stack.push(name);
  }
  return problems;
}

module.exports = { SCHEMA, SCHEMA_MA2, DATA_VERSIONS, isMa2, schemaFor, rootOf, contextAt, parentOf, valuesFor, schemaProblems };
