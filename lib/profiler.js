'use strict';
const { unquote } = require('./objectTree');

// Live frame-budget profiler (grandMA3). The file runs in its own environment, like a Lua test file. In that
// environment Timer and HookObjectChange are wrappers that time every callback call (os.clock) and sample it
// with a count hook; the console globals themselves are never replaced. The run then yields for the window
// (the bridge runs on its own coroutine, so the console keeps ticking and timers fire), closes the window and
// returns one compact record list. After the window the wrappers only delegate to the real callback. Every
// hook the profiler sets is put back to what was there before, also when the file or a callback errors.
const REC = ';;;';
const CHUNK = 'profiled';

const PRELUDE = String.raw`
local P = { open = true, funcs = {}, order = {}, lines = {}, fsamples = {}, notes = {} }
local clock, getinfo, gethook, sethook = os.clock, debug.getinfo, debug.gethook, debug.sethook
local function sampler()
  -- level 1 is this function, 2 the hook function, 3 the code that was running. A sample counts for the
  -- callback being timed (P.cur), whatever it called; the hot line is where the file's own code was.
  if P.cur then P.fsamples[P.cur] = (P.fsamples[P.cur] or 0) + 1 end
  local info = getinfo(3, 'Sl')
  if info and info.source == '=${CHUNK}' and info.currentline and info.currentline > 0 then
    P.lines[info.currentline] = (P.lines[info.currentline] or 0) + 1
  end
end
-- Runs fn under the sampler on the current thread and puts that thread's hook back afterwards. A hook set
-- from C ("external hook") cannot be restored from Lua, so that call runs unsampled.
local function sampled(cur, fn, ...)
  local ph, pm, pc = gethook()
  local prev = P.cur
  P.cur = cur
  local mine = ph == nil or type(ph) == 'function'
  if mine then
    sethook(function(ev) sampler(); if ph then ph(ev) end end, '', SAMPLE_COUNT)
  end
  local res = table.pack(pcall(fn, ...))
  P.cur = prev
  if mine then if ph then sethook(ph, pm, pc) else sethook() end end
  return res
end
local function record(kind, fn)
  local info = getinfo(fn, 'S')
  local line = info.source == '=${CHUNK}' and info.linedefined or -1
  local key = kind .. '@' .. line
  local r = P.funcs[key]
  if not r then
    r = { kind = kind, line = line, calls = 0, total = 0, max = 0, fn = fn }
    P.funcs[key] = r
    P.order[#P.order + 1] = r
  end
  return r
end
local function wrap(kind, fn)
  if type(fn) ~= 'function' then return fn end
  local r = record(kind, fn)
  return function(...)
    if not P.open then return fn(...) end
    local t = clock()
    local res = sampled(r.line, fn, ...)
    local dt = clock() - t
    if P.open then
      r.calls = r.calls + 1
      r.total = r.total + dt
      if dt > r.max then r.max = dt end
    end
    if not res[1] then error(res[2], 0) end
    return table.unpack(res, 2, res.n)
  end
end
local env = setmetatable({}, { __index = _G })
local realTimer, realHook = Timer, HookObjectChange
if type(realTimer) == 'function' then env.Timer = function(fn, ...) return realTimer(wrap('timer', fn), ...) end end
if type(realHook) == 'function' then env.HookObjectChange = function(fn, ...) return realHook(wrap('hook', fn), ...) end end
`;

const FINISH = String.raw`
local fileRec = { kind = 'file', line = 0, calls = 1, total = 0, max = 0 }
local ok, err = pcall(function()
  local fn, loadErr = load(src, '=${CHUNK}', 't', env)
  if not fn then error({ load = loadErr }) end
  local t = clock()
  local res = sampled(0, fn)
  fileRec.total = clock() - t
  fileRec.max = fileRec.total
  if not res[1] then P.notes[#P.notes + 1] = 'error|' .. tostring(res[2]) end
  local stop = clock() + DURATION
  repeat coroutine.yield(0.05) until clock() >= stop
end)
P.open = false
if not ok then
  P.notes[#P.notes + 1] = 'error|' .. (type(err) == 'table' and tostring(err.load) or tostring(err))
end
local names = {}
for k, v in pairs(env) do if type(v) == 'function' and type(k) == 'string' then names[v] = k end end
local out = {}
local function clean(s) return (tostring(s):gsub('[|\r\n]', ' '):gsub(';;;', ';')) end
local function ms(s) return string.format('%.3f', s * 1000) end
out[1] = 'F|file|0||1|' .. ms(fileRec.total) .. '|' .. ms(fileRec.max) .. '|' .. (P.fsamples[0] or 0)
for _, r in ipairs(P.order) do
  out[#out + 1] = 'F|' .. r.kind .. '|' .. r.line .. '|' .. clean(names[r.fn] or '') .. '|' .. r.calls .. '|' .. ms(r.total) .. '|' .. ms(r.max) .. '|' .. (P.fsamples[r.line] or 0)
  r.fn = nil
end
for line, n in pairs(P.fsamples) do
  local seen = line == 0
  for _, r in ipairs(P.order) do if r.line == line then seen = true end end
  if not seen then out[#out + 1] = 'F|function|' .. line .. '||0|0.000|0.000|' .. n end
end
for line, n in pairs(P.lines) do out[#out + 1] = 'L|' .. line .. '|' .. n end
for _, n in ipairs(P.notes) do out[#out + 1] = 'N|' .. clean(n) end
P.funcs, P.order, P.lines, P.fsamples = {}, {}, {}, {}
return table.concat(out, '${REC}')
`;

// The Lua to send. durationS: how long callbacks are recorded after the file has run; sampleCount: VM
// instructions between two samples.
function buildProfileLua(fileText, { durationS = 3, sampleCount = 1000 } = {}) {
  let level = 1;
  while (fileText.includes(`]${'='.repeat(level)}]`)) level++;
  const eq = '='.repeat(level);
  const consts = `local DURATION, SAMPLE_COUNT = ${Number(durationS) || 0}, ${Math.max(1, Math.floor(Number(sampleCount) || 1000))}`;
  return `${consts}${PRELUDE}local src = [${eq}[\n${fileText}\n]${eq}]${FINISH}`;
}

const round = (n) => Math.round(n * 1000) / 1000;

// -> {functions: [{kind, name, line, calls, totalMs, maxMs, avgMs, samples}], lines: [{line, samples}], notes, error}
// line is the 1-based file line the function starts on (0 = the file's top level).
function parseProfile(returns) {
  const text = unquote((returns && returns[0]) || '');
  const out = { functions: [], lines: [], notes: [], error: null };
  if (!text) return out;
  for (const rec of text.split(REC)) {
    const p = rec.split('|');
    if (p[0] === 'F' && p.length >= 8) {
      const calls = Number(p[4]);
      const totalMs = Number(p[5]);
      out.functions.push({ kind: p[1], line: Number(p[2]), name: p[3], calls, totalMs, maxMs: Number(p[6]), avgMs: calls ? round(totalMs / calls) : 0, samples: Number(p[7]) });
    } else if (p[0] === 'L') out.lines.push({ line: Number(p[1]), samples: Number(p[2]) });
    else if (p[0] === 'N') {
      const note = p.slice(1).join('|');
      if (note.startsWith('error ') && !out.error) out.error = note.slice(6);
      else out.notes.push(note);
    }
  }
  out.lines.sort((a, b) => b.samples - a.samples);
  return out;
}

const fmt = (n) => (n >= 10 ? n.toFixed(1) : n.toFixed(2));
const isCallback = (f) => f.kind === 'timer' || f.kind === 'hook';

// Text table for the output channel.
function formatProfile(profile, { budgetMs = 16, durationS = 3 } = {}) {
  const rows = [];
  const cbs = profile.functions.filter(isCallback);
  rows.push(`callbacks over ${durationS} s (${cbs.length}):`);
  if (!cbs.length) rows.push('  none called. Callbacks registered from the plugin function (Main) are not reached: the profile runs the file, not its returned functions.');
  for (const f of cbs) {
    const where = f.line > 0 ? `line ${f.line}` : 'outside the file';
    rows.push(`  ${f.kind.padEnd(5)} ${(f.name || '(anonymous)').padEnd(16)} ${where.padEnd(9)} ${String(f.calls).padStart(5)} calls  avg ${fmt(f.avgMs)} ms  max ${fmt(f.maxMs)} ms  total ${fmt(f.totalMs)} ms  ${f.samples} samples`);
    if (f.maxMs > budgetMs) rows.push(`    over the ${budgetMs} ms budget`);
  }
  const file = profile.functions.find((f) => f.kind === 'file');
  if (file) rows.push(`file top level: ${fmt(file.totalMs)} ms`);
  if (profile.lines.length) rows.push(`hottest lines: ${profile.lines.slice(0, 5).map((l) => `${l.line} (${l.samples})`).join(', ')}`);
  for (const n of profile.notes) rows.push(`note: ${n}`);
  if (profile.error) rows.push(`error: ${profile.error}`);
  return rows.join('\n');
}

// CodeLens title for an entry point with a measured callback; heavy is the static heavy-call count.
function lensTitle(f, { name, heavy = 0, budgetMs = 16 } = {}) {
  const who = f.name || name;
  const stat = heavy ? `${heavy} heavy reachable` : 'light';
  const over = f.maxMs > budgetMs ? `, over the ${budgetMs} ms budget` : '';
  return `frame budget: ${who ? `${who} ` : ''}${fmt(f.avgMs)} ms avg, ${fmt(f.maxMs)} ms max over ${f.calls} call${f.calls === 1 ? '' : 's'}${over} — static: ${stat}`;
}

module.exports = { CHUNK, buildProfileLua, parseProfile, formatProfile, lensTitle, isCallback };
