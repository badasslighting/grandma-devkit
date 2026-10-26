# grandMA object trees

Object trees of grandMA2 onPC 3.9.x and grandMA3 onPC 2.5.x with per-class properties.

- `index.html`: standalone interactive tree (search, addresses, properties panel). Open it locally in a browser.
- `ma2_tree.json`, `ma3_tree.json`: tree structure. Node keys: `i` index, `c` class (MA2: name), `n` name, `k` children, `r`/`m` run of identical items, `s` pool slot capacity, `o`/`x` items or instances omitted.
- `ma3_props.json`: per-class property name, type, read-only flag and enum, plus every enum's accepted values.
- `ma2_props.json`: per-name property names and the kind of value seen. MA2 option lists are not exposed by the console.

Station details (network, users, profiles, hardware, show data values) and current property values are not included.
