'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dialogHtml } = require('../lib/dialogPanel');

test('the designer page substitutes the nonce everywhere and its script compiles', () => {
  const html = dialogHtml('abc123');
  assert.ok(!html.includes('__NONCE__'));
  assert.strictEqual((html.match(/nonce-abc123|nonce="abc123"/g) || []).length, 4);
  const script = /<script nonce="abc123">([\s\S]*)<\/script>/.exec(html)[1];
  assert.doesNotThrow(() => new Function('acquireVsCodeApi', 'document', 'window', script));
});

test('the overlay designer page substitutes the nonce and its script compiles', () => {
  const { overlayHtml } = require('../lib/overlayPanel');
  const html = overlayHtml('zz9');
  assert.ok(!html.includes('__NONCE__'));
  const script = /<script nonce="zz9">([\s\S]*)<\/script>/.exec(html)[1];
  assert.doesNotThrow(() => new Function('acquireVsCodeApi', 'document', 'window', script));
});
