# Changelog

## 0.4.10

- **Hot reload now works** (`ma3.deployOnSaveReload`, off by default): with deploy on save, a pool slot in `ma3.deployAndRun.slot` and the LuaBridge running, each save re-imports and starts the plugin on the console. In 0.4.8 the setting was named `ma3.deployOnSave.reload`, which VS Code could never read because `ma3.deployOnSave` is itself a setting; it is renamed. Tested live on grandMA2 onPC.
- **grandMA2 Deploy and Reload on Console** now waits a second after the import and starts the plugin by its pool slot; started by name straight after the import, nothing ran. The reload also gets a longer time limit than the 2 s default.
- **Completion with no console**: grandMA3 `Root().` paths complete from the bundled tree (children and properties, marked as a bundled sample), and `Cmd("... Macro ")` offers the numbers and names the project's own files already use (marked "used in this project").
- **Run and Reload failures** offer a **Connect...** button that opens the connection menu.
- The save hook shows an error in the **grandMA Devkit** panel instead of swallowing it.

## 0.4.9

- **Marketplace icon**: the MA Lighting logo on a solid white 512 px square (no transparency, no checkerboard), proportions kept. 0.4.8 replaced it with the BLT logo by mistake.

## 0.4.8

- **grandMA2 address completion**: inside `gma.show.getobj.handle("Root 3.")` (either quote), the child numbers and names under the address typed so far complete from the console, one level at a time (needs LuaBridge_MA2). With no console they complete from the bundled grandMA2 tree instead, marked "(bundled sample)": one sample per class path, so a pool lists only what was sampled.
- **Hot reload** (`ma3.deployOnSave.reload`, off by default): with deploy on save, a pool slot in `ma3.deployAndRun.slot` and the LuaBridge running, each save re-imports and starts the plugin on the console.
- **Marketplace icon**: the BLT logo on a solid white square (512 px, no transparency).
- **Release pipeline**: pushing a version tag now also creates the GitHub release with the VSIX attached and this changelog section as its notes.

## 0.4.7

Ease of use, for every skill level. No feature was removed.

- **Get Started walkthrough** (Welcome page, or **grandMA: Open Get Started**): choose your console, create a plugin, connect, run, deploy. A one-time notice points to it.
- **Status-bar connection item**: shows `grandMA3` or `grandMA2` for the file you are in, with a check mark when the LuaBridge is running. Click it for **grandMA: Connect to the Console**, a menu of what to do next (install the LuaBridge, switch on OSC or set the Telnet password, check the connection, run, deploy).
- **The Command Palette only lists what fits.** In a grandMA3 file the Telnet commands, the MA2 plugin template and the MA2 API check are hidden; in a grandMA2 file OSC, the grandMA3 API commands, the profiler and the designers are hidden. With no Lua file open everything is listed. Commands that need a tree or view item are no longer listed in the palette.
- **Variables behind one menu**: the 27 variable commands are reached through **grandMA: Variables...** (and the views and context menus). `ma3.vars.enabled` (default on) hides the Console Variables and Variable Bank views and that menu; variable checks and completion are unaffected.
- **One output panel**: console replies and Show Properties now print in **grandMA Devkit**, not in two more panels. Plain confirmations (bridge installed, import command copied, API loaded) show in the status bar instead of a pop-up.
- **Console per project**: **grandMA: Set Console for This Project** (also in the status-bar menu) saves grandMA3, grandMA2 or auto-detect in the project's `.vscode/settings.json`. With a console set, the palette follows it even when no file is open; other projects are unaffected.
- **README**: Quick start and a "How it connects" table come first; the tables of console behaviour for conditions and variables moved to `docs/console-behaviour.md`.

## 0.4.6

- **grandMA: Open Dialog Designer** (grandMA3 MessageBox, stage A): design a dialog or a menu flow of linked dialogs. Edit title, message, buttons, text inputs, switches and selectors with a live preview, and link each button to the next dialog. Problems show as you type (duplicate button values, links to missing dialogs, unreachable dialogs, repeated names). Insert at cursor or copy the Lua (one MessageBox call, or one function per dialog that branches on the button pressed), import literal MessageBox({...}) calls from the open file or selection, and show the dialog on a connected grandMA3 console.
- **grandMA: Open Overlay Designer** (stage B): lay out a grandMA3 UI visually and get the Lua. Two modes, both written the way shipping plugins do it: a window (BaseInput with TitleBar, CloseButton and a UILayoutGrid of cells, nested grids, buttons with click handlers, fixed or shared row and column sizes) or free screen objects (Button and AppearancePreview with X, Y, W, H appended to a display's ScreenOverlay, with a close function). Click to select, drag to move and resize in screen mode, problems as you type (names, cells outside the grid, overlaps, handlers). Insert, copy, import back a design the designer wrote (it is saved inside the code), and show it on a connected grandMA3 console (screen designs come down again after 8 seconds).

## 0.4.5

- Command grammar hints: Cmd() strings are checked against the grandMA2 / grandMA3 command grammar (unknown keywords, the other console's keywords, unknown `/options`, a stray `Thru`) (`ma3.lint.commandGrammar`).
- Show-aware hints: a Cmd() reference to a pool object that is not in the loaded show is marked, with the nearest numbers that exist (`ma3.lint.showRefs`).
- Frame budget: a `Timer`, `HookObjectChange` or `gma.timer` callback that reaches `ObjectList`, `:Children()` and other heavy calls through local functions gets a hint naming the chain (`heavy-reachable`, `ma3.lint.frameBudget`), and a CodeLens above each callback, signal handler and plugin function counts the heavy calls it reaches (`ma3.codelens.frameBudget`).
- grandMA: Profile on the Console runs the open grandMA3 Lua file under a profiler for `ma3.profiler.seconds` (default 3): every `Timer` and `HookObjectChange` callback is timed (calls, average, max, total) and the frame-budget CodeLens shows the measured numbers next to the static count. Line samples need the console's hook slot to be free; on a console that already has one, times are still measured but samples read 0.
- grandMA: Open Console REPL and Inspector: a panel where you type a Lua expression or statement and run it on the console (grandMA3 or grandMA2, through the bridge). Results are an expandable tree: grandMA3 objects show class, name, address and child count and open into their children and properties; tables open into their keys. Each node can be copied, inserted at the cursor, shown with Show Properties (for `Root()[n]` paths) or added to a watch list that refreshes on demand or every 2 s. Up/Down recall history.
- **Find Usages of Console Object** lists every Cmd() string and macro line that uses `Macro 12`, `Preset 2.5` and so on (ranges included) and says what the loaded show holds under that number; **at Cursor** from the editor context menu.

## 0.4.4

- The `bracket-ma3` quick fix now writes safe Lua: an unset or text variable skips the command instead of raising an error, numbers are read the way grandMA2 reads them, and conditions that can't be translated safely (`!=`, grandMA2 system variables, quoted numbers, ordering two variables, odd `$` operands) get no fix.
- A Lua file's console (grandMA2 or grandMA3) is now detected from the `ma3.target` setting, the plugin manifest, the folder name and the API names it calls, not only from `gma.` calls.
- `Enums.*` completion and hover for grandMA3 work without a console, from the bundled enum tables. Live console data is still preferred when the bridge runs.
- grandMA2 object tooltips and Show Properties list the values of On/Off and Yes/No properties; value lists seen on the console are marked "e.g.".
- The grandMA2 property data covers 61 more console classes and 109 more value lists, each written to a grandMA2 onPC 3.9 console and read back. The 63 lists known to be whole (read off the console's dropdown, or walked by index to the console's end-of-list marker, such as DMX In Merge, sheet Readout and arrangement Axis) are shown as complete; the rest are marked "e.g.".
- Tests for grouped `&&` / `||` conditions, `[$x]` with no operator and `]` inside quotes.
- Workspace scans cache plugin manifests per folder.
- The object tree view works without a console: when the LuaBridge isn't running it browses the bundled grandMA3 and grandMA2 trees (one sample per class path) and the header says "offline".
- grandMA3 command strings: hover any of the 358 documented keywords inside `Cmd("...")` for its description, shortcut and a link to its manual page, and complete them (after the common verbs, objects and modifiers).
- Object tree tooltips list the verified command-line forms of an object (with a manual link, or marked undocumented) and the command that creates one.
- New commands: grandMA: Search Object Tree (class, name, Lua path, address or command form, offline) with copy, insert and show-properties actions, and grandMA: Insert Creation Command.
- Property hover lists a whole enum (up to 64 values, then how many more) instead of the first 24.

## 0.4.3

See the [release notes](https://github.com/badasslighting/grandma-devkit/releases/tag/v0.4.3).
