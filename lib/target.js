'use strict';
const { maskCode } = require('./mask');
const { isMa2 } = require('./manifestSchema');

// Which console a plugin is written for: 'ma2' or 'ma3'. The `ma3.target` setting wins; otherwise a
// grandMA2 manifest (<MA ...>) or `gma.` calls in the code say grandMA2, anything else is grandMA3.
// `manifestXml` is the text of the plugin's manifest when the caller has found one.
function detectTarget(luaText, setting = 'auto', manifestXml = '') {
  if (setting === 'ma2' || setting === 'ma3') return setting;
  if (/\bgma\s*\./.test(maskCode(luaText || ''))) return 'ma2';
  if (manifestXml && isMa2(manifestXml)) return 'ma2';
  return 'ma3';
}

module.exports = { detectTarget };
