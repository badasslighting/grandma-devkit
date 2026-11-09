'use strict';
// End-to-end check of the dialog and overlay designers in a real VS Code window. Launches VS Code with this
// extension (throwaway profile), lets driveSuite.js open the panels, and clicks inside the webviews over the Chrome
// DevTools protocol, then prints what the extension did to the editor and the clipboard.
// Usage: node test/ui/drive.js [outDir]   (outDir gets a screenshot per step)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = path.resolve(process.argv[2] || 'drive-out');
const exe = process.env.VSCODE_EXE || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');
const PORT = 9334;
fs.mkdirSync(out, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ma3dev-drive-'));
const workspace = path.join(scratch, 'ws');
const sync = path.join(scratch, 'sync');
fs.mkdirSync(workspace);
fs.mkdirSync(sync);
const resultFile = path.join(scratch, 'result.json');
const env = { ...process.env, MA3DEV_UI_DRIVE: sync, MA3DEV_UI_RESULT: resultFile, MA3DEV_UI_WORKSPACE: workspace };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  exe,
  [
    workspace,
    `--remote-debugging-port=${PORT}`,
    '--extensionDevelopmentPath', path.resolve(__dirname, '..', '..'),
    '--extensionTestsPath', path.join(__dirname, 'driveSuite.js'),
    '--user-data-dir', path.join(scratch, 'user'),
    '--extensions-dir', path.join(scratch, 'ext'),
    '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
  ],
  { env, stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json());

function cdp(wsUrl, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => { ws.close(); reject(new Error(`cdp ${method} timed out`)); }, 15000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id !== 1) return;
      clearTimeout(t);
      ws.close();
      if (msg.error) return reject(new Error(msg.error.message));
      resolve(msg.result);
    };
    ws.onerror = () => { clearTimeout(t); reject(new Error('cdp socket error')); };
  });
}

async function shot(name) {
  const page = (await targets()).find((t) => t.type === 'page' && /workbench/.test(t.url));
  const r = await cdp(page.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(r.data, 'base64'));
}

// Runs `body` inside the page of the designer whose document has element #marker. `d` and `w` are the inner
// document and window; the body returns a value (it may be async).
async function inPanel(marker, body) {
  const code = `(async () => { const f = document.getElementById('active-frame'); if (!f || !f.contentDocument) return { __none: true };
    const d = f.contentDocument, w = f.contentWindow; if (!d.getElementById(${JSON.stringify(marker)})) return { __none: true };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const btn = (t) => [...d.querySelectorAll('button')].find((b) => b.textContent === t);
    ${body} })()`;
  for (let tries = 0; tries < 40; tries++) {
    for (const t of await targets()) {
      if (!t.webSocketDebuggerUrl || /devtools/.test(t.url)) continue;
      try {
        const r = await cdp(t.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true });
        const v = r.result && r.result.value;
        if (v && !v.__none) return v;
      } catch (_) { /* not a webview target */ }
    }
    await sleep(300);
  }
  throw new Error(`panel with #${marker} not found`);
}

const DIALOG = 'flowmap';
const OVERLAY = 'stagewrap';
const handlers = {
  async 'dialog-import'() {
    return inPanel(DIALOG, `btn('Import from editor').click(); await sleep(700);
      return { note: d.getElementById('note').textContent, dialogs: [...d.querySelectorAll('#list .item')].map((e) => e.textContent), mock: d.getElementById('mock').innerText };`);
  },
  async 'dialog-insert'() {
    return inPanel(DIALOG, `btn('+ Dialog').click(); await sleep(300);
      d.querySelector('#list .item').click(); await sleep(200);
      const sel = d.querySelector('#edit .row select'); sel.value = 'dialog'; sel.onchange(); await sleep(300);
      btn('Insert at cursor').click(); await sleep(700);
      return { note: d.getElementById('note').textContent, problems: d.getElementById('probs').innerText, flow: d.getElementById('flowmap').innerText };`);
  },
  async 'dialog-copy'() {
    return inPanel(DIALOG, `btn('Copy Lua').click(); await sleep(500); return { note: d.getElementById('note').textContent };`);
  },
  async 'overlay-build'() {
    return inPanel(OVERLAY, `btn('+ Button').click(); await sleep(200); btn('+ Grid').click(); await sleep(300);
      btn('Insert at cursor').click(); await sleep(700);
      return { note: d.getElementById('note').textContent, items: d.getElementById('tree').innerText, problems: d.getElementById('probs').innerText, stageEls: d.querySelectorAll('.stage .el').length };`);
  },
  async 'overlay-screen'() {
    return inPanel(OVERLAY, `const m = d.getElementById('mode'); m.value = 'screen'; m.onchange(); await sleep(600);
      btn('+ Button').click(); await sleep(400);
      const e = d.querySelector('.stage .el.button'); const r0 = e.getBoundingClientRect();
      e.dispatchEvent(new w.PointerEvent('pointerdown', { clientX: r0.left + 5, clientY: r0.top + 5, pointerId: 1, bubbles: true }));
      e.onpointermove && e.onpointermove({ clientX: r0.left + 45, clientY: r0.top + 25 });
      e.onpointerup && e.onpointerup(); await sleep(300);
      btn('Copy Lua').click(); await sleep(500);
      return { note: d.getElementById('note').textContent, problems: d.getElementById('probs').innerText, items: d.getElementById('tree').innerText };`);
  },
  async 'overlay-import'() {
    const m = await inPanel(OVERLAY, `const mm = d.getElementById('mode'); mm.value = 'window'; mm.onchange(); await sleep(500);
      btn('Import from editor').click(); await sleep(700);
      return { note: d.getElementById('note').textContent, mode: d.getElementById('mode').value, items: d.getElementById('tree').innerText };`);
    return m;
  },
};

(async () => {
  const results = {};
  const seen = new Set();
  const end = Date.now() + 150000;
  while (Date.now() < end && !fs.existsSync(resultFile)) {
    for (const f of fs.readdirSync(sync).filter((n) => n.endsWith('.ready'))) {
      const name = f.slice(0, -6);
      if (seen.has(name)) continue;
      seen.add(name);
      try {
        await sleep(800);
        results[name] = handlers[name] ? await handlers[name]() : null;
        await shot(name);
      } catch (e) {
        results[name] = { error: e.message };
      }
      console.log(`step ${name}:`, JSON.stringify(results[name]));
      fs.writeFileSync(path.join(sync, `${name}.done`), '');
    }
    await sleep(120);
  }
  await sleep(300);
  let suite = null;
  try { suite = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch (_) { /* never reported */ }
  console.log('\nSUITE RESULT:\n' + JSON.stringify(suite, null, 2));
  child.kill();
  await sleep(500);
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(suite && suite.done ? 0 : 1);
})();
