# Which console?

The Devkit decides per Lua file: **grandMA2** when the code calls `gma.*` or the plugin manifest is a grandMA2 one, **grandMA3** otherwise. The folder name (`ma2`, `ma3`) counts too.

The status bar at the bottom shows the result. To force one console for everything, set `ma3.target` to `ma2` or `ma3`.
