'use strict';
const dgram = require('dgram');

// OSC over UDP for the grandMA3 command line. The console runs a message whose address is `/cmd`
// (`/<prefix>/cmd` when the OSC line has a prefix) and whose single argument is a command-line string,
// once OSC input is on, PREFERREDIP matches an interface and the line has RECEIVECOMMAND set. It never
// answers: OSC cannot return values or errors, so Lua that needs results still goes through the bridge.
const pad = (buf) => Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]); // always at least one NUL

function oscString(s) {
  if (String(s).includes('\0')) throw new Error('An OSC string cannot contain a NUL character.');
  return pad(Buffer.from(String(s), 'utf8'));
}

// args: strings, integers, floats and booleans.
function encodeMessage(address, args = []) {
  if (!address.startsWith('/')) throw new Error('An OSC address starts with "/".');
  let tags = ',';
  const parts = [];
  for (const a of args) {
    if (typeof a === 'string') {
      tags += 's';
      parts.push(oscString(a));
    } else if (typeof a === 'boolean') tags += a ? 'T' : 'F';
    else if (Number.isInteger(a)) {
      tags += 'i';
      const b = Buffer.alloc(4);
      b.writeInt32BE(a);
      parts.push(b);
    } else if (typeof a === 'number') {
      tags += 'f';
      const b = Buffer.alloc(4);
      b.writeFloatBE(a);
      parts.push(b);
    } else throw new Error(`Unsupported OSC argument: ${a}`);
  }
  return Buffer.concat([oscString(address), oscString(tags), ...parts]);
}

function decodeMessage(buf) {
  let pos = 0;
  const readString = () => {
    const end = buf.indexOf(0, pos);
    const s = buf.toString('utf8', pos, end);
    pos = (Math.floor(end / 4) + 1) * 4;
    return s;
  };
  const address = readString();
  const tags = readString();
  const args = [];
  for (const t of tags.slice(1)) {
    if (t === 's') args.push(readString());
    else if (t === 'i') {
      args.push(buf.readInt32BE(pos));
      pos += 4;
    } else if (t === 'f') {
      args.push(buf.readFloatBE(pos));
      pos += 4;
    } else if (t === 'T') args.push(true);
    else if (t === 'F') args.push(false);
    else throw new Error(`Unsupported OSC type tag: ${t}`);
  }
  return { address, args };
}

// `/cmd`, or `/<prefix>/cmd` for an OSC line with a prefix.
function commandAddress(prefix = '') {
  const p = String(prefix).replace(/^\/+|\/+$/g, '');
  return p ? `/${p}/cmd` : '/cmd';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends each command as its own datagram, gapMs apart so the console runs them in order. Resolves with
// the number sent. UDP gives no confirmation: a closed or misconfigured port looks exactly like success.
async function sendCommands(commands, { host = '127.0.0.1', port = 8000, prefix = '', gapMs = 250 } = {}) {
  const socket = dgram.createSocket('udp4');
  const address = commandAddress(prefix);
  try {
    let sent = 0;
    for (const cmd of commands) {
      if (/[\r\n]/.test(cmd)) throw new Error('One command per message; split lines first.');
      const msg = encodeMessage(address, [cmd]);
      await new Promise((resolve, reject) => socket.send(msg, port, host, (err) => (err ? reject(err) : resolve())));
      sent++;
      if (sent < commands.length) await sleep(gapMs);
    }
    return sent;
  } finally {
    socket.close();
  }
}

// ---- reading and switching on the console's OSC input, through the LuaBridge

const STATUS_LUA = [
  'local b = Root().ShowData.OSCBase',
  'local l = b[1]',
  "local function v(o, k) return tostring(o:Get(k)) end",
  "return table.concat({v(b, 'ENABLEINPUT'), v(b, 'PREFERREDIP'), v(b, 'INTERFACE'), l and v(l, 'PORT') or '', l and v(l, 'RECEIVECOMMAND') or '', l and v(l, 'PREFIX') or ''}, '|')",
  '',
].join('\n');

function oscStatusLua() {
  return STATUS_LUA;
}

// Switches OSC input on for localhost use and lets line 1 receive commands, then reports the result.
// Setting PREFERREDIP needs input toggled off and on again before the console opens a socket.
function oscSetupLua(preferredIp = '127.0.0.0/8') {
  if (!/^[\d./]+$/.test(preferredIp)) throw new Error(`Not an IP range: ${preferredIp}`);
  return [
    'local b = Root().ShowData.OSCBase',
    "b:Set('ENABLEINPUT', 'No')",
    `b:Set('PREFERREDIP', '${preferredIp}')`,
    "b:Set('ENABLEINPUT', 'Yes')",
    "if b[1] then b[1]:Set('RECEIVECOMMAND', 'Yes') end",
    '',
  ].join('\n') + STATUS_LUA;
}

// The reverse: stops the console listening for OSC and stops line 1 running commands.
function oscDisableLua() {
  return [
    'local b = Root().ShowData.OSCBase',
    "b:Set('ENABLEINPUT', 'No')",
    "if b[1] then b[1]:Set('RECEIVECOMMAND', 'No') end",
    '',
  ].join('\n') + STATUS_LUA;
}

function parseOscStatus(returns) {
  const text = String((returns && returns[0]) || '').replace(/^"|"$/g, '');
  const [enableInput, preferredIp, iface, port, receiveCommand, prefix] = text.split('|');
  if (enableInput === undefined || port === undefined) return null;
  const yes = (s) => s === 'true' || s === 'Yes';
  const status = { enabled: yes(enableInput), preferredIp, interface: iface, port: Number(port) || 8000, receiveCommand: yes(receiveCommand), prefix: prefix || '' };
  // INTERFACE reads 0.0 even while the socket is open, so it is not part of "ready" (checked on onPC 2.5.1).
  status.ready = status.enabled && status.receiveCommand;
  return status;
}

module.exports = { encodeMessage, decodeMessage, commandAddress, sendCommands, oscStatusLua, oscSetupLua, oscDisableLua, parseOscStatus };
