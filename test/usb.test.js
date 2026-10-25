'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { usbTarget, parseWindowsDisks, listRemovableDrives, planExport, exportToStick } = require('../lib/usb');
const { xmlTemplate, luaTemplate, ma2XmlTemplate, ma2LuaTemplate } = require('../lib/templates');

test('usbTarget follows the library layout already on the stick', () => {
  const has = (...present) => (p) => present.some((x) => p === path.join('S', ...x));
  const plugins = ['datapools', 'plugins'];
  assert.strictEqual(usbTarget('S', false, has(['grandMA3', 'gma3_library'])), path.join('S', 'grandMA3', 'gma3_library', ...plugins), 'a console-formatted stick');
  assert.strictEqual(usbTarget('S', false, has(['gma3_library'])), path.join('S', 'gma3_library', ...plugins), 'a plain library at the root');
  assert.strictEqual(usbTarget('S', false, has()), path.join('S', 'grandMA3', 'gma3_library', ...plugins), 'a blank stick gets the console layout');
  assert.strictEqual(usbTarget('S', true, has()), path.join('S', 'gma2', 'plugins'));
});

test('Windows disk JSON: none, one, many, and junk', () => {
  assert.deepStrictEqual(parseWindowsDisks(''), []);
  assert.deepStrictEqual(parseWindowsDisks('{"DeviceID":"E:","VolumeName":"SHOW","Size":8,"FreeSpace":5}'), [{ root: 'E:\\', label: 'SHOW (E:)', free: 5 }]);
  const many = parseWindowsDisks('[{"DeviceID":"E:","VolumeName":null,"FreeSpace":1},{"DeviceID":"F:","VolumeName":"B","FreeSpace":2}]');
  assert.deepStrictEqual(many.map((d) => d.label), ['(E:)', 'B (F:)']);
  assert.throws(() => parseWindowsDisks('not json'));
});

test('listRemovableDrives: Windows through PowerShell, other systems by folder, failures give an empty list', async () => {
  const ok = await listRemovableDrives({ platform: 'win32', run: (cmd, args, opts, cb) => cb(null, '{"DeviceID":"G:","VolumeName":"X","FreeSpace":3}') });
  assert.deepStrictEqual(ok.map((d) => d.root), ['G:\\']);
  assert.deepStrictEqual(await listRemovableDrives({ platform: 'win32', run: (c, a, o, cb) => cb(new Error('no powershell')) }), []);
  assert.deepStrictEqual(await listRemovableDrives({ platform: 'win32', run: (c, a, o, cb) => cb(null, 'garbage') }), []);
  const mac = await listRemovableDrives({ platform: 'darwin', readdir: () => ['Macintosh HD', 'STICK'] });
  assert.deepStrictEqual(mac.map((d) => d.root), [path.join('/Volumes', 'Macintosh HD'), path.join('/Volumes', 'STICK')]);
  assert.deepStrictEqual(await listRemovableDrives({ platform: 'linux', env: { USER: 'a' }, readdir: () => { throw new Error('none'); } }), []);
});

function plugin(dir, name, ma2) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.lua`), ma2 ? ma2LuaTemplate(name) : luaTemplate(name));
  fs.writeFileSync(path.join(dir, `${name}.xml`), ma2 ? ma2XmlTemplate(name) : xmlTemplate(name));
  return path.join(dir, `${name}.xml`);
}

test('exporting copies the manifest and Lua into the right folder per console, and reports what exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usb-'));
  const stick = path.join(tmp, 'stick');
  fs.mkdirSync(stick);
  const m3 = plugin(path.join(tmp, 'src3'), 'Demo3', false);
  const m2 = plugin(path.join(tmp, 'src2'), 'Demo2', true);

  const first = exportToStick(m3, stick);
  assert.strictEqual(first.ma2, false);
  assert.deepStrictEqual(first.existing, []);
  const plugins3 = path.join(stick, 'grandMA3', 'gma3_library', 'datapools', 'plugins');
  assert.ok(fs.existsSync(path.join(plugins3, 'Demo3.xml')));
  assert.ok(fs.existsSync(path.join(plugins3, 'Demo3.lua')));

  assert.deepStrictEqual(planExport(m3, stick).existing.sort(), ['Demo3.lua', 'Demo3.xml'], 'a second export would replace both');

  fs.mkdirSync(path.join(stick, 'gma2', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(stick, 'gma2', 'plugins', 'Demo2.xml.backup-1'), '');
  const second = exportToStick(m2, stick);
  assert.strictEqual(second.ma2, true);
  assert.deepStrictEqual(second.collisions, ['Demo2.xml.backup-1'], 'a leftover backup would be imported as a duplicate');
  assert.ok(fs.existsSync(path.join(stick, 'gma2', 'plugins', 'Demo2.lua')));
});

test('listing the real removable drives never throws on this machine', async () => {
  const drives = await listRemovableDrives();
  assert.ok(Array.isArray(drives));
});
