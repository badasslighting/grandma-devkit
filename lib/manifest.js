'use strict';
const fs = require('fs');
const path = require('path');
const { stripNonCode } = require('./lint');
const { schemaProblems, isMa2 } = require('./manifestSchema');

// Reads a plugin XML manifest (grandMA3 or grandMA2) and returns the Lua files it points at plus any
// problems. Problems are {line, message, severity} with 0-based lines.

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length - 1;
}

const attr = (attrs, name) => (new RegExp(`\\b${name}="([^"]*)"`).exec(attrs) || [])[1];

// grandMA3: <Plugin Name=..><ComponentLua Name=.. FileName=../></Plugin>.
// grandMA2: <Plugin index=.. name=.. luafile=.. /> (one Lua file, no children). Each plugin is
// {name, components: [{name, fileName, index}], index, ma2}.
function parseManifest(xml) {
  const plugins = [];
  const pluginRe = /<Plugin\b([^>]*)>([\s\S]*?)<\/Plugin>/g;
  let p;
  while ((p = pluginRe.exec(xml))) {
    if (p[1].trimEnd().endsWith('/')) {
      pluginRe.lastIndex = p.index + 1; // self-closing: the match ran on to a later </Plugin>
      continue;
    }
    const components = [];
    const compRe = /<ComponentLua\b([^>]*?)\/?>/g;
    let c;
    const bodyOffset = p.index + p[0].indexOf('>') + 1;
    while ((c = compRe.exec(p[2]))) {
      components.push({ name: attr(c[1], 'Name'), fileName: attr(c[1], 'FileName'), index: bodyOffset + c.index });
    }
    plugins.push({ name: attr(p[1], 'Name'), components, index: p.index, ma2: false });
  }
  const selfRe = /<Plugin\b([^>]*?)\/>/g;
  while ((p = selfRe.exec(xml))) {
    const luafile = attr(p[1], 'luafile');
    plugins.push({
      name: attr(p[1], 'name'),
      components: [{ name: attr(p[1], 'name'), fileName: luafile, index: p.index }],
      index: p.index,
      ma2: true,
    });
  }
  return plugins.sort((a, b) => a.index - b.index);
}

function checkManifest(xml, dir, readLua = (f) => fs.readFileSync(f, 'utf8'), exists = fs.existsSync) {
  const problems = [];
  const ma2 = isMa2(xml);
  if (!ma2 && !/<GMA3\b/.test(xml)) return problems; // not a plugin manifest
  if (!ma2 && !/<GMA3\b[^>]*\bDataVersion="[^"]+"/.test(xml)) {
    problems.push({ line: 0, message: 'GMA3 element has no DataVersion attribute.', severity: 'warning' });
  }
  const plugins = parseManifest(xml);
  if (ma2 && plugins.length === 0) return problems; // a grandMA2 macro, layout or other export, not a plugin
  if (plugins.length > 0) problems.push(...schemaProblems(xml)); // other files (exports) have more elements
  if (plugins.length === 0) {
    problems.push({ line: 0, message: 'No <Plugin> element found.', severity: 'warning' });
  }
  const nameAttr = ma2 ? 'name' : 'Name';
  const fileAttr = ma2 ? 'luafile' : 'FileName';
  for (const plugin of plugins) {
    if (!plugin.name) {
      problems.push({ line: lineOf(xml, plugin.index), message: `<Plugin> needs a ${nameAttr}.`, severity: 'error' });
    }
    if (plugin.components.length === 0) {
      problems.push({ line: lineOf(xml, plugin.index), message: 'Plugin has no <ComponentLua>.', severity: 'error' });
    }
    for (const comp of plugin.components) {
      const line = lineOf(xml, comp.index);
      if (!comp.fileName) {
        problems.push({ line, message: ma2 ? '<Plugin> needs a luafile.' : '<ComponentLua> needs a FileName.', severity: 'error' });
        continue;
      }
      const file = path.join(dir, comp.fileName);
      if (!exists(file)) {
        problems.push({ line, message: `${fileAttr} "${comp.fileName}" not found next to the manifest.`, severity: 'error' });
        continue;
      }
      const code = stripNonCode(readLua(file));
      if (!/^return\b/m.test(code)) {
        problems.push({
          line,
          message: ma2
            ? `${comp.fileName} never returns its main function at top level; the console gets no entry point.`
            : `${comp.fileName} never returns Main/Cleanup at top level; the console gets no entry point.`,
          severity: 'warning',
        });
      }
    }
  }
  return problems;
}

module.exports = { parseManifest, checkManifest };
