'use strict';
const { unquote } = require('./objectTree');

// Running `*.test.lua` files on the console through the bridge. A test file calls test(name, fn) and the
// assert helpers below; the runner loads the file in its own environment (so test globals do not leak
// into the console), runs every test under pcall, and returns one line per test.
const REC = ';;;';

const PRELUDE = String.raw`
local results = {}
local before, after = {}, {}
local env = setmetatable({}, { __index = _G })
local function fail(msg) error(msg, 3) end -- 1 is fail, 2 the assert helper, 3 the test code that called it
local function show(v) if type(v) == 'string' then return string.format('%q', v) end return tostring(v) end
function env.beforeEach(fn) before[#before + 1] = fn end
function env.afterEach(fn) after[#after + 1] = fn end
function env.assertTrue(v, msg) if not v then fail(msg or ('expected a true value, got ' .. show(v))) end end
function env.assertFalse(v, msg) if v then fail(msg or ('expected a false value, got ' .. show(v))) end end
function env.assertNil(v, msg) if v ~= nil then fail(msg or ('expected nil, got ' .. show(v))) end end
function env.assertNotNil(v, msg) if v == nil then fail(msg or 'expected a value, got nil') end end
function env.assertEq(a, b, msg) if a ~= b then fail((msg and (msg .. ': ') or '') .. 'expected ' .. show(b) .. ', got ' .. show(a)) end end
function env.assertNe(a, b, msg) if a == b then fail((msg and (msg .. ': ') or '') .. 'expected a value other than ' .. show(b)) end end
function env.assertMatch(s, pattern, msg) if type(s) ~= 'string' or not s:match(pattern) then fail(msg or ('expected ' .. show(s) .. ' to match ' .. show(pattern))) end end
function env.assertError(fn, pattern)
  local ok, err = pcall(fn)
  if ok then fail('expected an error, but the function returned normally') end
  if pattern and not tostring(err):match(pattern) then fail('expected an error matching ' .. show(pattern) .. ', got ' .. show(tostring(err))) end
end
function env.test(name, fn)
  local clock = os.clock()
  local ok, err = true, ''
  for _, b in ipairs(before) do local bok, berr = pcall(b); if not bok then ok, err = false, 'beforeEach: ' .. tostring(berr); break end end
  if ok then ok, err = pcall(fn); err = ok and '' or tostring(err) end
  for _, a in ipairs(after) do local aok, aerr = pcall(a); if not aok and ok then ok, err = false, 'afterEach: ' .. tostring(aerr) end end
  local ms = math.floor((os.clock() - clock) * 1000)
  results[#results + 1] = (ok and 'ok' or 'fail') .. '|' .. ms .. '|' .. tostring(name):gsub('[|\r\n]', ' ') .. '|' .. err:gsub('[\r\n]+', ' / ')
end
`;

// The Lua to send: the helpers, the test file as a long-bracket string (chosen so the file cannot close
// it early), and the run. A file that fails to load or throws at the top level becomes one failed entry.
function buildRunLua(source, chunkName = 'testfile') {
  let level = 1;
  while (source.includes(`]${'='.repeat(level)}]`)) level++;
  const eq = '='.repeat(level);
  return `${PRELUDE}
local src = [${eq}[
${source}
]${eq}]
local fn, loadErr = load(src, '=${chunkName}', 't', env)
if not fn then
  results[#results + 1] = 'fail|0|(file)|' .. tostring(loadErr):gsub('[\\r\\n]+', ' / ')
else
  local ok, err = pcall(fn)
  if not ok then results[#results + 1] = 'fail|0|(file)|' .. tostring(err):gsub('[\\r\\n]+', ' / ') end
end
return table.concat(results, '${REC}')
`;
}

// -> [{name, ok, ms, error}]
function parseResults(returns) {
  const text = unquote((returns && returns[0]) || '');
  if (!text) return [];
  return text.split(REC).map((rec) => {
    const m = /^(ok|fail)\|(\d+)\|([^|]*)\|([\s\S]*)$/.exec(rec);
    return m ? { name: m[3], ok: m[1] === 'ok', ms: Number(m[2]), error: m[4] } : { name: '(unreadable result)', ok: false, ms: 0, error: rec };
  });
}

// Tests to show before anything has run: every `test("name", ...)` call, with its line.
function discoverTests(text) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    const m = /\btest\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1/.exec(l);
    if (m) out.push({ name: m[2].replace(/\\(["'])/g, '$1'), line: i });
  });
  return out;
}

// `testfile:12: message` -> 11 (0-based), so a failure can point at its line.
function errorLine(error, chunkName = 'testfile') {
  const m = new RegExp(`${chunkName}:(\\d+):`).exec(String(error || ''));
  return m ? Math.max(0, Number(m[1]) - 1) : null;
}

module.exports = { buildRunLua, parseResults, discoverTests, errorLine };
