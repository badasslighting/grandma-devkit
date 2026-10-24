'use strict';

function luaTemplate(name) {
  return `-- ${name}
local pluginName = select(1, ...)
local componentName = select(2, ...)
local signalTable = select(3, ...)
local myHandle = select(4, ...)

local function Main(displayHandle)
    Printf("${name} started")
end

local function Cleanup()
end

return Main, Cleanup
`;
}

function xmlTemplate(name, dataVersion = '2.0.0.0') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<GMA3 DataVersion="${dataVersion}">
\t<Plugin Name="${name}" Version="0.1.0">
\t\t<ComponentLua Name="${name}" FileName="${name}.lua" />
\t</Plugin>
</GMA3>
`;
}

// Plugin names become file names and console identifiers; keep them to letters, digits, _ and -.
function validName(name) {
  return /^[A-Za-z][\w-]*$/.test(name || '');
}

module.exports = { luaTemplate, xmlTemplate, validName };
