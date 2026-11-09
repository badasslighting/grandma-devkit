# Changelog

## 0.4.5

- Command grammar hints: Cmd() strings are checked against the grandMA2 / grandMA3 command grammar (unknown keywords, the other console's keywords, unknown `/options`, a stray `Thru`) (`ma3.lint.commandGrammar`).
- Show-aware hints: a Cmd() reference to a pool object that is not in the loaded show is marked, with the nearest numbers that exist (`ma3.lint.showRefs`).
- Frame budget: a `Timer`, `HookObjectChange` or `gma.timer` callback that reaches `ObjectList`, `:Children()` and other heavy calls through local functions gets a hint naming the chain (`heavy-reachable`, `ma3.lint.frameBudget`), and a CodeLens above each callback, signal handler and plugin function counts the heavy calls it reaches (`ma3.codelens.frameBudget`).
- grandMA: Profile on the Console runs the open grandMA3 Lua file under a profiler for `ma3.profiler.seconds` (default 3): every `Timer` and `HookObjectChange` callback is timed (calls, average, max, total) and the frame-budget CodeLens shows the measured numbers next to the static count. Line samples need the console's hook slot to be free; on a console that already has one, times are still measured but samples read 0.
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
