#!/usr/bin/env node
// Export the site's user table from Cloudflare D1 as an encrypted CSV.
//
//   node scripts/export-users.js keygen            print a new random key (store it in Bitwarden)
//   node scripts/export-users.js export            query D1, write users-YYYY-MM-DD.csv.enc
//   node scripts/export-users.js decrypt <file>    print the CSV from an encrypted file
//
// The key comes from USERS_EXPORT_KEY (base64, 32 bytes). The plaintext CSV is never written to disk.
// Output goes to USERS_EXPORT_DIR, default ~/Documents/exports (keep it outside any git repo).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DB = 'grandma-devkit-users';
const QUERY = 'SELECT email, name, first_seen, last_seen, visits, blocked FROM users ORDER BY last_seen DESC';
const MAGIC = Buffer.from('GDUX1');

function toCsv(rows) {
  // Prefix formula-looking cells so a spreadsheet won't run them.
  const q = v => '"' + String(v ?? '').replace(/^[=+\-@]/, "'$&").replace(/"/g, '""') + '"';
  const iso = t => new Date(t * 1000).toISOString();
  const head = 'email,name,first_seen,last_seen,visits,blocked';
  return [head, ...rows.map(r => [r.email, r.name, iso(r.first_seen), iso(r.last_seen), r.visits, r.blocked].map(q).join(','))].join('\n') + '\n';
}

function parseKey(b64) {
  const key = Buffer.from(b64 || '', 'base64');
  if (key.length !== 32) throw new Error('USERS_EXPORT_KEY must be 32 bytes, base64. Make one with: node scripts/export-users.js keygen');
  return key;
}

function encrypt(text, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

function decrypt(buf, key) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an encrypted users export');
  const iv = buf.subarray(5, 17), tag = buf.subarray(17, 33), body = buf.subarray(33);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}

function queryD1() {
  const r = spawnSync('npx', ['--yes', 'wrangler@3', 'd1', 'execute', DB, '--remote', '--json', '--command', QUERY],
    { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('wrangler failed (run "npx wrangler login" first?):\n' + (r.stderr || r.stdout));
  const out = r.stdout.slice(r.stdout.indexOf('['));
  return JSON.parse(out)[0].results;
}

function main(argv, env) {
  const cmd = argv[0];
  if (cmd === 'keygen') {
    console.log(crypto.randomBytes(32).toString('base64'));
  } else if (cmd === 'export') {
    const key = parseKey(env.USERS_EXPORT_KEY);
    const rows = queryD1();
    const dir = env.USERS_EXPORT_DIR || path.join(os.homedir(), 'Documents', 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `users-${new Date().toISOString().slice(0, 10)}.csv.enc`);
    fs.writeFileSync(file, encrypt(toCsv(rows), key), { mode: 0o600 });
    console.log(`${rows.length} users -> ${file}`);
  } else if (cmd === 'decrypt' && argv[1]) {
    process.stdout.write(decrypt(fs.readFileSync(argv[1]), parseKey(env.USERS_EXPORT_KEY)));
  } else {
    console.error('usage: export-users.js keygen | export | decrypt <file>');
    process.exitCode = 2;
  }
}

module.exports = { toCsv, encrypt, decrypt, parseKey };
if (require.main === module) {
  try { main(process.argv.slice(2), process.env); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
