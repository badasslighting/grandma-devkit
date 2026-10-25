--[[
Lua Bridge for grandMA3 onPC (Windows).

Runs Lua sent by an external client and writes back the return values, the
Printf/print/Echo output and any error with its traceback. Start it once from
the plugin pool; it polls a request file until a show load kills it or a client
sends op=stop.

Folder (Windows onPC): C:/ProgramData/MA3/luabridge
  request.txt    first line "id=<id> timeout=<s> op=<run|reset|stop>", rest is code
  response.json  {"id","ok","returns","output","error","cpu_ms","bridge"}
  heartbeat.txt  "<instance> <os.time()>", rewritten every second

Code runs on this plugin's own coroutine, so it may call coroutine.yield(s) to
wait. It must not create coroutines that call the MA API (that crashes 2.5.1).
A CPU-time guard (debug.sethook) stops code that runs past its timeout without
yielding; it can't interrupt a single long C call.
]]

local pluginName = select(1, ...)
local BASE = _ENV

local VERSION = "0.1.0"
local POLL_S = 0.1
local BEAT_EVERY = 10          -- polls between heartbeats (about 1 s)
local MAX_DEPTH = 4
local MAX_ITEMS = 200
local MAX_OUTPUT = 1000000     -- characters of captured output kept per run

local function ipcDir()
	if package.config:sub(1, 1) == "\\" then
		return "C:/ProgramData/MA3/luabridge"
	end
	return GetPath(Enums.PathType.Temp) .. "/luabridge"
end

local DIR = ipcDir()
local REQ = DIR .. "/request.txt"
local RESP = DIR .. "/response.json"
local BEAT = DIR .. "/heartbeat.txt"

-- ---------------------------------------------------------------- files

local function readAll(path)
	local f = io.open(path, "rb")
	if not f then return nil end
	local s = f:read("a")
	f:close()
	return s
end

local function writeAtomic(path, s)
	local tmp = path .. ".tmp"
	local f = io.open(tmp, "wb")
	if not f then return false end
	f:write(s)
	f:close()
	os.remove(path)
	return os.rename(tmp, path) and true or false
end

local function ensureDir()
	local ok, lfs = pcall(require, "lfs")
	if ok and lfs then
		local parent = DIR:match("^(.*)/[^/]+$")
		if parent then lfs.mkdir(parent) end
		lfs.mkdir(DIR)
	end
end

-- ---------------------------------------------------------------- encoding

local JESC = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function jstr(s)
	local e = s:gsub('[%c"\\]', function(c)
		return JESC[c] or string.format("\\u%04x", c:byte())
	end)
	return '"' .. e .. '"'
end

local function jarr(list)
	local parts = {}
	for i = 1, #list do parts[i] = jstr(list[i]) end
	return "[" .. table.concat(parts, ",") .. "]"
end

-- Readable one-line rendering of any value; MA objects show class, address, name.
local function repr(v, depth, seen)
	local t = type(v)
	if t == "string" then return string.format("%q", v) end
	if t == "userdata" then
		local ok, cls = pcall(function() return v:GetClass() end)
		if ok and cls then
			local _, addr = pcall(function() return v:Addr() end)
			local _, name = pcall(function() return v.name end)
			return string.format("<%s %s %q>", tostring(cls), tostring(addr), tostring(name))
		end
		return tostring(v)
	end
	if t ~= "table" then return tostring(v) end
	if seen[v] then return "<cycle>" end
	if depth <= 0 then return "{...}" end
	seen[v] = true
	local parts, n = {}, 0
	local len = #v
	for i = 1, len do
		n = n + 1
		if n > MAX_ITEMS then parts[#parts + 1] = "..."; break end
		parts[#parts + 1] = repr(v[i], depth - 1, seen)
	end
	if n <= MAX_ITEMS then
		for k, val in pairs(v) do
			if not (math.type(k) == "integer" and k >= 1 and k <= len) then
				n = n + 1
				if n > MAX_ITEMS then parts[#parts + 1] = "..."; break end
				local ks = (type(k) == "string" and k:match("^[%a_][%w_]*$")) and k
					or ("[" .. repr(k, 0, seen) .. "]")
				parts[#parts + 1] = ks .. "=" .. repr(val, depth - 1, seen)
			end
		end
	end
	seen[v] = nil
	return "{" .. table.concat(parts, ", ") .. "}"
end

-- ---------------------------------------------------------------- execution

local env -- persists between runs until op=reset

local function newEnv()
	return setmetatable({}, { __index = BASE })
end

-- Wraps an output function: records the text, then calls the real one.
local function capturing(out, real, formatted)
	return function(...)
		local s
		if formatted then
			local ok, r = pcall(string.format, ...)
			s = ok and r or tostring((...))
		else
			local n = select("#", ...)
			local parts = {}
			for i = 1, n do parts[i] = tostring((select(i, ...))) end
			s = table.concat(parts, "\t")
		end
		if out.size < MAX_OUTPUT then
			out[#out + 1] = s
			out.size = out.size + #s
		elseif not out.cut then
			out[#out + 1] = "[output truncated]"
			out.cut = true
		end
		if real then return real(...) end
	end
end

local function compile(code)
	local fn = load("return " .. code, "=bridge", "t", env)
	if fn then return fn end
	return load(code, "=bridge", "t", env)
end

local function run(code, timeout)
	local out = { size = 0 }
	env.Printf = capturing(out, BASE.Printf, true)
	env.ErrPrintf = capturing(out, BASE.ErrPrintf, true)
	env.Echo = capturing(out, BASE.Echo, true)
	env.ErrEcho = capturing(out, BASE.ErrEcho, true)
	env.print = capturing(out, BASE.print, false)

	local fn, cerr = compile(code)
	if not fn then
		return { ok = false, returns = {}, output = out, error = tostring(cerr), cpu_ms = 0 }
	end

	local t0 = os.clock()
	if timeout > 0 then
		debug.sethook(function()
			if os.clock() - t0 > timeout then
				error(string.format("LuaBridge: stopped after %.1f s CPU without finishing", timeout), 2)
			end
		end, "", 100000)
	end
	local res = table.pack(xpcall(fn, function(e)
		return debug.traceback(tostring(e), 2)
	end))
	debug.sethook()
	local cpu_ms = math.floor((os.clock() - t0) * 1000 + 0.5)

	if not res[1] then
		return { ok = false, returns = {}, output = out, error = res[2], cpu_ms = cpu_ms }
	end
	local returns = {}
	for i = 2, res.n do returns[#returns + 1] = repr(res[i], MAX_DEPTH, {}) end
	return { ok = true, returns = returns, output = out, cpu_ms = cpu_ms }
end

local function encodeResponse(id, r)
	local output = {}
	for i = 1, #r.output do output[i] = r.output[i] end
	return string.format('{"id":%s,"ok":%s,"returns":%s,"output":%s,"error":%s,"cpu_ms":%d,"bridge":%s}',
		jstr(id), tostring(r.ok), jarr(r.returns), jarr(output),
		r.error and jstr(r.error) or "null", r.cpu_ms or 0, jstr(VERSION))
end

local function parseRequest(raw)
	local head, code = raw:match("^([^\n]*)\n?(.*)$")
	local h = {}
	for k, v in (head or ""):gmatch("(%w+)=(%S+)") do h[k] = v end
	return h.id, h.op or "run", tonumber(h.timeout) or 2, code or ""
end

-- Handles one request file's contents; returns the response text and whether to stop.
local function handle(raw)
	local id, op, timeout, code = parseRequest(raw)
	if not id then return nil, false end
	if op == "stop" then
		return encodeResponse(id, { ok = true, returns = { '"stopped"' }, output = {} }), true
	end
	if op == "reset" then
		env = newEnv()
		return encodeResponse(id, { ok = true, returns = { '"reset"' }, output = {} }), false
	end
	return encodeResponse(id, run(code, timeout)), false
end

-- ---------------------------------------------------------------- main loop

local function Main()
	ensureDir()
	env = env or newEnv()
	local instance = tostring(os.time()) .. "-" .. tostring(math.random(100000, 999999))
	writeAtomic(BEAT, instance .. " " .. os.time())
	os.remove(REQ)
	Printf("Lua Bridge %s running, folder %s", VERSION, DIR)

	local lastId, polls = nil, 0
	while true do
		local raw = readAll(REQ)
		if raw and raw ~= "" then
			os.remove(REQ)
			local id = raw:match("id=(%S+)")
			if id and id ~= lastId then
				lastId = id
				local resp, stop = handle(raw)
				if resp then writeAtomic(RESP, resp) end
				if stop then break end
			end
		end

		polls = polls + 1
		if polls >= BEAT_EVERY then
			polls = 0
			local cur = readAll(BEAT)
			local owner = cur and cur:match("^(%S+)")
			if owner and owner ~= instance then
				Printf("Lua Bridge: a newer instance took over, this one stops")
				return
			end
			writeAtomic(BEAT, instance .. " " .. os.time())
		end
		coroutine.yield(POLL_S)
	end
	os.remove(BEAT)
	Printf("Lua Bridge stopped")
end

local function Cleanup()
	os.remove(BEAT)
end

if pluginName == "__test__" then
	return {
		repr = repr, jstr = jstr, parseRequest = parseRequest, handle = handle,
		setEnv = function() env = newEnv() end,
	}
end

return Main, Cleanup
