# grandMA object trees

Object trees of grandMA2 onPC 3.9.61.1 and grandMA3 onPC 2.5.1.0 with per-class properties.

- `index.html`: standalone interactive tree (search, addresses, properties panel). Open it locally in a browser.
- `ma3_tree.json`: tree structure. Node keys: `i` index, `c` class, `n` name, `k` children, `r`/`m` run of identical items, `s` pool slot capacity.
- `ma3_props.json`: per-class property name, type, read-only flag and enum, plus every enum's accepted values. The `nodes` map adds the schema for each class path, illustrative examples, creation commands and command forms verified against the exact Lua handle. MA3 nodes use `p` for this map key, `l` for the absolute Lua expression, and `a` for a verified numeric Root command when one is available. Lua indexes and command-line numbers can differ, particularly for executors and cues.
- `ma3_references.json`: searchable attribute, gel, factory hardkey and color reference tables.
- `ma2_tree.json`: one node per class path, plus the slots the console's `list` does not show. Node keys: `i` index (the number `cd` takes), `c` internal class as `gma.show.getobj.class()` returns it, `n` name, `k` children, `p` key into `ma2_props.json`, `w` first command-line form, `h` note (`not listed`), `u` first form is undocumented.
- `ma2_props.json`: `classes` keyed by `cd` route (`13.1.1`). Each has `n` name, `ic` internal class, `cols` (property, kind of value, one example value), `cd` route, `kw` command-line forms that reach the object (each checked on onPC with `cd <form>`), `as` the `Assign` parameters from the onPC help, `ix` how items are numbered, `mc` most children seen. `meta` lists every object keyword with its shortcut, syntax and the classes it reaches. MA2 option lists are not exposed by the console.
- `ma2_attributes.json`: the attribute library: name, screen name, preset type, feature, encoder grouping, identified as.

MA3 data was captured on onPC 2.5.1.0 on 2026-10-26. The tree represents one sample of each class path, while preserving each preset pool and the separate LivePatch, Patch and PsrPatch branches. Samples from different instances contribute to the property schema. Runtime UI paths describe the captured UI state and can change when windows or menus change. Blank examples do not imply a missing property. Binary file contents and plugin source are not included as examples; other numeric examples are synthetic.

The MA3 manual links refer to version 2.5. Only tested command forms are shown; a documented keyword does not imply that every internal class can be addressed with it. The page copies each node's captured absolute Lua expression instead of constructing one from visible object numbers.

Capture processing groups objects by their absolute Lua paths. Numeric command addresses can collide for distinct fixture handles, so they are never used as capture identities. `scripts/ma3Capture.js` performs this grouping, preserves separate preset pools and patch slots, and rejects duplicate Lua paths. The crawler refreshes child handles after reading properties because some temporary child objects can be regenerated during inspection.
