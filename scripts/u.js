const fs = require('fs');
let t = fs.readFileSync('test/usb.test.js', 'utf8');
const rep = (a, b) => { if (!t.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); t = t.replace(a, b); };
rep(`test('usbTarget uses the library folders the consoles read', () => {
  assert.strictEqual(usbTarget('E:\\', false), path.join('E:\\', 'gma3_library', 'datapools', 'plugins'));
  assert.strictEqual(usbTarget('/Volumes/STICK', true), path.join('/Volumes/STICK', 'gma2', 'plugins'));
});`, `test('usbTarget follows the library layout already on the stick', () => {
  const has = (...present) => (p) => present.some((x) => p === path.join('S', ...x));
  const plugins = ['datapools', 'plugins'];
  assert.strictEqual(usbTarget('S', false, has(['grandMA3', 'gma3_library'])), path.join('S', 'grandMA3', 'gma3_library', ...plugins), 'a console-formatted stick');
  assert.strictEqual(usbTarget('S', false, has(['gma3_library'])), path.join('S', 'gma3_library', ...plugins), 'a plain library at the root');
  assert.strictEqual(usbTarget('S', false, has()), path.join('S', 'grandMA3', 'gma3_library', ...plugins), 'a blank stick gets the console layout');
  assert.strictEqual(usbTarget('S', true, has()), path.join('S', 'gma2', 'plugins'));
});`);
rep("assert.ok(fs.existsSync(path.join(stick, 'gma3_library', 'datapools', 'plugins', 'Demo3.xml')));\n  assert.ok(fs.existsSync(path.join(stick, 'gma3_library', 'datapools', 'plugins', 'Demo3.lua')));", "const plugins3 = path.join(stick, 'grandMA3', 'gma3_library', 'datapools', 'plugins');\n  assert.ok(fs.existsSync(path.join(plugins3, 'Demo3.xml')));\n  assert.ok(fs.existsSync(path.join(plugins3, 'Demo3.lua')));");
fs.writeFileSync('test/usb.test.js', t);
