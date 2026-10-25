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

// Lua for the bridge that re-imports a deployed plugin into a pool slot and starts it.
// Uses the Library form of Import: plain `Import "x" At Plugin` creates an empty UserPlugin.
function reloadLua(libName, slot) {
  return reloadCommands('ma3', libName, slot).map((c) => `Cmd(${JSON.stringify(c)})\n`).join('');
}

// The console commands that re-import a deployed plugin into a pool slot and start it, for either
// console. grandMA2 imports over the slot (the pool keeps a copy inside the show) and calls the plugin by
// name; grandMA3 needs the Library form of Import, since plain `Import "x" At Plugin` makes an empty UserPlugin.
function reloadCommands(target, libName, slot) {
  if (!/^\d+$/.test(String(slot))) throw new Error('Plugin pool slot must be a number.');
  const name = String(libName).replace(/["\r\n]/g, '');
  return target === 'ma2'
    ? [`Import "${name}" At Plugin ${slot} /o /nc`, `Plugin "${name}"`]
    : [`Import Plugin Library "${name}" At Plugin ${slot} /nc`, `Call Plugin ${slot}`];
}

// grandMA2 onPC keeps one data folder per software version: <ProgramData>/MA Lighting Technologies/grandma/gma2_V_<ver>/.
// Picks the newest one that has a plugins folder; '' elsewhere.
function defaultMa2PluginsPath(env = process.env, platform = process.platform, fsApi = fs) {
  if (platform !== 'win32' || !env.ProgramData) return '';
  const root = path.join(env.ProgramData, 'MA Lighting Technologies', 'grandma');
  let versions;
  try {
    versions = fsApi.readdirSync(root).filter((d) => /^gma2_V_\d+(\.\d+)*$/.test(d));
  } catch (_) {
    return '';
  }
  const key = (d) => d.slice(7).split('.').map(Number);
  versions.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    return 0;
  });
  for (const v of versions) {
    const dir = path.join(root, v, 'plugins');
    if (fsApi.existsSync(dir)) return dir;
  }
  return '';
}

// grandMA2's `Import "Name"` takes every file in the plugins folder whose name starts with Name, so a
// leftover like `Name.xml.backup-2026...` is imported too and creates a duplicate plugin in the pool.
// Returns those extra files (the plugin's own .xml and .lua do not count).
function importCollisions(dir, name, fsApi = fs) {
  let entries;
  try {
    entries = fsApi.readdirSync(dir);
  } catch (_) {
    return [];
  }
  return entries.filter((e) => e.startsWith(name) && e !== `${name}.xml` && /\.xml/i.test(e));
}

// grandMA2 reloads a plugin by importing over its slot (the pool keeps a copy inside the show), then calls it by name.
function reloadLuaMa2(libName, slot) {
  return reloadCommands('ma2', libName, slot).map((c) => `gma.cmd(${JSON.stringify(c)})\n`).join('');
}

module.exports = { defaultPluginsPath, defaultMa2PluginsPath, filesForManifest, findManifest, deploy, reloadLua, reloadLuaMa2, reloadCommands, importCollisions };
