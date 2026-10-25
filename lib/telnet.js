'use strict';
const net = require('net');
const { EventEmitter } = require('events');

// Telnet client for the grandMA2 command line (port 30000) and System Monitor (port 30001).
// What is known about the console end (grandMA2 onPC 3.9.61): it sends Telnet option negotiation, which
// refusing is fine, then an ASCII banner; the session is `guest` until `Login "user" "password"`;
// one command per CR LF line, with a pause between commands; errors come back as `Error #n: TEXT`.
const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

// Strips Telnet commands from the byte stream, refusing every option. State carries across chunks.
function createParser() {
  let state = 'data';
  let verb = 0;
  return {
    feed(chunk) {
      const text = [];
      const replies = [];
      for (const b of chunk) {
        if (state === 'data') {
          if (b === IAC) state = 'iac';
          else text.push(b);
        } else if (state === 'iac') {
          if (b === IAC) {
            text.push(IAC);
            state = 'data';
          } else if (b === DO || b === DONT || b === WILL || b === WONT) {
            verb = b;
            state = 'option';
          } else if (b === SB) state = 'sb';
          else state = 'data';
        } else if (state === 'option') {
          if (verb === DO) replies.push(Buffer.from([IAC, WONT, b]));
          else if (verb === WILL) replies.push(Buffer.from([IAC, DONT, b]));
          state = 'data';
        } else if (state === 'sb') {
          if (b === IAC) state = 'sb-iac';
        } else if (state === 'sb-iac') {
          state = b === SE ? 'data' : 'sb';
        }
      }
      return { text: Buffer.from(text).toString('latin1'), replies };
    },
  };
}

// `Error #n: TEXT` lines in a console reply.
function parseErrors(lines) {
  const out = [];
  for (const line of lines) {
    const m = /Error #(\d+):\s*(.*)$/.exec(line);
    if (m) out.push({ code: Number(m[1]), message: m[2].trim() });
  }
  return out;
}

// The console colours its output with ANSI codes, redraws prompts with carriage returns and echoes
// "Executing : <command>"; keep the last redraw of a line and drop prompt-only lines.
function cleanLine(raw) {
  const text = raw.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  const parts = text.split('\r').map((p) => p.trim()).filter(Boolean);
  const line = parts.length ? parts[parts.length - 1] : '';
  return /^\[[^\]]*\]>$/.test(line) ? '' : line;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD = /[\r\n"]/;

class ConsoleTelnet extends EventEmitter {
  constructor({ host = '127.0.0.1', port = 30000, user = 'administrator', password = '', gapMs = 400, connectTimeoutMs = 3000 } = {}) {
    super();
    Object.assign(this, { host, port, user, password, gapMs, connectTimeoutMs });
    this.socket = null;
    this.parser = createParser();
    this.partial = '';
    this.lastSent = 0;
    this.collect = null;
    this.chain = Promise.resolve();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`No answer from ${this.host}:${this.port}. Is the console running with Telnet (remote command line) enabled?`));
      }, this.connectTimeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.on('error', (err) => {
        if (this.socket) return this.emit('fault', err); // after connecting: the 'close' event follows; never throw
        clearTimeout(timer);
        reject(new Error(err.code === 'ECONNREFUSED' ? `Nothing is listening on ${this.host}:${this.port}. Enable Telnet (remote command line) on the console.` : err.message));
      });
      socket.on('data', (chunk) => this.onData(chunk));
      socket.on('close', () => this.emit('close'));
    });
  }

  onData(chunk) {
    const { text, replies } = this.parser.feed(chunk);
    for (const r of replies) if (this.socket && !this.socket.destroyed) this.socket.write(r);
    if (!text) return;
    const parts = (this.partial + text).split('\n');
    this.partial = parts.pop();
    for (const raw of parts) {
      const line = cleanLine(raw);
      if (line) this.pushLine(line);
    }
    this.emit('partial', this.partial);
  }

  pushLine(line) {
    this.emit('line', line);
    if (this.collect) this.collect.lines.push(line);
    if (this.collect) this.collect.touched = Date.now();
  }

  // Waits until the console has said nothing for quietMs (or maxMs have passed) and returns what it said.
  async settle(collect, quietMs, maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await sleep(Math.min(quietMs / 4, 60));
      if (Date.now() - collect.touched >= quietMs) break;
    }
    const tail = cleanLine(this.partial);
    if (tail) collect.lines.push(tail);
    return collect.lines;
  }

  async login() {
    if (BAD.test(this.user) || BAD.test(this.password || '')) throw new Error('The Telnet user and password may not contain quotes or line breaks.');
    await sleep(150); // let the banner arrive
    // MA user profiles often have no password (offline use): then it is just Login "name".
    const lines = await this.exchange(this.password ? `Login "${this.user}" "${this.password}"` : `Login "${this.user}"`, 600, 4000);
    const who = lines.map((l) => /Logged in as User '([^']*)'/i.exec(l)).filter(Boolean).pop();
    if (!who || who[1].toLowerCase() !== this.user.toLowerCase()) {
      throw new Error(`Telnet login as "${this.user}" failed${who ? ` (still "${who[1]}")` : ''}. Check ma3.telnet.user (and the password, if that user profile has one).`);
    }
    return who[1];
  }

  // Sends one line and returns {lines, errors}; commands are spaced gapMs apart because the console drops fast input.
  send(command, { quietMs = 700, maxMs = 6000 } = {}) {
    if (/[\r\n]/.test(command)) return Promise.reject(new Error('One command per call; split lines first.'));
    const run = async () => {
      const lines = await this.exchange(command, quietMs, maxMs);
      return { lines, errors: parseErrors(lines) };
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }

  async exchange(text, quietMs, maxMs) {
    if (!this.socket || this.socket.destroyed) throw new Error('Not connected to the console.');
    const wait = this.lastSent + this.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.collect = { lines: [], touched: Date.now() };
    const collect = this.collect;
    this.partial = '';
    this.socket.write(`${text}\r\n`);
    this.lastSent = Date.now();
    try {
      return await this.settle(collect, quietMs, maxMs);
    } finally {
      this.collect = null;
    }
  }

  close() {
    if (this.socket) this.socket.destroy();
  }
}

// Listen-only connection (the System Monitor): calls onLine for every line until close() is called.
function listen({ host = '127.0.0.1', port = 30001, onLine, onClose, connectTimeoutMs = 3000 }) {
  const client = new ConsoleTelnet({ host, port, connectTimeoutMs });
  client.on('line', onLine);
  client.on('close', () => onClose && onClose());
  return client.connect().then(() => client);
}

// Opens a session logged in as `user`; the caller closes it.
async function openSession(options) {
  const client = new ConsoleTelnet(options);
  await client.connect();
  try {
    await client.login();
  } catch (err) {
    client.close();
    throw err;
  }
  return client;
}

module.exports = { ConsoleTelnet, createParser, parseErrors, cleanLine, listen, openSession, IAC, DO, WILL, WONT, DONT };
