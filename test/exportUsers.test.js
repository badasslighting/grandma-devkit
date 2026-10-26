'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { toCsv, encrypt, decrypt, parseKey } = require('../scripts/export-users.js');

test('csv quotes cells and neutralises formulas', () => {
  const csv = toCsv([{ email: 'a@b.c', name: '=cmd|x"', first_seen: 1, last_seen: 2, visits: 3, blocked: 0 }]);
  assert.match(csv, /"'=cmd\|x"""/);
  assert.match(csv, /1970-01-01T00:00:01\.000Z/);
});

test('encrypt/decrypt round trip, wrong key and tampering fail', () => {
  const key = crypto.randomBytes(32);
  const enc = encrypt('email\nx@y.z\n', key);
  assert.strictEqual(decrypt(enc, key), 'email\nx@y.z\n');
  assert.throws(() => decrypt(enc, crypto.randomBytes(32)));
  enc[enc.length - 1] ^= 1;
  assert.throws(() => decrypt(enc, key));
});

test('key must be 32 bytes', () => {
  assert.throws(() => parseKey('abc'));
  assert.strictEqual(parseKey(crypto.randomBytes(32).toString('base64')).length, 32);
});
