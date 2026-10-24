'use strict';
// Launches VS Code in visual mode and screenshots its window over the Chrome DevTools protocol, so the
// capture is the window's own pixels (not the desktop). Usage: node test/ui/shots.js <outDir>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = path.resolve(process.argv[2] || 'shots');
const exe = process.env.VSCODE_EXE || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');
const PORT = 9333;
fs.mkdirSync(out, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ma3dev-shots-'));
const workspace = path.join(scratch, 'ws');
const sync = path.join(scratch, 'sync');
fs.mkdirSync(workspace);
fs.mkdirSync(sync);
const env = { ...process.env, MA3DEV_UI_SHOTS: sync, MA3DEV_UI_RESULT: path.join(scratch, 'result.json'), MA3DEV_UI_WORKSPACE: workspace };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  exe,
  [
    workspace,
    `--remote-debugging-port=${PORT}`,
    '--extensionDevelopmentPath', path.resolve(__dirname, '..', '..'),
    '--extensionTestsPath', path.join(__dirname, 'suite.js'),
    '--user-data-dir', path.join(scratch, 'user'),
    '--extensions-dir', path.join(scratch, 'ext'),
    '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
  ],
  { env, stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function workbenchWs() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === 'page' && /workbench/.test(t.url));
  return page && page.webSocketDebuggerUrl;
}

function capture(wsUrl, file) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id !== 1) return;
      ws.close();
      if (msg.error) return reject(new Error(msg.error.message));
      fs.writeFileSync(file, Buffer.from(msg.result.data, 'base64'));
      resolve();
    };
    ws.onerror = () => reject(new Error('cdp socket error'));
  });
}

(async () => {
  const taken = new Set();
  const end = Date.now() + 90000;
  while (Date.now() < end && !fs.existsSync(path.join(scratch, 'result.json'))) {
    for (const f of fs.readdirSync(sync).filter((n) => n.endsWith('.ready'))) {
      const name = f.slice(0, -6);
      if (taken.has(name)) continue;
      try {
        await capture(await workbenchWs(), path.join(out, `${name}.png`));
        taken.add(name);
        console.log(`captured ${name}.png`);
      } catch (e) {
        console.log(`capture ${name} failed: ${e.message}`);
      }
      fs.writeFileSync(path.join(sync, `${name}.done`), '');
    }
    await sleep(100);
  }
  if (fs.existsSync(path.join(sync, 'error.txt'))) console.log('suite error:', fs.readFileSync(path.join(sync, 'error.txt'), 'utf8'));
  child.kill();
  await sleep(500);
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(taken.size ? 0 : 1);
})();
