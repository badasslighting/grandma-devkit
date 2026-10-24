const fs = require('fs');
let s = fs.readFileSync('lib/telnet.js', 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.replace(a, b); };
rep("const sleep = (ms)", `// The console colours its output with ANSI codes, redraws prompts with carriage returns and echoes
// "Executing : <command>"; keep the last redraw of a line and drop prompt-only lines.
function cleanLine(raw) {
  const text = raw.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  const parts = text.split('\r').map((p) => p.trim()).filter(Boolean);
  const line = parts.length ? parts[parts.length - 1] : '';
  return /^\[[^\]]*\]>$/.test(line) ? '' : line;
}

const sleep = (ms)`);
rep("    for (const raw of parts) this.pushLine(raw.replace(/\r$/, ''));", "    for (const raw of parts) {\n      const line = cleanLine(raw);\n      if (line) this.pushLine(line);\n    }");
rep("    if (this.partial.trim()) collect.lines.push(this.partial.trim());", "    const tail = cleanLine(this.partial);\n    if (tail) collect.lines.push(tail);");
rep("    if (BAD.test(this.user) || BAD.test(this.password)) throw new Error('The Telnet user and password may not contain quotes or line breaks.');", "    if (BAD.test(this.user) || BAD.test(this.password || '')) throw new Error('The Telnet user and password may not contain quotes or line breaks.');");
rep("const lines = await this.exchange(`Login \"${this.user}\" \"${this.password}\"`, 600, 4000);", "// MA user profiles often have no password (offline use): then it is just Login \"name\".\n    const lines = await this.exchange(this.password ? `Login \"${this.user}\" \"${this.password}\"` : `Login \"${this.user}\"`, 600, 4000);");
rep("Check ma3.telnet.user and the stored password.", "Check ma3.telnet.user (and the password, if the user profile has one).");
rep("module.exports = { ConsoleTelnet, createParser, parseErrors,", "module.exports = { ConsoleTelnet, createParser, parseErrors, cleanLine,");
fs.writeFileSync('lib/telnet.js', s);
