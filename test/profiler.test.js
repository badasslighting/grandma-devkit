'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildProfileLua, parseProfile, formatProfile, lensTitle } = require('../lib/profiler');

const haveLua = (() => {
  try {
    execFileSync('lua', ['-v'], { stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
})();

// A fake console: Timer and HookObjectChange keep the callbacks, the chunk runs on a coroutine like the bridge's,
// and every yield fires the callbacks from the main thread. mode 'guard' puts a hook on the run's coroutine
// first (as the bridge's CPU guard does); the profiler must give it back.
const DRIVER = String.raw`
local timers, hooks = {}, {}
function Timer(fn, dt, count) timers[#timers + 1] = { fn = fn, left = count } end
function HookObjectChange(fn, obj) hooks[#hooks + 1] = fn return 7 end
local T0, H0 = Timer, HookObjectChange
-- the profiled file runs in its own environment, so it reports its calls through a function of the host
function bump() hits = (hits or 0) + 1 end
local guard = function() end
local mode = arg[2]
local co = coroutine.create(function()
  if mode == 'guard' then debug.sethook(guard, '', 100000) end
  local r = dofile(arg[1])
  return r, debug.gethook() == (mode == 'guard' and guard or nil)
end)
local mainHookClean, result, coHookOk = true, nil, nil
while true do
  local ok, a, b = coroutine.resume(co)
  if not ok then error(a) end
  if coroutine.status(co) == 'dead' then result, coHookOk = a, b break end
  for _, t in ipairs(timers) do while t.left > 0 do t.left = t.left - 1; pcall(t.fn) end end
  for _, h in ipairs(hooks) do pcall(h, 'obj') end
  if debug.gethook() ~= nil then mainHookClean = false end
end
local before = hits or 0
for _, t in ipairs(timers) do pcall(t.fn) end
io.write(string.format('%q', result), '\n')
io.write(tostring(Timer == T0 and HookObjectChange == H0), ' ', tostring(coHookOk), ' ', tostring(mainHookClean), ' ', tostring((hits or 0) - before), '\n')
`;

function runOnLua(source, mode = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profiler-'));
  fs.writeFileSync(path.join(dir, 'run.lua'), buildProfileLua(source, { durationS: 0, sampleCount: 100 }));
  fs.writeFileSync(path.join(dir, 'driver.lua'), DRIVER);
  const out = execFileSync('lua', [path.join(dir, 'driver.lua'), path.join(dir, 'run.lua'), mode], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  const [quoted, flags] = out.trimEnd().split(/\n(?=[a-z]+ [a-z]+ [a-z]+ \d+$)/);
  const [globals, coHook, mainHook, afterHits] = flags.split(' ');
  return { profile: parseProfile([quoted]), globalsKept: globals === 'true', coHookRestored: coHook === 'true', mainHookClean: mainHook === 'true', afterHits: Number(afterHits) };
}

const SOURCE = [
  'local function busy() local s = 0 for i = 1, 20000 do s = s + i end return s end',
  'local function tick() bump(); busy() end',
  'Timer(tick, 0.1, 5)',
  "HookObjectChange(function(o) bump() end, 'pool')",
  'function onChange() end',
  'Timer(onChange, 1, 2)',
].join('\n');

test('buildProfileLua embeds the file safely and carries the window and sample count', () => {
  const lua = buildProfileLua('local s = [[ x ]]\nlocal t = [=[ y ]=]\n', { durationS: 5, sampleCount: 250 });
  assert.match(lua, /local src = \[==\[/);
  assert.match(lua, /local DURATION, SAMPLE_COUNT = 5, 250/);
  assert.match(buildProfileLua('x()'), /local DURATION, SAMPLE_COUNT = 3, 1000/);
  assert.doesNotMatch(lua, /^\s*Timer\s*=/m, 'the console globals are never assigned');
});

test('parseProfile reads functions, lines, notes and the error', () => {
  const p = parseProfile(['"F|file|0||1|2.000|2.000|3;;;F|timer|2|tick|4|10.000|4.000|9;;;L|7|5;;;L|2|8;;;N|error profiled:9: boom;;;N|something"']);
  assert.deepStrictEqual(p.functions[1], { kind: 'timer', line: 2, name: 'tick', calls: 4, totalMs: 10, maxMs: 4, avgMs: 2.5, samples: 9 });
  assert.deepStrictEqual(p.lines, [{ line: 2, samples: 8 }, { line: 7, samples: 5 }]);
  assert.strictEqual(p.error, 'profiled:9: boom');
  assert.deepStrictEqual(p.notes, ['something']);
  assert.deepStrictEqual(parseProfile([]), { functions: [], lines: [], notes: [], error: null });
});

test('formatProfile and lensTitle show the numbers and the budget', () => {
  const f = { kind: 'timer', line: 2, name: 'scan', calls: 38, totalMs: 467.4, maxMs: 41, avgMs: 12.3, samples: 9 };
  assert.strictEqual(lensTitle(f, { heavy: 2 }), 'frame budget: scan 12.3 ms avg, 41.0 ms max over 38 calls, over the 16 ms budget — static: 2 heavy reachable');
  assert.strictEqual(lensTitle({ ...f, name: '', maxMs: 3 }, { name: 'tick', budgetMs: 16 }), 'frame budget: tick 12.3 ms avg, 3.00 ms max over 38 calls — static: light');
  const text = formatProfile({ functions: [f], lines: [], notes: [], error: null }, { budgetMs: 16 });
  assert.match(text, /scan .* 38 calls {2}avg 12\.3 ms {2}max 41\.0 ms/);
  assert.match(text, /over the 16 ms budget/);
  assert.match(formatProfile({ functions: [], lines: [], notes: [], error: null }), /none called/);
});

test('real Lua: callbacks are timed and sampled, the window closes and nothing is left behind', { skip: !haveLua && 'no lua on the PATH' }, () => {
  const r = runOnLua(SOURCE);
  const by = (kind, line) => r.profile.functions.find((f) => f.kind === kind && f.line === line);
  assert.strictEqual(by('timer', 2).calls, 5);
  assert.ok(by('timer', 2).samples > 0, 'the busy callback is sampled');
  assert.strictEqual(by('hook', 4).calls, 1);
  assert.strictEqual(by('timer', 5).name, 'onChange', 'a global function the file defines is named');
  assert.strictEqual(by('timer', 5).calls, 2);
  assert.ok(r.profile.lines.some((l) => l.line === 1), 'the busy loop line is the hot one');
  assert.strictEqual(r.profile.error, null);
  assert.ok(r.globalsKept && r.coHookRestored && r.mainHookClean);
  assert.strictEqual(r.afterHits, 1, 'after the window the wrapper still runs the callback');
});

test('real Lua: a file that errors at the top level still restores the hook and keeps the globals', { skip: !haveLua && 'no lua on the PATH' }, () => {
  for (const mode of ['', 'guard']) {
    const r = runOnLua(`${SOURCE}\nerror('setup broke')`, mode);
    assert.match(r.profile.error, /profiled:7: setup broke/);
    assert.strictEqual(r.profile.functions.find((f) => f.kind === 'timer' && f.line === 2).calls, 5, 'callbacks registered before the error are still profiled');
    assert.ok(r.globalsKept, 'Timer and HookObjectChange are the originals');
    assert.ok(r.coHookRestored, `the run's hook is back (${mode || 'none'})`);
    assert.ok(r.mainHookClean);
  }
});

test('real Lua: a callback that errors passes its error on and leaves no hook', { skip: !haveLua && 'no lua on the PATH' }, () => {
  const r = runOnLua("Timer(function() local s = 0 for i = 1, 5000 do s = s + i end error('tick broke') end, 0.1, 3)");
  assert.strictEqual(r.profile.functions.find((f) => f.kind === 'timer').calls, 3);
  assert.ok(r.mainHookClean && r.coHookRestored);
});

test('real Lua: a syntax error is reported, not thrown', { skip: !haveLua && 'no lua on the PATH' }, () => {
  const r = runOnLua('Timer(');
  assert.match(r.profile.error, /profiled:/);
  assert.ok(r.coHookRestored && r.globalsKept);
});
