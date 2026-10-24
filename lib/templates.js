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

function ma2LuaTemplate(name) {
  return `-- ${name}
local function main(displayHandle, argument)
    gma.feedback("${name} started")
end

local function cleanup()
end

return main, cleanup
`;
}

// version is the grandMA2 software version, e.g. "3.9.61" -> major 3, minor 9, stream 61.
function ma2XmlTemplate(name, version = '3.9.61') {
  const [major, minor, stream] = String(version).split('.');
  return `<?xml version="1.0" encoding="utf-8"?>
<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" major_vers="${major || 3}" minor_vers="${minor || 9}" stream_vers="${stream || 61}">
\t<Plugin index="0" execute_on_load="0" name="${name}" luafile="${name}.lua" />
</MA>
`;
}

// Plugin names become file names and console identifiers; keep them to letters, digits, _ and -.
function validName(name) {
  return /^[A-Za-z][\w-]*$/.test(name || '');
}

module.exports = { luaTemplate, xmlTemplate, ma2LuaTemplate, ma2XmlTemplate, validName };
