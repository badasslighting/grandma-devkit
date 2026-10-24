'use strict';
const fs = require('fs');
const path = require('path');
const { stripNonCode } = require('./lint');
const { schemaProblems } = require('./manifestSchema');

// Reads a plugin XML manifest and returns the Lua files it points at plus any problems.
// Problems are {line, message, severity} with 0-based lines.

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length - 1;
}

function parseManifest(xml) {
  const plugins = [];
  const pluginRe = /<Plugin\b([^>]*)>([\s\S]*?)<\/Plugin>/g;
  let p;
  while ((p = pluginRe.exec(xml))) {
    const name = (p[1].match(/\bName="([^"]*)"/) || [])[1];
    const components = [];
    const compRe = /<ComponentLua\b([^>]*?)\/?>/g;
    let c;
    const bodyOffset = p.index + p[0].indexOf('>') + 1;
    while ((c = compRe.exec(p[2]))) {
      components.push({
        name: (c[1].match(/\bName="([^"]*)"/) || [])[1],
        fileName: (c[1].match(/\bFileName="([^"]*)"/) || [])[1],
        index: bodyOffset + c.index,
      });
    }
    plugins.push({ name, components, index: p.index });
  }
  return plugins;
}

function checkManifest(xml, dir, readLua = (f) => fs.readFileSync(f, 'utf8'), exists = fs.existsSync) {
  const problems = [];
  if (!/<GMA3\b/.test(xml)) return problems; // not a grandMA3 file
  if (!/<GMA3\b[^>]*\bDataVersion="[^"]+"/.test(xml)) {
    problems.push({ line: 0, message: 'GMA3 element has no DataVersion attribute.', severity: 'warning' });
  }
  const plugins = parseManifest(xml);
  if (plugins.length > 0) problems.push(...schemaProblems(xml)); // other GMA3 files (exports) have more elements
  if (plugins.length === 0) {
    problems.push({ line: 0, message: 'No <Plugin> element found.', severity: 'warning' });
  }
  for (const plugin of plugins) {
    if (!plugin.name) {
      problems.push({ line: lineOf(xml, plugin.index), message: '<Plugin> needs a Name.', severity: 'error' });
    }
    if (plugin.components.length === 0) {
      problems.push({ line: lineOf(xml, plugin.index), message: 'Plugin has no <ComponentLua>.', severity: 'error' });
    }
    for (const comp of plugin.components) {
      const line = lineOf(xml, comp.index);
      if (!comp.fileName) {
        problems.push({ line, message: '<ComponentLua> needs a FileName.', severity: 'error' });
        continue;
      }
      const file = path.join(dir, comp.fileName);
      if (!exists(file)) {
        problems.push({ line, message: `FileName "${comp.fileName}" not found next to the manifest.`, severity: 'error' });
        continue;
      }
      const code = stripNonCode(readLua(file));
      if (!/^return\b/m.test(code)) {
        problems.push({
          line,
          message: `${comp.fileName} never returns Main/Cleanup at top level; the console gets no entry point.`,
          severity: 'warning',
        });
      }
    }
  }
  return problems;
}

module.exports = { parseManifest, checkManifest };
