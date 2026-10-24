// Minimal Chrome DevTools Protocol driver: headless Chrome, one tab, screenshots. Used for stills and the reel.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function launch({ width = 1440, height = 900, mobile = false, scale = 1, profile = process.env.PROFILE } = {}) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--hide-scrollbars', '--mute-audio',
    '--enable-gpu-rasterization', `--user-data-dir=${profile || mkdtempSync(join(tmpdir(), 'aven-cdp-'))}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()); break; } catch { await sleep(200); }
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const tab = {
    send,
    async goto(url, wait = 2500) { await send('Page.navigate', { url }); await sleep(wait); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(format = 'png', quality = 92) {
      const r = await send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? quality : undefined });
      return Buffer.from(r.data, 'base64');
    },
    async close() { try { ws.close(); } catch {} proc.kill(); },
  };
  return tab;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
