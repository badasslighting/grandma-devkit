# Devkit for Grand MA2+MA3

VS Code support for writing Lua plugins for grandMA3 and grandMA2: completion, hover and signature help, checks, scaffolding, deploy, and running code on onPC.

Unofficial community tool, not affiliated with or endorsed by MA Lighting. grandMA2 and grandMA3 are trademarks of MA Lighting International GmbH.

**Upgrading from "MA3dev for VScode" (`badasslighting.ma3dev`)?** This is the same project under a new name and extension ID. Uninstall the old one so the two don't both register completion and commands. The `ma3.*` settings keep their names.

## Which console

The extension decides per Lua file: grandMA2 when the code calls `gma.*` or the plugin's manifest is a grandMA2 one (`<MA ...>`), grandMA3 otherwise. Set `ma3.target` to `ma2` or `ma3` to force it.

## Both consoles

- **Run File or Selection on Console** runs the file (or the selected lines) in onPC through the LuaBridge plugin and prints return values, print output and errors to the **grandMA Devkit** output panel. A Lua error is also marked on its editor line. Start the LuaBridge plugin on the console first; **LuaBridge Status** checks its heartbeat and **LuaBridge: Clear Globals** drops what earlier runs left behind. The bridge folder is `ma3.bridge.dir` (default `%ProgramData%/MA3/luabridge`) for grandMA3 and `ma3.ma2.bridgeDir` (default `%ProgramData%/MA2/luabridge`) for grandMA2; `ma3.bridge.timeout` is the CPU seconds a run may use (default 2; the console UI is frozen that long). Use it on onPC with a throwaway show: anything that can write the bridge folder can run Lua on the console.
- **Deploy Plugin to Plugins Folder** copies the manifest and the Lua file(s) it names to the console's plugins folder (`ma3.pluginsPath` for grandMA3; `ma3.ma2.pluginsPath` for grandMA2, which defaults to the newest `gma2_V_<version>/plugins` folder under `%ProgramData%/MA Lighting Technologies/grandma`). `ma3.deployOnSave` does it on every save.
- **Deploy and Reload on Console** saves, deploys, and (with `ma3.deployAndRun.slot` set) re-imports the plugin into that plugin pool slot and starts it through the bridge. Use it on onPC with a throwaway show: the slot is overwritten.
- **Command-string completion**: inside `Cmd("...")`, `CmdIndirect`, `CmdIndirectWait` and `gma.cmd("...")` strings, complete console keywords (`Go+`, `Store`, `Sequence`, `At`, `Thru`, `/nc`...).
- **Manifest support**: element, attribute and value completion and hover in plugin `.xml` files, plus checks for unknown elements and attributes, malformed versions, a missing Lua file and a Lua file with no top-level `return`.
- **Bump Version and Package Plugin (zip)** zips the manifest and its Lua files into `dist/`; for grandMA3 it first raises the manifest `Version` (patch, minor or major).
- **Set Up Lua Language Server Definitions** writes `---@meta` stubs of both APIs into `.vscode/grandma-stubs` and links them from `.luarc.json`, so the Lua language server (`sumneko.lua`) knows `Printf`, `Cmd`, `Root()` and `gma.*`, types their parameters and completes `handle:Method()`. The stubs live in the workspace, so they can be committed. The extension offers this once per workspace when the Lua language server is installed. Rerun it after updating the API list.
- **Quick fixes** on the lint warnings: replace a misspelt API function with the suggested one, add `local` to a global assignment (when `ma3.lint.globals` is on), and add a `coroutine.yield(0.1)` (or `gma.sleep(0.1)` on grandMA2) to a loop that never yields. Changing a `ma3.*` setting re-checks open files.
- **Lua tests on the console.** Put `test('name', function() ... end)` calls in a `*.test.lua` file and run it from the Testing panel or with **Run Lua Tests in This File on Console** (grandMA3 or grandMA2, by the same rules as Run on Console). The file runs on the console through the bridge in its own environment, so its globals don't leak into the show; each test runs under `pcall`, a failure points at its line, and print output appears in the test output. Helpers: `assertEq`, `assertNe`, `assertTrue`, `assertFalse`, `assertNil`, `assertNotNil`, `assertMatch`, `assertError`, and `beforeEach` / `afterEach` (which run even after a failure, so use them to clean up). Tests run on the console's UI thread and freeze it for up to `ma3.test.timeout` seconds (default 10), so use onPC with a throwaway show.
- **Export Plugin to USB Stick** copies the manifest and Lua file(s) onto a removable drive in the folder the console reads: `<stick>/grandMA3/gma3_library/datapools/plugins` (or a `gma3_library` already at the root) for grandMA3, `<stick>/gma2/plugins` for grandMA2. It lists the removable drives, asks before replacing files, and can copy the console-side import command. `ma3.usb.path` sets a fixed stick or folder.
- **Checks**: `while true do` loops that never yield (`coroutine.yield`, `gma.sleep`), break or return.

### Conditional commands

What each console does with a condition in a command string (`Cmd("...")`, `gma.cmd("...")`), checked on onPC (grandMA2 3.9.61.1, grandMA3 2.5.1.0):

| | grandMA2 | grandMA3 |
| --- | --- | --- |
| `[$var==5] Off Page 3` | runs the rest of the line only if true; compares text; `==` `>` `<` `<=` `>=` | never runs |
| `[$var=5]`, `[$var!=5]` | never true, so the line never runs | never runs |
| `If` / `EndIf` / `IfOutput` / `IfActive` / `IfProg` | selection filters, not branches (`If $var==1 Go+` tests nothing) | same |
| Condition in Lua | `gma.show.getvar` returns **text** (`"7"`) or nil | `GetVar(UserVars(), "x")` returns a number or text, as stored |

The extension helps with this inside command strings:

- **Completion**: on grandMA2, `[condition]` at the start of a string, comparison operators and `]` inside an open condition, and keyword completion after the closed condition; `If`, `EndIf`, `IfOutput`, `IfActive` and `IfProg` on both consoles, with the objects they filter offered after `If`.
- **Hover**: the `If` family on both consoles; anything inside a grandMA2 `[condition]`.
- **Checks**: on grandMA3 a `[condition]` prefix (`bracket-ma3`); on grandMA2 an unclosed or empty condition, a missing command, an unsupported operator, a missing operator; on both an `If` followed by a comparison (`if-not-branch`) and an `EndIf` with no `If`; on grandMA2 `gma.show.getvar(...)` compared with a number (`getvar-number`, quick fix wraps it in `tonumber`).
- Snippets: `ma3if`, `ma2if` (Lua conditions around `Cmd` / `gma.cmd`) and `ma2cond` (a `[condition]` command line).

## grandMA3

- **API completion, hover, signature help** for the global and object (`handle:Method()`) Lua API, built from the console's own `HelpLua` output. Run **Update API from Console (grandMA3)** (needs the bridge) to read the list from the running console with `GetApiDescriptor`, with a summary of what was added, removed or changed since the list you had; or **Import API from HelpLua File** to load `gma3_library/grandMA3_lua_functions.txt` by hand.
- **New Plugin** creates `Name/Name.lua` and `Name/Name.xml`. **Copy Import Command for Plugin** copies `Import Plugin Library "Name" At Plugin N /nc`.
- **Live completion** while the LuaBridge runs (`ma3.liveCompletion`; each lookup costs a few milliseconds of console time and is cached): real group, sequence, macro, preset, layout and timer numbers with their labels inside `Cmd` strings (**Refresh Show Objects for Completion** forces a refresh), `Enums.*` names and members, and attribute names inside `GetAttributeIndex("...")` and `Cmd("Attribute ...")`.
- **Object path completion**: after a literal path such as `Root().ShowData.DataPools[1].`, the children and property names of that object complete from the console (only chains that start at `Root()`, with names, `[n]` indexes and `["name"]`; children whose names need `["..."]` are left out).
- **grandMA3 Objects view** (Explorer sidebar; also grandMA2, see below): browse the console object tree (`Root()` and below). Right-click an object to copy its Lua path (`Root()[14][14]`), copy its address (`14.14`) or insert the path at the cursor. Hovering a node lists the properties of its class, and **Show Properties** prints each property with its type, read-only flag, enum collection and (grandMA3, bridge running) current value.
- **Property completion and hover** (grandMA3): inside `obj:Get("...")`, `obj:Set("...", "...")`, `SetChildren` and `SetChildrenRecursive`, property names complete with their type and enum values, and `Set` offers the enum names the property accepts (`Yes`, `No`, `Off` and so on). A receiver written as a literal `Root()...` path is asked for its class, so the list shrinks to that object's properties; other receivers see every property name. Hover on a property name shows its type, read-only flag and values. The schema (657 classes, 409 enums from grandMA3 onPC 2.5.1, and grandMA2 3.9 class properties) is bundled in `data/props.json` and works without a console.
- **Lua checks**: a misspelt API function (`printf` for `Printf`), an API function called with no arguments, `Cmd()` inside a loop, and heavy calls (`ObjectList`, `:Children()`, `CmdIndirectWait`) inside a `Timer` or `HookObjectChange` callback. `ma3.lint.globals` adds a hint for assignments without `local`.
- Snippets: `ma3plugin`, `cmd`, `printf`, `forchildren`, `pcall`, `yield`, `ma3if`.

### OSC (grandMA3)

grandMA3 has no Telnet, but its OSC input runs command-line commands: a message to `/cmd` (or `/<prefix>/cmd`) with one string argument, including `Lua "..."`. OSC is one-way, with no return values and no error text, so Lua that needs results still goes through the bridge. Verified on grandMA3 onPC 2.5.1.

- **Enable OSC Command Input on Console** (needs the bridge running) switches OSC input on, accepts the `127.0.0.0/8` range and lets OSC line 1 run `/cmd`; **Disable OSC Command Input on Console** reverses it. **The console then listens on UDP port 8000 on all network interfaces**, so other machines on the network can send it commands, Lua included, unless a firewall blocks the port. Leave it off when you aren't using it, and use onPC with a throwaway show.
- **Send Command to Console (OSC)** and **Send Selected Lines to Console as Commands (OSC)** send commands (spaced `ma3.osc.gapMs` apart) and log them in the **grandMA Console** panel. When the bridge is running the extension first checks OSC input is on; without it, UDP cannot tell a closed port from success. Settings: `ma3.osc.host`, `ma3.osc.port` (8000), `ma3.osc.prefix` (empty). `NewShow`, `LoadShow`, `Delete` and similar ask first.
- **Install LuaBridge on Console** for grandMA3 copies the plugin and, if you choose, imports and starts it over OSC (OSC command input must already be on; the first time, switch it on on the console by hand).
- **Deploy and Reload on Console** uses OSC when the bridge isn't running (`ma3.deployAndRun.via`: `auto`, `bridge`, `telnet` or `osc`).

## grandMA2

- **`gma.*` completion, hover and signature help** for the grandMA2 Lua API. grandMA2 has no HelpLua dump, so the list is curated from MA's documentation and what was seen working on onPC 3.9.61; a function missing from it is a gap in the list, not proof it doesn't exist. **Check grandMA2 API List Against Console** (needs LuaBridge_MA2) walks the real `gma` table and reports functions the list lacks and listed ones your console doesn't have.
- **New grandMA2 Plugin** creates `Name/Name.lua` and a `<MA ...>` manifest with `<Plugin index name luafile />` (`ma3.ma2.version`, default 3.9.61, sets the manifest version).
- **Deploy and Reload** imports over the slot (`Import "Name" At Plugin N /o /nc`, how grandMA2 reloads a plugin) and calls the plugin by name through the LuaBridge_MA2 plugin.
- **Lua checks**: a misspelt `gma.*` function, a `gma.*` call with no arguments, and `gma.cmd()` inside a loop (it is synchronous, about 0.46 s per call on onPC).
- The LuaBridge_MA2 plugin and the grandMA3 one speak the same protocol from their own folders.

### Telnet (grandMA2)

grandMA2 also has a Telnet command line (port 30000) and System Monitor (port 30001). The extension uses them for what the file bridge cannot do: starting the bridge itself, sending plain commands, and reading console messages. Lua you run to get return values still goes through the bridge. Telnet is plain text, so keep it to onPC on this machine or a trusted network. Verified on grandMA2 onPC 3.9.61; grandMA3 onPC does not listen on these ports.

Enable Telnet (the remote command line) on the console and set `ma3.telnet.user` to the user profile to log in as. Many profiles have no password; if yours does, run **Set Telnet Password** (stored in VS Code's secret storage, never in settings). Settings: `ma3.telnet.host`, `ma3.telnet.port` (30000), `ma3.telnet.monitorPort` (30001), `ma3.telnet.gapMs` (400; the console drops lines that arrive faster).

- **Install LuaBridge on Console** copies LuaBridge_MA2 into the plugins folder, imports it into a pool slot (asks; `ma3.bridge.slot`, default 99) and starts it, then waits for the heartbeat. Run **Run File or Selection on Console** right after. It leaves a bridge that is already running alone.
- **Send Command to Console (Telnet)** and **Send Selected Lines to Console as Commands (Telnet)** run command-line commands and print the reply, including `Error #n:` lines, in the **grandMA Console** panel. A multi-line send and commands such as `NewShow`, `LoadShow` and `Delete` ask first, and a send stops at the first error. A console pop-up (such as an overwrite prompt) swallows the commands queued behind it.
- **Start Console Monitor (Telnet)** streams the System Monitor (Lua runtime errors, command input) into the same panel; **Stop Console Monitor** ends it.
- **Deploy and Reload on Console** uses Telnet when the bridge isn't running (`ma3.deployAndRun.via`: `auto`, `bridge` or `telnet`).
- Import takes every file in the plugins folder whose name starts with the plugin's name, so a leftover `Name.xml.backup-...` next to a plugin makes the console import a duplicate; the extension warns when it sees one.

- **Live show completion**: inside `gma.cmd("...")` strings, group, sequence, macro, layout, plugin and effect numbers complete with their labels from the show (`ma3.liveCompletion`; needs LuaBridge_MA2; refreshed at most once a minute). Presets are not covered.
- **Object browser**: the **grandMA3 Objects** view in the Explorer has a switch button for grandMA2. It lists `Root 1` to `Root 30` and expands children lazily through `gma.show.getobj` (500 slots per level; empty slots are skipped). Right-click copies `gma.show.getobj.handle("Root 3.2")`, or the address `Root 3.2`; an object with no pool number has no address.

Not covered for grandMA2 yet: enum completion and object path completion (both grandMA3 only).

Lua language features (syntax, linting) come from the bundled `sumneko.lua` pack.

## Develop

```
npm test           # unit tests
npm run test:ui    # drive the commands in a real VS Code (needs the LuaBridge plugin running on grandMA3 onPC)
npm run build-api  # rebuild data/api.json from the local HelpLua file
npm run package    # build the .vsix
```
