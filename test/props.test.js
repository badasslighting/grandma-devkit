'use strict';
const test = require('node:test');
const assert = require('node:assert');
const p = require('../lib/props');

test('ma3Props: a class gets its own properties plus the common ones, without duplicates', () => {
  const props = p.ma3Props('DataPools');
  const names = props.map((x) => x.name);
  assert.ok(names.includes('NAME') && names.includes('INDEX'), 'common properties are included');
  assert.strictEqual(new Set(names).size, names.length);
  assert.deepStrictEqual(p.ma3Props('NoSuchClass').map((x) => x.name), p.ma3Props('MessageCenter').map((x) => x.name));
  const lock = p.ma3Props('Pool').find((x) => x.name === 'LOCK');
  assert.deepStrictEqual({ type: lock.type, readOnly: lock.readOnly, enumName: lock.enumName }, { type: 'UInt64', readOnly: false, enumName: 'YesNo' });
});

test('enumValues and valueCandidates map a property to its enum members', () => {
  const yn = p.enumValues('YesNo').map((v) => v.name);
  assert.ok(yn.includes('Yes') && yn.includes('No'));
  assert.deepStrictEqual(p.valueCandidates('LOCK').map((v) => v.name).sort(), yn.slice().sort());
  assert.deepStrictEqual(p.valueCandidates('NAME'), [], 'a free-text property has no values');
});

test('propContext finds names and values inside Get/Set calls', () => {
  assert.deepStrictEqual(p.propContext('local v = obj:Get("Na'), { kind: 'name', partial: 'Na', segments: null });
  assert.deepStrictEqual(p.propContext("Set(h, 'LO"), { kind: 'name', partial: 'LO', segments: null });
  assert.deepStrictEqual(p.propContext('Root().ShowData.DataPools[1]:Get("'), { kind: 'name', partial: '', segments: ['ShowData', 'DataPools', 1] });
  assert.deepStrictEqual(p.propContext('obj:Set("LOCK", "Y'), { kind: 'value', prop: 'LOCK', partial: 'Y', segments: null });
  assert.deepStrictEqual(p.propContext('Cmd("Go Sequence 1'), null);
  assert.strictEqual(p.propContext('obj:Get("Name") + x'), null);
});

test('propAt returns the property name only while the cursor is on it', () => {
  const line = 'local n = o:Get("NAME", Enums.Roles.Display)';
  const at = line.indexOf('NAME');
  assert.strictEqual(p.propAt(line, at + 2).name, 'NAME');
  assert.strictEqual(p.propAt(line, 3), null);
  assert.strictEqual(p.propAt('print("NAME")', 8), null, 'only property accessors count');
});

test('nameCandidates narrows to a class and falls back to every name', () => {
  assert.ok(p.nameCandidates('').length > p.nameCandidates('DataPools').length);
  assert.ok(p.nameCandidates('').some((x) => x.name === 'NAME'));
});

test('ma2Props lists the property names of a grandMA2 class', () => {
  assert.ok(p.ma2Props('MidiConfig').some((x) => x.name === 'SendTimecode'));
  assert.deepStrictEqual(p.ma2Props('NoSuchClass'), []);
  assert.deepStrictEqual(p.ma2Props('KinetData').map((x) => x.name), ['Valid', 'LocalStart', 'Amount', 'ExternStart', 'IPAddress', 'Info'], 'table-style rows get their names from the list header');
  assert.ok(p.ma2Props('Surface').length > 20);
  assert.ok(p.ma2Props('TIMECONFIG').some((x) => x.name === 'Regard Daylight Saving' && x.type === 'On/Off'), 'the console class from the object browser finds the property list');
  assert.deepStrictEqual(p.ma2Props('CMD_GEL_POOL').map((x) => x.name), ['No.', 'Name']);
  assert.deepStrictEqual(p.ma2Props('SETTINGS_COLLECT'), [], 'a pure container has no properties');
});

test('propValuesLua and parsePropValues round trip the console reply', () => {
  assert.match(p.propValuesLua([14, 14, 'x', -1]), /ipairs\(\{14, 14\}\)/);
  assert.match(p.pathClassLua(['ShowData', 'DataPools', 1]), /"ShowData", "DataPools", 1/);
  assert.throws(() => p.pathClassLua(['bad"name']));
  // the shape the bridge really returns: a Lua %q string, tabs as \9 (\009 before a digit), newlines as backslash-newline
  const reply = '"Pool @@ NAME\\9String\\0090\\9\\9Pool 1 \'Default\'\\\nLOCK\\9UInt64\\0090\\9YesNo\\9No"';
  assert.deepStrictEqual(p.parsePropValues([reply]), {
    cls: 'Pool',
    props: [
      { name: 'NAME', type: 'String', readOnly: false, enumName: '', value: "Pool 1 'Default'" },
      { name: 'LOCK', type: 'UInt64', readOnly: false, enumName: 'YesNo', value: 'No' },
    ],
  });
  assert.strictEqual(p.parseClass(['"Pool"']), 'Pool');
});

test('the bundled data has no station-specific strings', () => {
  const text = JSON.stringify(require('../data/props.json'));
  assert.doesNotMatch(text, /\b\d{1,3}(\.\d{1,3}){3}\b|([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/);
});

test('grandMA2 properties: On/Off and Yes/No list their values, observed samples are marked e.g.', () => {
  const rows = p.ma2Props('TimeConfig');
  const onOff = rows.find((p) => p.type === 'On/Off');
  assert.deepStrictEqual(onOff.values, ['On', 'Off']);
  assert.strictEqual(p.ma2ValuesText(onOff), 'On, Off');
  const yesNo = p.ma2Props('Stations').find((p) => p.type === 'Yes/No');
  if (yesNo) assert.strictEqual(p.ma2ValuesText(yesNo), 'Yes, No');
  const sample = p.ma2Props('LayoutElementDefaults').find((p) => p.name === 'FontSize');
  assert.strictEqual(p.ma2ValuesText(sample), 'Default, Small, Big'); // confirmed on a console: the three font sizes
  const symbol = p.ma2Props('LayoutElementDefaults').find((x) => x.name === 'Symbol');
  assert.strictEqual(p.ma2ValuesText(symbol), 'e.g. Small, Big'); // only two of three values known
  assert.strictEqual(p.ma2ValuesText(p.ma2Props('LayoutElementDefaults').find((x) => x.name === 'BackgroundColor')), ''); // an RGB colour, not a list
  assert.strictEqual(p.ma2ValuesText(rows.find((p) => p.type === 'text')), '');
  assert.match(p.propsMarkdown('TimeConfig', rows), /\| RegardDaylightSaving \| On\/Off \| On, Off \|/);
});
