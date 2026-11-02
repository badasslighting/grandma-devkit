'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Client for the file-based LuaBridge plugin running in grandMA3 onPC.
// Protocol: write "id=<id> timeout=<s> op=<op>\n<code>" to request.txt (via request.tmp);
// the plugin answers with response.json carrying the same id and refreshes heartbeat.txt every second.
const STALE_S = 5;
const MAX_SKEW_S = 2;
const POLL_MS = 50;

function defaultBridgeDir(env = process.env, platform = process.platform) {
  if (env.MA3_LUABRIDGE_DIR) return env.MA3_LUABRIDGE_DIR;
  if (platform === 'win32') return path.join(env.ProgramData || 'C:\\ProgramData', 'MA3', 'luabridge');
  return '';
}

// The grandMA2 LuaBridge_MA2 plugin speaks the same protocol from its own folder.
function defaultBridgeDirMa2(env = process.env, platform = process.platform) {
  if (env.MA2_LUABRIDGE_DIR) return env.MA2_LUABRIDGE_DIR;
  if (platform === 'win32') return path.join(env.ProgramData || 'C:\\ProgramData', 'MA2', 'luabridge');
  return '';
}

function status(dir, now = Date.now()) {
  let instance;
  let stamp;
  try {
    [instance, stamp] = fs.readFileSync(path.join(dir, 'heartbeat.txt'), 'utf8').trim().split(/\s+/);
  } catch (_) {
    return { running: false, dir, reason: 'no heartbeat file' };
  }
  const age = now / 1000 - parseFloat(stamp);
  if (!Number.isFinite(age)) return { running: false, dir, reason: 'unreadable heartbeat' };
  // A heartbeat dated in the future (beyond a small clock-skew allowance) is not proof of a live bridge.
  return { running: age < STALE_S && age > -MAX_SKEW_S, dir, instance, ageS: Math.round(age * 10) / 10 };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(dir, op, code = '', timeoutS = 2) {
  if (!dir) throw new Error('No bridge folder set (ma3.bridge.dir).');
  const st = status(dir);
  if (!st.running) {
    throw new Error(`LuaBridge isn't running on the console (start the LuaBridge plugin; a show load stops it). ${st.reason || `Last heartbeat ${st.ageS}s ago.`}`);
  }
  const id = crypto.randomBytes(6).toString('hex');
  const tmp = path.join(dir, 'request.tmp');
  // Remove any pre-existing entry (unlink never follows a symlink), then create the file exclusively and
  // without following links, so a planted request.tmp symlink cannot redirect the write elsewhere.
  try {
    fs.unlinkSync(tmp);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(tmp, flags, 0o600);
  try {
    fs.writeFileSync(fd, `id=${id} timeout=${timeoutS} op=${op}\n${code}`, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, path.join(dir, 'request.txt'));

  const deadline = Date.now() + (timeoutS + 5) * 1000;
  const resp = path.join(dir, 'response.json');
  while (Date.now() < deadline) {
    try {
      const data = JSON.parse(fs.readFileSync(resp, 'utf8'));
      if (data.id === id) return data;
    } catch (_) {
      /* not written yet, or mid-write */
    }
    await sleep(POLL_MS);
  }
  throw new Error(`No response within ${timeoutS + 5}s (the code may still be running, or the plugin died).`);
}

const run = (dir, code, timeoutS) => send(dir, 'run', code, timeoutS);
const reset = (dir) => send(dir, 'reset');
const stop = (dir) => send(dir, 'stop');

function formatResult(r) {
  const lines = [];
  if (r.output && r.output.length) {
    lines.push('output:');
    for (const l of r.output) lines.push(`  ${l}`);
  }
  if (r.ok) lines.push(`returns: ${r.returns && r.returns.length ? r.returns.join(', ') : '(nothing)'}`);
  else lines.push(`error: ${r.error}`);
  lines.push(`cpu_ms: ${r.cpu_ms}`);
  return lines.join('\n');
}

// Pulls the line out of a "bridge:<line>:" Lua error (the plugin names its chunk "bridge") so it can be
// shown on the editor line. Offset is how many lines the sent chunk starts below line 1 of the file.
function errorLine(error, offset = 0) {
  const m = /\bbridge:(\d+):/.exec(String(error || ''));
  return m ? Math.max(0, parseInt(m[1], 10) - 1 + offset) : null;
}

module.exports = { STALE_S, defaultBridgeDir, defaultBridgeDirMa2, status, send, run, reset, stop, formatResult, errorLine };
