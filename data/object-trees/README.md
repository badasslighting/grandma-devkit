# grandMA object trees

Object trees of grandMA2 onPC 3.9.61.1 and grandMA3 onPC 2.5.1.0 with per-class properties.

- `index.html`: standalone interactive tree (search, addresses, properties panel). Open it locally in a browser.
- `ma3_tree.json`: tree structure. Node keys: `i` index, `c` class, `n` name, `k` children, `r`/`m` run of identical items, `s` pool slot capacity, `o`/`x` items or instances omitted.
- `ma3_props.json`: per-class property name, type, read-only flag and enum, plus every enum's accepted values.
- `ma2_tree.json`: one node per class path, plus the slots the console's `list` does not show. Node keys: `i` index (the number `cd` takes), `c` internal class as `gma.show.getobj.class()` returns it, `n` name, `k` children, `p` key into `ma2_props.json`, `w` first command-line form, `h` note (`not listed`, `empty in crawled show`).
- `ma2_props.json`: `classes` keyed by `cd` route (`13.1.1`). Each has `n` name, `ic` internal class, `cols` (property, kind of value, one example value with names removed), `cd` route, `kw` command-line forms that reach the object (each checked on onPC with `cd <form>`), `as` the `Assign` parameters from the onPC help, `ix` how items are numbered, `mc` most children seen. `meta` lists every object keyword with its shortcut, syntax and the classes it reaches. MA2 option lists are not exposed by the console.
- `ma2_attributes.json`: the attribute library: name, screen name, preset type, feature, encoder grouping, identified as.

Station details (network, users, profiles, hardware, clock and time zone, show names) and show values are not included.
