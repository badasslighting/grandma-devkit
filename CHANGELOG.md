# Changelog

## 0.4.4 (unreleased)

- The `bracket-ma3` quick fix now writes safe Lua: an unset or text variable skips the command instead of raising an error, numbers are read the way grandMA2 reads them, and conditions that can't be translated safely (`!=`, grandMA2 system variables, quoted numbers, ordering two variables, odd `$` operands) get no fix.
- A Lua file's console (grandMA2 or grandMA3) is now detected from the `ma3.target` setting, the plugin manifest, the folder name and the API names it calls, not only from `gma.` calls.
- `Enums.*` completion and hover for grandMA3 work without a console, from the bundled enum tables. Live console data is still preferred when the bridge runs.
- Tests for grouped `&&` / `||` conditions, `[$x]` with no operator and `]` inside quotes.
- Workspace scans cache plugin manifests per folder.

## 0.4.3

See the [release notes](https://github.com/badasslighting/grandma-devkit/releases/tag/v0.4.3).
