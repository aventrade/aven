// node dev/media-banner.mjs : renders .github/assets/banner.png (README) and social-preview.png (repo settings).
// Needs the local server running (npm run dev).
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
const DIR = new URL('../.github/assets/', import.meta.url);
mkdirSync(DIR, { recursive: true });
for (const [name, w, h, extra, scale] of [['banner', 1600, 560, '', 2], ['social-preview', 1280, 640, '&social', 1]]) {
  const tab = await launch({ width: w, height: h, scale });
  await tab.goto(`http://localhost:8792/dev/banner/?w=${w}&h=${h}${extra}`, 1500);
  for (let i = 0; i < 40 && !(await tab.eval('!!window.ready')); i++) await sleep(250);
  await sleep(500);
  writeFileSync(new URL(`${name}.png`, DIR), await tab.shot());
  console.log('wrote', name);
  await tab.close();
}
