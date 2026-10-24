'use strict';
// Usage: node scripts/build-api.js [path/to/grandMA3_lua_functions.txt]
const fs = require('fs');
const path = require('path');
const { parseHelpLua } = require('../lib/helpParser');

const src =
  process.argv[2] ||
  path.join(process.env.ProgramData || '', 'MALightingTechnology', 'gma3_library', 'grandMA3_lua_functions.txt');
const api = parseHelpLua(fs.readFileSync(src, 'utf8'));
fs.writeFileSync(path.join(__dirname, '..', 'data', 'api.json'), JSON.stringify(api));
console.log(`${api.global.length} global + ${api.object.length} object functions from ${src}`);
