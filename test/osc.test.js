'use strict';
const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const { encodeMessage, decodeMessage, commandAddress, sendCommands, oscStatusLua, oscSetupLua, parseOscStatus } = require('../lib/osc');

test('encode follows the OSC 1.0 layout: padded strings, big-endian numbers', () => {
  const m = encodeMessage('/cmd', ['Go+']);
  assert.strictEqual(m.length % 4, 0);
  // "/cmd\0\0\0\0" ",s\0\0" "Go+\0"
  assert.deepStrictEqual([...m], [...Buffer.from('/cmd\0\0\0\0,s\0\0Go+\0')]);
  const n = encodeMessage('/x', [7, 1.5, true]);
  assert.deepStrictEqual(decodeMessage(n), { address: '/x', args: [7, 1.5, true] });
  assert.throws(() => encodeMessage('cmd', []), /starts with/);
  assert.throws(() => encodeMessage('/cmd', ['a\0b']), /NUL/);
});

test('strings whose length is a multiple of 4 still get a NUL terminator', () => {
  const m = encodeMessage('/cmd', ['abcd']);
  assert.strictEqual(m.length, 8 + 4 + 8);
  assert.deepStrictEqual(decodeMessage(m), { address: '/cmd', args: ['abcd'] });
});

test('commandAddress honours an OSC line prefix', () => {
  assert.strictEqual(commandAddress(), '/cmd');
  assert.strictEqual(commandAddress('gma3'), '/gma3/cmd');
  assert.strictEqual(commandAddress('/a/b/'), '/a/b/cmd');
});

test('sendCommands delivers one datagram per command, in order, with the gap between them', async () => {
  const server = dgram.createSocket('udp4');
  const got = [];
  await new Promise((r) => server.bind(0, '127.0.0.1', r));
  server.on('message', (m) => got.push({ at: Date.now(), ...decodeMessage(m) }));
  try {
    const port = server.address().port;
    const t0 = Date.now();
    const n = await sendCommands(['Go+ Executor 1', 'Label Macro 3 "x y"'], { port, prefix: 'gma3', gapMs: 120 });
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(n, 2);
    assert.deepStrictEqual(got.map((g) => [g.address, g.args]), [['/gma3/cmd', ['Go+ Executor 1']], ['/gma3/cmd', ['Label Macro 3 "x y"']]]);
    assert.ok(got[1].at - got[0].at >= 100 && got[1].at - t0 >= 120);
    await assert.rejects(() => sendCommands(['a\nb'], { port }), /One command per message/);
  } finally {
    server.close();
  }
});

test('status and setup Lua, and parsing of the status line', () => {
  assert.match(oscStatusLua(), /ENABLEINPUT/);
  const setup = oscSetupLua();
  assert.ok(setup.indexOf("'No'") < setup.indexOf('127.0.0.0/8') && setup.indexOf('127.0.0.0/8') < setup.indexOf("'Yes'"), 'toggle off, set range, toggle on');
  assert.match(setup, /RECEIVECOMMAND/);
  assert.throws(() => oscSetupLua("1'; os.exit() --"), /Not an IP range/);
  assert.deepStrictEqual(parseOscStatus(['"false|10.0.0.0/8|0.0|8000|false|"']), { enabled: false, preferredIp: '10.0.0.0/8', interface: '0.0', port: 8000, receiveCommand: false, prefix: '', ready: false });
  assert.strictEqual(parseOscStatus(['"true|127.0.0.0/8|127.0.0.1|8000|true|gma3"']).ready, true);
  assert.strictEqual(parseOscStatus(['"true|127.0.0.0/8|0.0|8000|true|"']).ready, true, 'INTERFACE 0.0 does not mean closed');
  assert.strictEqual(parseOscStatus(['"true|127.0.0.0/8|0.0|8000|false|"']).ready, false);
  assert.strictEqual(parseOscStatus(['"false|127.0.0.0/8|0.0|8000|true|"']).ready, false);
  assert.strictEqual(parseOscStatus([]), null);
});
