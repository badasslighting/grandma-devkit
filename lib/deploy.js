'use strict';
const fs = require('fs');
const path = require('path');
const { parseManifest } = require('./manifest');

function defaultPluginsPath(env = process.env, platform = process.platform) {
  if (platform === 'win32' && env.ProgramData) {
    return path.join(env.ProgramData, 'MALightingTechnology', 'gma3_library', 'datapools', 'plugins');
  }
  return '';
}

// Files to copy for a manifest: the manifest itself plus every ComponentLua file it names.
function filesForManifest(manifestPath) {
  const dir = path.dirname(manifestPath);
  const xml = fs.readFileSync(manifestPath, 'utf8');
  const names = new Set([path.basename(manifestPath)]);
  for (const plugin of parseManifest(xml)) {
    for (const comp of plugin.components) if (comp.fileName) names.add(comp.fileName);
  }
  return [...names].map((n) => path.join(dir, n));
}

// Finds the manifest owning a .lua/.xml file: itself, or an .xml in the same folder naming it.
function findManifest(file) {
  if (file.toLowerCase().endsWith('.xml')) return file;
  const dir = path.dirname(file);
  const base = path.basename(file).toLowerCase();
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.toLowerCase().endsWith('.xml')) continue;
    const manifest = path.join(dir, entry);
    const names = filesForManifest(manifest).map((f) => path.basename(f).toLowerCase());
    if (names.includes(base)) return manifest;
  }
  return null;
}

function deploy(manifestPath, target) {
  if (!target) throw new Error('No plugins folder set (ma3.pluginsPath).');
  const sources = filesForManifest(manifestPath);
  for (const src of sources) {
    if (!fs.existsSync(src)) throw new Error(`Missing file: ${src}`);
  }
  fs.mkdirSync(target, { recursive: true });
  return sources.map((src) => {
    const dest = path.join(target, path.basename(src));
    fs.copyFileSync(src, dest);
    return dest;
  });
}

module.exports = { defaultPluginsPath, filesForManifest, findManifest, deploy };
