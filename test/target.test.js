'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detectTarget, detectTargetForFile, manifestXmlFor, fromFolder, fromApiNames } = require('../lib/target');

const win = (p) => p.split('/').join(String.fromCharCode(92));
const MA2_XML = '<?xml version="1.0"?>\n<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" major_vers="3">\n<Plugin name="P" luafile="P.lua" />\n</MA>';
const MA3_XML = '<?xml version="1.0"?>\n<GMA3 DataVersion="2.0.0.0">\n<UserPlugin Name="P"><ComponentLua FileName="P.lua" /></UserPlugin>\n</GMA3>';

test('target (a): the setting overrides every other signal', () => {
  assert.strictEqual(detectTarget('Printf("x")', 'ma2', MA3_XML, win('C:/grandMA3/p.lua')), 'ma2');
  assert.strictEqual(detectTarget('gma.cmd("x")', 'ma3', MA2_XML, win('C:/grandMA2/p.lua')), 'ma3');
  assert.strictEqual(detectTarget('gma.cmd("x")', 'auto'), 'ma2');
  assert.strictEqual(detectTarget('gma.cmd("x")', 'nonsense'), 'ma2');
});

test('target (b): the manifest format decides, and beats folder and API names', () => {
  assert.strictEqual(detectTarget('return 1', 'auto', MA2_XML), 'ma2');
  assert.strictEqual(detectTarget('return 1', 'auto', MA3_XML), 'ma3');
  assert.strictEqual(detectTarget('Printf("x")', 'auto', MA2_XML), 'ma2');
  assert.strictEqual(detectTarget('gma.cmd("x")', 'auto', MA3_XML), 'ma3');
  assert.strictEqual(detectTarget('x', 'auto', MA3_XML, '/work/grandMA2/p.lua'), 'ma3');
  assert.strictEqual(detectTarget('gma.cmd("x")', 'auto', '<unknown/>'), 'ma2');
});

test('target (c): folder hints, nearest directory first, whole words only', () => {
  assert.strictEqual(fromFolder(win('C:/Users/me/grandMA2/plugins/x.lua')), 'ma2');
  assert.strictEqual(fromFolder('/home/me/gma2/x.lua'), 'ma2');
  assert.strictEqual(fromFolder('/repo/MA2/CTC/x.lua'), 'ma2');
  assert.strictEqual(fromFolder('/repo/ma2-ctc/x.lua'), 'ma2');
  assert.strictEqual(fromFolder('/repo/GrandMA3/x.lua'), 'ma3');
  assert.strictEqual(fromFolder('/repo/gma3/x.lua'), 'ma3');
  assert.strictEqual(fromFolder('/repo/grandma2/sub/grandma3/x.lua'), 'ma3');
  assert.strictEqual(fromFolder('/repo/grandma3/sub/gma2/x.lua'), 'ma2');
  assert.strictEqual(fromFolder('/repo/ma2-to-ma3/x.lua'), null);
  assert.strictEqual(fromFolder('/repo/grandma2/ma2-to-ma3/x.lua'), 'ma2');
  assert.strictEqual(fromFolder('/repo/gma22/ma20/x.lua'), null);
  assert.strictEqual(fromFolder('/repo/grandma-devkit/x.lua'), null);
  assert.strictEqual(fromFolder('/repo/ma2.lua'), null, 'the file name is not a folder');
  assert.strictEqual(fromFolder(''), null);
  assert.strictEqual(detectTarget('Printf("x")', 'auto', '', '/repo/grandMA2/x.lua'), 'ma2');
  assert.strictEqual(detectTarget('Printf("x")', 'auto', '', '/repo/grandMA3/x.lua'), 'ma3');
  assert.strictEqual(detectTarget('gma.cmd("x")', 'auto', '', '/repo/grandMA3/x.lua'), 'ma3', 'folder beats API names');
  assert.strictEqual(detectTarget('Cmd("x")', 'auto', '', '/repo/ma2/x.lua'), 'ma2');
});

test('target (d): API names unique to one console', () => {
  assert.strictEqual(detectTarget('Cmd("[x] Go+")'), 'ma3');
  assert.strictEqual(detectTarget('gma.show.getvar("X")'), 'ma2');
  assert.strictEqual(detectTarget('local n = gma . gui . msgbox("a", "b")'), 'ma2');
  assert.strictEqual(fromApiNames('Printf("x")'), 'ma3');
  assert.strictEqual(fromApiNames('return 1'), null);
  // comments and strings do not count
  assert.strictEqual(fromApiNames('-- gma.cmd("x")\nlocal s = "gma.x"'), null);
  assert.strictEqual(fromApiNames('--[[ Printf("x") ]]'), null);
  // member accesses are not global calls
  assert.strictEqual(fromApiNames('local t = {}\nt.Printf("x")\nt:Cmd("x")'), null);
  // ambiguous names (a global that is also an object method) count for neither
  assert.strictEqual(fromApiNames('local a = ToAddr(h)\nExport("x")'), null);
  // a name the file defines itself is the file's own, not the console's
  assert.strictEqual(fromApiNames('local function Printf(s) end\nPrintf("x")'), null);
  assert.strictEqual(fromApiNames('Echo = function(s) end\nEcho("x")'), null);
  // object methods are not counted
  assert.strictEqual(fromApiNames('local c = obj:Count()'), null);
});

test('target: conflicting API names resolve by distinct-name count, a tie goes to grandMA2', () => {
  assert.strictEqual(detectTarget('gma.cmd("x")\nPrintf("y")'), 'ma2');
  assert.strictEqual(detectTarget('gma.cmd("x")\nPrintf("y")\nCmd("z")'), 'ma3');
  assert.strictEqual(detectTarget('gma.cmd("x")\ngma.echo("y")\nPrintf("y")'), 'ma2');
  // the same name repeated counts once
  assert.strictEqual(detectTarget('gma.cmd("x")\nPrintf("a")\nPrintf("b")\nPrintf("c")'), 'ma2');
});

test('target (e): no signal means grandMA3', () => {
  assert.strictEqual(detectTarget(''), 'ma3');
  assert.strictEqual(detectTarget(undefined), 'ma3');
  assert.strictEqual(detectTarget('return 1', 'auto', '', '/plain/dir/x.lua'), 'ma3');
});

test('target: a bracket Cmd in an MA2 file without gma calls follows the manifest or folder', () => {
  const code = 'return function() Cmd("[$x == 1] Go+") end';
  assert.strictEqual(detectTarget(code, 'auto', MA2_XML), 'ma2');
  assert.strictEqual(detectTarget(code, 'auto', '', win('C:/plugins/grandMA2/p.lua')), 'ma2');
});

test('target: aliasing a gma. function (the grandMA2 idiom) does not make the alias a grandMA3 global', () => {
  const alias = 'local Echo = gma.echo; local Printf = gma.echo; Echo(1) Printf(2)';
  assert.strictEqual(fromApiNames(alias), 'ma2');
  assert.strictEqual(fromApiNames('Echo = gma.echo\nPrintf = gma.feedback\nEcho(1) Printf(2)'), 'ma2');
  assert.strictEqual(fromApiNames('local Printf = gma . gui . msg\nPrintf("x")'), 'ma2');
  // the alias only counts for the names it defines; a == comparison and a field assignment define nothing
  assert.strictEqual(fromApiNames('local Echo = gma.echo\nPrintf(1) Cmd("x")'), 'ma3');
  assert.strictEqual(fromApiNames('if Printf == gma.echo then end Printf(1) Cmd("x")'), 'ma3');
  assert.strictEqual(detectTarget(alias, 'auto'), 'ma2');
});

test('target: the manifest that lists the file beats gma. calls, as the extension wires it', () => {
  const entries = [{ xml: MA2_XML, names: ['other.lua'] }, { xml: MA3_XML, names: ['p.lua'] }];
  const gma = 'gma.cmd("x") gma.echo("y")';
  assert.strictEqual(manifestXmlFor(entries, win('C:/plugins/P.lua')), MA3_XML, 'matched by file name, case-insensitive');
  assert.strictEqual(manifestXmlFor(entries, '/plugins/nope.lua'), '');
  assert.strictEqual(manifestXmlFor([], '/plugins/p.lua'), '');
  assert.strictEqual(detectTargetForFile(gma, 'auto', '/plugins/p.lua', entries), 'ma3', 'manifest says ma3 despite gma.');
  assert.strictEqual(detectTargetForFile('Printf("x")', 'auto', '/plugins/other.lua', entries), 'ma2', 'manifest says ma2 despite Printf');
  assert.strictEqual(detectTargetForFile(gma, 'auto', '/plugins/nope.lua', entries), 'ma2', 'no manifest lists it: API names');
  assert.strictEqual(detectTargetForFile(gma, 'ma3', '/plugins/other.lua', entries), 'ma3', 'the setting still wins');
});
