'use strict';
const { unquote } = require('./objectTree');

// The console REPL and inspector: Lua that runs one expression on the console and describes the result as
// JSON, one level at a time, so a panel can show an expandable tree and fetch a node's children when it is
// opened. Handles (grandMA3 objects) are described by class, name, address and child count; tables by their keys.
const CAP = 200;

// Lua source. mode 'run' evaluates `expr` (as an expression, else as a statement list) and describes every
// value it returns; mode 'children' evaluates `expr` and lists the children of its single value.
function replLua(expr, mode = 'run') {
  // The expression goes in as a long bracket string, with enough = signs not to clash with its content.
  let eq = '==';
  while (String(expr).includes(`]${eq}]`)) eq += '=';
  const lit = `[${eq}[${String(expr)}]${eq}]`;
  return String.raw`
local EXPR, MODE, CAP = ${lit}, '${mode === 'children' ? 'children' : 'run'}', ${CAP}
local function esc(s)
  s = tostring(s)
  if utf8 and not utf8.len(s) then s = s:gsub('[\x80-\xff]', '?') end
  return '"' .. s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' elseif c == '\\' then return '\\\\' end
    return string.format('\\u%04x', c:byte())
  end) .. '"'
end
local function isObj(v)
  if type(v) ~= 'userdata' then return false end
  local ok, cls = pcall(function() return v:GetClass() end)
  return ok and cls ~= nil
end
local function desc(v)
  local t = type(v)
  if t == 'nil' then return '{"t":"nil","s":"nil"}' end
  if t == 'boolean' or t == 'number' then return '{"t":"' .. t .. '","s":' .. esc(tostring(v)) .. '}' end
  if t == 'string' then
    local s = #v > 300 and (v:sub(1, 300) .. '...') or v
    return '{"t":"string","s":' .. esc(s) .. ',"len":' .. #v .. '}'
  end
  if t == 'table' then
    local n = 0
    for _ in pairs(v) do n = n + 1 if n > 100000 then break end end
    return '{"t":"table","s":' .. esc('table (' .. n .. ')') .. ',"n":' .. n .. '}'
  end
  if isObj(v) then
    local function try(f) local ok, r = pcall(f) if ok then return r end end
    local cls = try(function() return v:GetClass() end)
    local name = try(function() return v.name end)
    local addr = try(function() return v:Addr() end)
    local n = try(function() return v:Count() end) or 0
    return '{"t":"object","s":' .. esc((name or '') .. ' [' .. tostring(cls) .. ']') .. ',"cls":' .. esc(cls) .. ',"name":' .. esc(name or '') .. ',"addr":' .. esc(addr or '') .. ',"n":' .. n .. '}'
  end
  return '{"t":"' .. t .. '","s":' .. esc(tostring(v)) .. '}'
end
-- grandMA2 runs Lua 5.1: loadstring instead of load, no table.pack
local loadStr = loadstring or load
local pack = table.pack or function(...) return { n = select('#', ...), ... } end
local function evalValues()
  local f, err = loadStr('return ' .. EXPR, '=repl')
  if not f then f, err = loadStr(EXPR, '=repl') end
  if not f then return nil, err end
  local r = pack(pcall(f))
  if not r[1] then return nil, tostring(r[2]) end
  return r, nil
end
local r, err = evalValues()
if not r then return '{"error":' .. esc(err) .. '}' end
if MODE == 'run' then
  local out = {}
  for i = 2, r.n do out[#out + 1] = desc(r[i]) end
  return '{"values":[' .. table.concat(out, ',') .. ']}'
end
local v = r[2]
local out, props = {}, {}
local function keyLit(k) if type(k) == 'number' then return '[' .. tostring(k) .. ']' end return '[' .. string.format('%q', tostring(k)) .. ']' end
if type(v) == 'table' then
  local keys = {}
  for k in pairs(v) do if type(k) == 'string' or type(k) == 'number' then keys[#keys + 1] = k end end
  table.sort(keys, function(a, b) if type(a) == type(b) then return a < b end return type(a) == 'number' end)
  for i = 1, math.min(#keys, CAP) do
    local k = keys[i]
    out[#out + 1] = '{"k":' .. (type(k) == 'number' and tostring(k) or esc(k)) .. ',"expr":' .. esc('(' .. EXPR .. ')' .. keyLit(k)) .. ',"d":' .. desc(v[k]) .. '}'
  end
elseif isObj(v) then
  local n = v:Count() or 0
  local shown = 0
  for i = 1, n do
    if shown >= CAP then break end
    local c = v[i]
    if c ~= nil then
      shown = shown + 1
      out[#out + 1] = '{"k":' .. i .. ',"expr":' .. esc('(' .. EXPR .. ')[' .. i .. ']') .. ',"d":' .. desc(c) .. '}'
    end
  end
  local okc, pc = pcall(function() return v:PropertyCount() end)
  if okc and pc then
    for i = 0, math.min(pc, CAP) - 1 do
      local okn, pn = pcall(function() return v:PropertyName(i) end)
      if okn and pn then
        local okv, pv = pcall(function() return v:Get(pn, Enums.Roles.Display) end)
        props[#props + 1] = '{"k":' .. esc(pn) .. ',"d":' .. desc(okv and pv or nil) .. '}'
      end
    end
  end
end
return '{"children":[' .. table.concat(out, ',') .. '],"props":[' .. table.concat(props, ',') .. ']}'
`;
}

// Parse the bridge's return value into {values} | {children, props} | {error}.
function parseRepl(returns) {
  const text = unquote((returns && returns[0]) || '');
  try {
    return JSON.parse(text);
  } catch (_) {
    return { error: text ? `unreadable reply: ${text.slice(0, 200)}` : 'no reply' };
  }
}

// One-line text for a described value.
function valueText(d) {
  if (!d) return '';
  if (d.t === 'string') return JSON.stringify(d.s) + (d.len > 300 ? ` (${d.len} chars)` : '');
  return d.s;
}

module.exports = { replLua, parseRepl, valueText, CAP };
