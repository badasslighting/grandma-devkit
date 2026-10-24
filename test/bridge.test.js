'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bridge = require('../lib/bridge');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ma3bridge-'));
const beat = (dir, ageS = 0) => fs.writeFileSync(path.join(dir, 'heartbeat.txt'), `inst1 ${Date.now() / 1000 - ageS}`);

// Stands in for the console plugin: answers each request.txt with the reply the handler returns.
function fakePlugin(dir, handler) {
  const timer = setInterval(() => {
    const req = path.join(dir, 'request.txt');
    if (!fs.existsSync(req)) return;
    const text = fs.readFileSync(req, 'utf8');
    fs.unlinkSync(req);
    const nl = text.indexOf('\n');
    const head = Object.fromEntries(text.slice(0, nl).split(' ').map((kv) => kv.split('=')));
    fs.writeFileSync(path.join(dir, 'response.json'), JSON.stringify({ id: head.id, ...handler(head, text.slice(nl + 1)) }));
  }, 10);
  return () => clearInterval(timer);
}

test('status reports running, stale and missing heartbeats', () => {
  const dir = tmpDir();
  assert.strictEqual(bridge.status(dir).running, false);
  assert.match(bridge.status(dir).reason, /no heartbeat/);
  beat(dir, 0.5);
  assert.strictEqual(bridge.status(dir).running, true);
  beat(dir, 30);
  assert.strictEqual(bridge.status(dir).running, false);
  fs.writeFileSync(path.join(dir, 'heartbeat.txt'), 'inst1 notanumber');
  assert.strictEqual(bridge.status(dir).running, false);
});

test('run sends the request header and code, returns the matching response', async () => {
  const dir = tmpDir();
  beat(dir);
  let seen;
  const stopPlugin = fakePlugin(dir, (head, code) => {
    seen = { head, code };
    return { ok: true, returns: ['42'], output: ['hi'], cpu_ms: 1 };
  });
  try {
    const r = await bridge.run(dir, 'return 6*7', 3);
    assert.deepStrictEqual([r.ok, r.returns], [true, ['42']]);
    assert.strictEqual(seen.head.op, 'run');
    assert.strictEqual(seen.head.timeout, '3');
    assert.strictEqual(seen.code, 'return 6*7');
    assert.ok(!fs.existsSync(path.join(dir, 'request.tmp')), 'temp request is renamed away');
  } finally {
    stopPlugin();
  }
});

test('run ignores a response left over from an earlier request', async () => {
  const dir = tmpDir();
  beat(dir);
  fs.writeFileSync(path.join(dir, 'response.json'), JSON.stringify({ id: 'old', ok: true, returns: ['stale'] }));
  const stopPlugin = fakePlugin(dir, () => ({ ok: true, returns: ['fresh'] }));
  try {
    assert.deepStrictEqual((await bridge.run(dir, '1')).returns, ['fresh']);
  } finally {
    stopPlugin();
  }
});

test('reset and stop send their ops with no code', async () => {
  const dir = tmpDir();
  beat(dir);
  const ops = [];
  const stopPlugin = fakePlugin(dir, (head, code) => {
    ops.push([head.op, code]);
    return { ok: true };
  });
  try {
    await bridge.reset(dir);
    await bridge.stop(dir);
    assert.deepStrictEqual(ops, [['reset', ''], ['stop', '']]);
  } finally {
    stopPlugin();
  }
});

test('send refuses when the plugin is not running and writes no request', async () => {
  const dir = tmpDir();
  await assert.rejects(() => bridge.run(dir, '1'), /isn't running/);
  assert.ok(!fs.existsSync(path.join(dir, 'request.txt')));
  beat(dir, 30);
  await assert.rejects(() => bridge.run(dir, '1'), /isn't running/);
  await assert.rejects(() => bridge.run('', '1'), /No bridge folder/);
});

test('send times out when nothing answers', async () => {
  const dir = tmpDir();
  beat(dir);
  const orig = Date.now;
  let skew = 0;
  Date.now = () => orig() + skew; // jump past the deadline instead of waiting 5 s
  const pending = bridge.run(dir, 'while true do end', 0.1);
  skew = 60000;
  try {
    await assert.rejects(() => pending, /No response within/);
  } finally {
    Date.now = orig;
  }
});

test('formatResult shows output, returns, errors and cpu time', () => {
  assert.strictEqual(
    bridge.formatResult({ ok: true, returns: ['1', '"a"'], output: ['x', 'y'], cpu_ms: 3 }),
    'output:\n  x\n  y\nreturns: 1, "a"\ncpu_ms: 3'
  );
  assert.strictEqual(bridge.formatResult({ ok: true, returns: [], cpu_ms: 0 }), 'returns: (nothing)\ncpu_ms: 0');
  assert.strictEqual(bridge.formatResult({ ok: false, error: 'bridge:2: boom', cpu_ms: 1 }), 'error: bridge:2: boom\ncpu_ms: 1');
});

test('errorLine maps a bridge chunk error to a zero-based editor line', () => {
  assert.strictEqual(bridge.errorLine('bridge:3: attempt to call a nil value'), 2);
  assert.strictEqual(bridge.errorLine('bridge:1: x', 10), 10);
  assert.strictEqual(bridge.errorLine('other:3: x'), null);
  assert.strictEqual(bridge.errorLine(undefined), null);
});

test('defaultBridgeDir honours the env override and the ProgramData default', () => {
  assert.strictEqual(bridge.defaultBridgeDir({ MA3_LUABRIDGE_DIR: 'X:\\b' }, 'win32'), 'X:\\b');
  assert.strictEqual(bridge.defaultBridgeDir({ ProgramData: 'C:\\PD' }, 'win32'), path.join('C:\\PD', 'MA3', 'luabridge'));
  assert.strictEqual(bridge.defaultBridgeDir({}, 'linux'), '');
});
