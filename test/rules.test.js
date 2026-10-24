'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { lintRules } = require('../lib/rules');
const api = require('../data/api.json');

const rules = (src) => lintRules(src, api).map((f) => f.rule + '@' + f.line);

test('unknown API name suggests the closest real one', () => {
  const f = lintRules('printf("hi")\nPrintf("ok")\nprint("lua")\nmyHelper(1)', api);
  assert.deepStrictEqual(f.map((x) => [x.rule, x.line]), [['unknown-api', 0]]);
  assert.match(f[0].message, /Printf/);
});

test('user-defined and string methods are not flagged', () => {
  assert.deepStrictEqual(rules('local function Printg() end\nPrintg()\nlocal s = ("a"):find("a")\nlocal x = s:find("b")'), []);
});

test('missing required arguments', () => {
  assert.deepStrictEqual(rules('Cmd()\nCmd("Go+")\nPrintf(1, 2)'), ['missing-args@0']);
  assert.deepStrictEqual(rules('local h = Root()\nh:Find()'), ['missing-args@1']);
});

test('Cmd inside a loop', () => {
  assert.deepStrictEqual(rules('for i = 1, 3 do\n  Cmd("Go+")\nend\nCmd("x")'), ['cmd-in-loop@1']);
  assert.deepStrictEqual(rules('repeat\n  Cmd("a")\nuntil done'), ['cmd-in-loop@1']);
});

test('heavy call inside Timer / hook callbacks, inline or named', () => {
  assert.deepStrictEqual(rules('Timer(function()\n  local l = ObjectList("Sequence 1")\nend, 0.1, 0)'), ['heavy-in-callback@1']);
  assert.deepStrictEqual(rules('local function tick()\n  Root():Children()\nend\nTimer(tick, 0.1, 0)'), ['heavy-in-callback@1']);
  assert.deepStrictEqual(rules('local l = ObjectList("Sequence 1")\nTimer(function() Printf("x") end, 1, 1)'), []);
});

test('global assignment only at top level of a statement', () => {
  const f = lintRules('count = 0\nlocal n = 1\nn = 2\nlocal t = {\n  a = 1,\n}\nfor i = 1, 2 do end\nfunction Main() end', api, { globals: true });
  assert.deepStrictEqual(lintRules('count = 0', api), []);
  assert.deepStrictEqual(f.map((x) => [x.rule, x.line, x.severity]), [['global-assign', 0, 'hint']]);
});
