'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { filesForManifest, deploy, importCollisions } = require('./deploy');
const { isMa2 } = require('./manifestSchema');

// Putting a plugin on a USB stick for a hardware console. The console reads plugins from
// <stick>/gma3_library/datapools/plugins (grandMA3) or <stick>/gma2/plugins (grandMA2).
// A stick the grandMA3 console formatted keeps its library under <stick>/grandMA3/gma3_library (checked on a
// real stick); a plain gma3_library at the root is also accepted. A blank stick gets the console's own layout.
const GMA3_LAYOUTS = [['grandMA3', 'gma3_library'], ['gma3_library']];
const GMA2_DIR = ['gma2', 'plugins'];

function usbTarget(root, ma2, exists = fs.existsSync) {
  if (ma2) return path.join(root, ...GMA2_DIR);
  const layout = GMA3_LAYOUTS.find((l) => exists(path.join(root, ...l))) || GMA3_LAYOUTS[0];
  return path.join(root, ...layout, 'datapools', 'plugins');
}

// Parses `Get-CimInstance ... | ConvertTo-Json` output: nothing, one object, or an array.
function parseWindowsDisks(json) {
  const text = String(json || '').trim();
  if (!text) return [];
  const data = JSON.parse(text);
  return (Array.isArray(data) ? data : [data]).filter((d) => d && d.DeviceID).map((d) => ({
    root: `${d.DeviceID}\\`,
    label: `${d.VolumeName ? `${d.VolumeName} ` : ''}(${d.DeviceID})`,
    free: Number(d.FreeSpace) || 0,
  }));
}

// Removable drives that are plugged in. `run` and `readdir` are injectable for tests.
function listRemovableDrives({ platform = process.platform, env = process.env, run = execFile, readdir = fs.readdirSync } = {}) {
  if (platform === 'win32') {
    return new Promise((resolve) => {
      run(
        'powershell',
        ['-NoProfile', '-Command', "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress"],
        { timeout: 8000 },
        (err, stdout) => {
          if (err) return resolve([]);
          try {
            resolve(parseWindowsDisks(stdout));
          } catch (_) {
            resolve([]);
          }
        }
      );
    });
  }
  const bases = platform === 'darwin' ? ['/Volumes'] : [`/media/${env.USER || ''}`, `/run/media/${env.USER || ''}`, '/mnt'];
  const out = [];
  for (const base of bases) {
    let names = [];
    try {
      names = readdir(base);
    } catch (_) {
      continue;
    }
    for (const n of names) out.push({ root: path.join(base, n), label: `${n} (${base})`, free: 0 });
  }
  return Promise.resolve(out);
}

// What exporting a manifest to `root` would do: where it goes and which files already exist there.
function planExport(manifest, root) {
  const ma2 = isMa2(fs.readFileSync(manifest, 'utf8'));
  const dest = usbTarget(root, ma2);
  const names = filesForManifest(manifest).map((f) => path.basename(f));
  const existing = names.filter((n) => fs.existsSync(path.join(dest, n)));
  const libName = path.basename(manifest, path.extname(manifest));
  return { ma2, dest, names, existing, libName, collisions: ma2 ? importCollisions(dest, libName) : [] };
}

function exportToStick(manifest, root) {
  const plan = planExport(manifest, root);
  const copied = deploy(manifest, plan.dest);
  return { ...plan, copied };
}

module.exports = { usbTarget, parseWindowsDisks, listRemovableDrives, planExport, exportToStick };
