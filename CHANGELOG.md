# Changelog

## 0.4.4

- The `bracket-ma3` quick fix now writes safe Lua: an unset or text variable skips the command instead of raising an error, numbers are read the way grandMA2 reads them, and conditions that can't be translated safely (`!=`, grandMA2 system variables, quoted numbers, ordering two variables, odd `$` operands) get no fix.
- A Lua file's console (grandMA2 or grandMA3) is now detected from the `ma3.target` setting, the plugin manifest, the folder name and the API names it calls, not only from `gma.` calls.
- `Enums.*` completion and hover for grandMA3 work without a console, from the bundled enum tables. Live console data is still preferred when the bridge runs.
- grandMA2 object tooltips and Show Properties list the values of On/Off and Yes/No properties; value lists seen on the console are marked "e.g.".
- The grandMA2 property data covers 61 more console classes and 68 more value lists, each written to a grandMA2 onPC 3.9 console and read back. Lists read straight off the console's dropdown (DMX In Merge: Off, HTP, LoTP; Image Size; PSN axis maps X, Y, Z) are shown as complete.
- Tests for grouped `&&` / `||` conditions, `[$x]` with no operator and `]` inside quotes.
- Workspace scans cache plugin manifests per folder.

## 0.4.3

See the [release notes](https://github.com/badasslighting/grandma-devkit/releases/tag/v0.4.3).
