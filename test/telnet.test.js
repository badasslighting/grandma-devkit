'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { ConsoleTelnet, createParser, parseErrors, openSession, listen, IAC, DO, WILL, WONT, DONT } = require('../lib/telnet');

test('parser refuses options, drops negotiation bytes, keeps text and literal 255 across chunks', () => {
  const p = createParser();
  const a = p.feed(Buffer.from([IAC, DO, 1, 72, 105, IAC]));
  assert.deepStrictEqual(a.replies, [Buffer.from([IAC, WONT, 1])]);
  assert.strictEqual(a.text, 'Hi');
  const b = p.feed(Buffer.from([WILL, 3, IAC, IAC, 33, IAC, 250, 24, 1, IAC, 240, 79, 75]));
  assert.deepStrictEqual(b.replies, [Buffer.from([IAC, DONT, 3])]);
  assert.strictEqual(b.text, 'ÿ!OK');
});

test('parseErrors finds Error #n lines even behind a prompt', () => {
  assert.deepStrictEqual(parseErrors(['[Fixture]>Error #1: UNKNOWN COMMAND', 'fine', 'Error #21: NO OBJECTS FOUND ']), [
    { code: 1, message: 'UNKNOWN COMMAND' },
    { code: 21, message: 'NO OBJECTS FOUND' },
  ]);
});

// A stand-in console: negotiates, prints a guest banner, accepts Login "administrator" "secret".
function fakeConsole() {
  const received = [];
  const negotiated = [];
  const server = net.createServer((socket) => {
    socket.on('error', () => {}); // the client destroys its end; a reset here is expected
    socket.write(Buffer.from([IAC, DO, 1, IAC, WILL, 3]));
    socket.write("grandMA2 onPC\r\nLogged in as User 'guest'\r\nPlease login !\r\n");
    let buf = '';
    const parser = createParser();
    socket.on('data', (d) => {
      if (d[0] === IAC) negotiated.push([...d].slice(0, 3));
      buf += parser.feed(d).text;
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!line.trim() || /^.{0,3}$/.test(line)) continue;
        received.push(line);
        if (line === 'Login "administrator" "secret"') socket.write("Logged in as User 'administrator'\r\n");
        else if (line.startsWith('Login')) socket.write("Logged in as User 'guest'\r\nPlease login !\r\n");
        else if (line === 'Bad cmd') socket.write('Error #1: UNKNOWN COMMAND\r\n');
        else if (line === 'List') socket.write('one\r\ntwo\r\n');
        else socket.write('OK\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received, negotiated })));
}

test('login, send and collect against a fake console; errors are parsed; commands are spaced', async () => {
  const { server, port, received, negotiated } = await fakeConsole();
  try {
    const t0 = Date.now();
    const c = await openSession({ port, user: 'administrator', password: 'secret', gapMs: 120 });
    assert.ok(negotiated.length >= 1, 'refused the options');
    const ok = await c.send('Go+ Executor 1', { quietMs: 120 });
    assert.deepStrictEqual(ok, { lines: ['OK'], errors: [] });
    const list = await c.send('List', { quietMs: 120 });
    assert.deepStrictEqual(list.lines, ['one', 'two']);
    const bad = await c.send('Bad cmd', { quietMs: 120 });
    assert.deepStrictEqual(bad.errors, [{ code: 1, message: 'UNKNOWN COMMAND' }]);
    assert.deepStrictEqual(received, ['Login "administrator" "secret"', 'Go+ Executor 1', 'List', 'Bad cmd']);
    assert.ok(Date.now() - t0 >= 3 * 120, 'commands were spaced by the gap');
    await assert.rejects(() => c.send('a\r\nb'), /One command per call/);
    c.close();
  } finally {
    server.close();
  }
});

test('a wrong password is reported, and quotes in credentials are refused before anything is sent', async () => {
  const { server, port, received } = await fakeConsole();
  try {
    await assert.rejects(() => openSession({ port, user: 'administrator', password: 'nope' }), /login as "administrator" failed \(still "guest"\)/);
    const c = new ConsoleTelnet({ port, user: 'administrator', password: 'a"b' });
    await c.connect();
    await assert.rejects(() => c.login(), /may not contain quotes/);
    c.close();
    assert.ok(!received.some((l) => l.includes('a"b')));
  } finally {
    server.close();
  }
});

test('connection problems give a readable message', async () => {
  const { server, port } = await fakeConsole();
  server.close();
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(() => new ConsoleTelnet({ port }).connect(), /Nothing is listening on 127\.0\.0\.1:/);
});

test('listen streams lines from a monitor port without logging in', async () => {
  const { server, port, received } = await fakeConsole();
  try {
    const lines = [];
    const client = await listen({ port, onLine: (l) => lines.push(l) });
    await new Promise((r) => setTimeout(r, 200));
    client.close();
    assert.ok(lines.includes('grandMA2 onPC'));
    assert.deepStrictEqual(received, []);
  } finally {
    server.close();
  }
});
