'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { reloadLua } = require('../lib/deploy');
const { stringContext, suggestKeywords } = require('../lib/cmdContext');

test('reloadLua imports the library form and calls the slot', () => {
  assert.strictEqual(reloadLua('My"Plugin', 7), 'Cmd("Import Plugin Library \\"MyPlugin\\" At Plugin 7 /nc")\nCmd("Call Plugin 7")\n');
  assert.throws(() => reloadLua('x', 'a;b'), /number/);
});

test('stringContext recognises the Cmd string and ignores other strings and comments', () => {
  assert.deepStrictEqual(stringContext('Cmd("Go+ Exec'), { inCmd: true, text: 'Go+ Exec', quote: '"', call: 'Cmd' });
  assert.deepStrictEqual(stringContext("CmdIndirect( 'Store "), { inCmd: true, text: 'Store ', quote: "'", call: 'CmdIndirect' });
  assert.deepStrictEqual(stringContext('Printf("Go'), { inCmd: false, text: 'Go', quote: '"', call: 'Printf' });
  assert.strictEqual(stringContext('Cmd("Go+")'), null);
  assert.strictEqual(stringContext('-- Cmd("Go'), null);
});

test('suggestKeywords orders verbs, objects and modifiers by position', () => {
  const first = (t) => suggestKeywords(t).find((k) => k.rank === 0).kind;
  assert.strictEqual(first(''), 'verb');
  assert.strictEqual(first('Go+ '), 'object');
  assert.strictEqual(first('Fixture 1 '), 'modifier');
  assert.strictEqual(first('Store Sequence 1 Cue 3 '), 'modifier');
});

test('object tree: listLua builds an index path and parseList decodes the bridge return', () => {
  const { listLua, parseList, unquote } = require('../lib/objectTree');
  assert.match(listLua([14, 14, 'x', -1]), /ipairs\(\{14, 14\}\)/);
  const q = '"total=2 ;; 1|3|14.1|ShowData|Show \\"A\\" ;; 2|0|14.2|Pool|Plain"';
  const bs = String.fromCharCode(92);
  assert.strictEqual(unquote(`"a${bs}${String.fromCharCode(10)}b"`), 'a\nb');
  assert.deepStrictEqual(parseList([q]), {
    total: 2,
    items: [
      { index: 1, count: 3, addr: '14.1', cls: 'ShowData', name: 'Show "A"' },
      { index: 2, count: 0, addr: '14.2', cls: 'Pool', name: 'Plain' },
    ],
  });
  assert.deepStrictEqual(parseList([]), { total: 0, items: [] });
});

test('manifest schema: context and problems', () => {
  const { contextAt, schemaProblems } = require('../lib/manifestSchema');
  const doc = '<GMA3 DataVersion="2.0.0.0">\n\t<Plugin Name="X" Version="0.1.0">\n\t\t';
  assert.deepStrictEqual(contextAt(doc + '<Comp'), { kind: 'element', parent: 'Plugin', partial: 'Comp' });
  assert.deepStrictEqual(contextAt(doc + '<ComponentLua Name="a" Fi'), { kind: 'attribute', element: 'ComponentLua', used: ['Name'], partial: 'Fi' });
  assert.deepStrictEqual(contextAt('<GMA3 DataVersion="2.'), { kind: 'value', element: 'GMA3', attr: 'DataVersion', partial: '2.' });
  assert.strictEqual(contextAt('<GMA3 DataVersion="1">').kind, 'text');
  const good = '<?xml version="1.0"?>\n<GMA3 DataVersion="2.0.0.0">\n<Plugin Name="X" Version="0.1.0">\n<ComponentLua Name="X" FileName="X.lua" />\n</Plugin>\n</GMA3>';
  assert.deepStrictEqual(schemaProblems(good), []);
  const bad = good.replace('Version="0.1.0"', 'Versoin="1"').replace('<ComponentLua', '<Component').replace('DataVersion="2.0.0.0"', 'DataVersion="2"');
  assert.deepStrictEqual(schemaProblems(bad).map((p) => p.message.split(' ')[0]), ['DataVersion', 'Unknown', 'Unknown']);
});

test('show cache: parse the bridge return and suggest objects after a pool keyword', () => {
  const { parseShow, showSuggestions, showLua } = require('../lib/showCache');
  const show = parseShow(['"Group|1|Front ;; Group|19|Back|Linear ;; Preset|2.5|Warm"']);
  assert.deepStrictEqual(show.Group, [{ no: '1', name: 'Front' }, { no: '19', name: 'Back|Linear' }]);
  assert.deepStrictEqual(showSuggestions('Store group ', show).map((o) => o.no), ['1', '19']);
  assert.deepStrictEqual(showSuggestions('Preset ', show), [{ kind: 'Preset', no: '2.5', name: 'Warm' }]);
  assert.deepStrictEqual(showSuggestions('Go+ ', show), []);
  assert.deepStrictEqual(showSuggestions('Group ', null), []);
  assert.match(showLua(), /d\.Groups/);
});

test('release: bumpVersion resets lower parts and rejects bad input', () => {
  const { bumpVersion } = require('../lib/release');
  const xml = '<GMA3><Plugin Name="X" Version="1.2.3"><ComponentLua Name="X" FileName="X.lua" /></Plugin></GMA3>';
  assert.deepStrictEqual(bumpVersion(xml, 'minor').to, '1.3.0');
  assert.deepStrictEqual(bumpVersion(xml, 'major').to, '2.0.0');
  assert.match(bumpVersion(xml, 'patch').xml, /Version="1.2.4"/);
  assert.throws(() => bumpVersion(xml, 'huge'), /major, minor or patch/);
  assert.throws(() => bumpVersion('<GMA3><Plugin Name="X"></Plugin></GMA3>', 'patch'), /No <Plugin/);
});

test('release: zip entries read back with the right names, bytes and crc', () => {
  const zlib = require('zlib');
  const { zip, crc32 } = require('../lib/release');
  assert.strictEqual(crc32(Buffer.from('123456789')), 0xcbf43926);
  const files = [{ name: 'a.lua', data: Buffer.from('return 1;'.repeat(50)) }, { name: 'b.xml', data: Buffer.from('<GMA3/>') }];
  const buf = zip(files);
  const eocd = buf.length - 22;
  assert.strictEqual(buf.readUInt32LE(eocd), 0x06054b50);
  assert.strictEqual(buf.readUInt16LE(eocd + 10), 2);
  let p = buf.readUInt32LE(eocd + 16);
  files.forEach((f) => {
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    assert.strictEqual(buf.toString('utf8', p + 46, p + 46 + nameLen), f.name);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = zlib.inflateRawSync(buf.subarray(dataStart, dataStart + csize));
    assert.deepStrictEqual(raw, f.data);
    assert.strictEqual(buf.readUInt32LE(p + 16), crc32(f.data));
    p += 46 + nameLen;
  });
});

test('live names: contexts, guards and parsers', () => {
  const l = require('../lib/liveNames');
  assert.deepStrictEqual(l.enumContext('local m = Enums.Tim'), { kind: 'enums', partial: 'Tim' });
  assert.deepStrictEqual(l.enumContext('x = Enums.'), { kind: 'enums', partial: '' });
  assert.deepStrictEqual(l.enumContext('Enums.TimerMode.Co'), { kind: 'members', name: 'TimerMode', partial: 'Co' });
  assert.strictEqual(l.enumContext('MyEnums.X'), null);
  assert.throws(() => l.enumMembersLua('x;os.exit()'), /Not an enum name/);
  assert.match(l.enumMembersLua('YesNo'), /Enums\.YesNo/);
  assert.deepStrictEqual(l.parseNames(['"A,B,C"']), ['A', 'B', 'C']);
  assert.deepStrictEqual(l.parseNames(['""']), []);
  assert.deepStrictEqual(l.parseMembers(['"Countdown=0,Stopwatch=1"']), [{ name: 'Countdown', value: '0' }, { name: 'Stopwatch', value: '1' }]);
  const sc = require('../lib/cmdContext').stringContext;
  assert.ok(l.attributeContext(sc('GetAttributeIndex("Di')));
  assert.ok(l.attributeContext(sc('Cmd("Attribute Di')));
  assert.ok(!l.attributeContext(sc('Cmd("Go+ Di')));
  assert.ok(!l.attributeContext(sc('Printf("Attribute Di')));
});
