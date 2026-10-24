'use strict';
// Launches an installed VS Code with this extension loaded and runs suite.js inside the extension host.
// Uses throwaway user-data and extensions folders so the real profile and any installed copy are untouched.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const exe = process.env.VSCODE_EXE || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');
if (!fs.existsSync(exe)) {
  console.error(`VS Code not found at ${exe} (set VSCODE_EXE).`);
  process.exit(2);
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ma3dev-ui-'));
const workspace = path.join(scratch, 'ws');
fs.mkdirSync(workspace);
const env = { ...process.env, MA3DEV_UI_RESULT: path.join(scratch, 'result.json'), MA3DEV_UI_WORKSPACE: workspace };
delete env.ELECTRON_RUN_AS_NODE;

const r = spawnSync(
  exe,
  [
    workspace,
    '--extensionDevelopmentPath', path.resolve(__dirname, '..', '..'),
    '--extensionTestsPath', path.join(__dirname, 'suite.js'),
    '--user-data-dir', path.join(scratch, 'user'),
    '--extensions-dir', path.join(scratch, 'ext'),
    '--disable-extensions',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
  ],
  { env, stdio: 'inherit', timeout: 120000 }
);

let result = null;
try {
  result = JSON.parse(fs.readFileSync(env.MA3DEV_UI_RESULT, 'utf8'));
} catch (_) {
  /* suite never reported */
}
if (result) {
  for (const t of result.tests) console.log(`${t.ok ? 'ok  ' : 'FAIL'} ${t.name}${t.ok ? '' : `\n     ${t.error}`}`);
  console.log(`${result.tests.filter((t) => t.ok).length}/${result.tests.length} passed`);
} else {
  console.error(`No result written (exit ${r.status}). Scratch: ${scratch}`);
}
fs.rmSync(scratch, { recursive: true, force: true });
process.exit(result && result.tests.every((t) => t.ok) ? 0 : 1);
