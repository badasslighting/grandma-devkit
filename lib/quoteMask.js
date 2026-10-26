'use strict';

// Which characters sit inside "double quotes" (the quote characters themselves included). A Lua-escaped quote (\")
// inside a command string still opens or closes a quoted value, as it does for the console.
function quoteMask(text) {
  const mask = new Array(text.length).fill(false);
  let open = false;
  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    const at = i;
    if (ch === '\\' && text[i + 1] === '"') {
      ch = '"';
      i++;
    }
    if (ch === '"') {
      for (let k = at; k <= i; k++) mask[k] = true;
      open = !open;
    } else if (open) mask[i] = true;
  }
  return mask;
}

module.exports = { quoteMask };
