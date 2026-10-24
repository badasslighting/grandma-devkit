# MA3dev for VScode

VS Code support for writing grandMA3 Lua plugins.

Unofficial community tool, not affiliated with or endorsed by MA Lighting. grandMA3 is a trademark of MA Lighting International GmbH.

- **API completion, hover, signature help** for the global and object (`handle:Method()`) Lua API, built from the console's own `HelpLua` output. Run **grandMA3: Import API from HelpLua File** to load the file for your software version (`gma3_library/grandMA3_lua_functions.txt`).
- **grandMA3: New Plugin** creates `Name/Name.lua` and `Name/Name.xml`.
- **grandMA3: Deploy Plugin to Plugins Folder** copies the manifest and the Lua files it names to the console's plugins folder (`ma3.pluginsPath`; defaults to the onPC folder on Windows). `ma3.deployOnSave` does it on every save.
- **grandMA3: Copy Import Command for Plugin** copies `Import Plugin Library "Name" At Plugin N /nc`.
- **Checks**: manifest problems (missing DataVersion, Name or Lua file, no top-level `return`) and `while true do` loops that never yield, break or return.
- Snippets: `ma3plugin`, `cmd`, `printf`, `forchildren`, `pcall`, `yield`.

Lua language features (syntax, linting) come from the bundled `sumneko.lua` pack.

## Develop

```
npm test           # unit tests
npm run build-api  # rebuild data/api.json from the local HelpLua file
npm run package    # build the .vsix
```

Not covered yet: enum completion, running code on a console.
