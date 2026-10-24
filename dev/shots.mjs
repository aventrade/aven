// node dev/shots.mjs <out-dir> [name:url:scrollY:width:height:mobile ...]
// Takes stills of the running local site (npm run dev) for review and for the reel.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const [out, ...specs] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
for (const spec of specs) {
  const [name, url, y = '0', w = '1440', h = '900', mobile = '0', js = ''] = spec.split('|');
  const tab = await launch({ width: +w, height: +h, mobile: mobile === '1', scale: 1 });
  await tab.goto(url, 3500);
  if (js) { await tab.eval(js); await sleep(1500); }
  await tab.eval(`(async () => { const y = ${y.startsWith("#") ? `document.querySelector("${y}").getBoundingClientRect().top + scrollY - 70` : y}; const step = Math.max(200, y / 8); for (let s = 0; s <= y; s += step) { scrollTo(0, s); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, y); })()`);
  await sleep(2200);
  writeFileSync(join(out, name + '.png'), await tab.shot());
  console.log('shot', name);
  await tab.close();
}
