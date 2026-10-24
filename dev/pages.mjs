// Loads landing, trade (with a few trades) and journal in one profile; screenshots and page errors.
import { writeFileSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
const [out, base = 'http://localhost:8792'] = process.argv.slice(2);
const tab = await launch({ width: 1440, height: 900 });
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs=[];addEventListener('error',e=>__errs.push(e.message+' @'+e.filename+':'+e.lineno));addEventListener('unhandledrejection',e=>__errs.push(String(e.reason)))` });
const errs = async name => console.log(name, 'errors', await tab.eval('JSON.stringify(__errs)'));
await tab.goto(base + '/', 6000);
await errs('home');
for (const [name, sel] of [['L0', null], ['L1', '#markets'], ['L2', '#how'], ['L3', '#cli'], ['L4', '#roadmap'], ['L5', '#faq'], ['L6', '.nos']]) {
  if (sel) await tab.eval(`(async()=>{const y=document.querySelector('${sel}').getBoundingClientRect().top+scrollY-70;for(let s=scrollY;Math.abs(s-y)>10;s+=(y-s)/3){scrollTo(0,s);await new Promise(r=>setTimeout(r,60))}scrollTo(0,y)})()`);
  await sleep(1800);
  writeFileSync(`${out}/${name}.png`, await tab.shot());
}
await tab.goto(base + '/trade/?m=ETH', 6000);
for (const c of ['long eth 10x 800', 'short sol 5x 400', 'close eth', 'long btc 25x 600', 'close btc', 'long gold 10x 500']) { try { await tab.eval(`avenRun('${c}')`); } catch (e) { console.log('cmd fail', c, e.message); } await sleep(500); }
await errs('trade');
await tab.goto(base + '/trade/?view=journal', 5000);
await tab.eval(`document.querySelector('[data-tag=fomo]')?.click()`);
await sleep(600);
writeFileSync(`${out}/J.png`, await tab.shot());
await errs('journal');
await tab.close();
const t2 = await launch({ width: 1440, height: 900 });
await t2.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs=[];addEventListener('error',e=>__errs.push(e.message))` });
await t2.goto(base + '/docs/', 4000);
writeFileSync(`${out}/D0.png`, await t2.shot());
await t2.eval(`document.querySelector('[data-go=cli]').click()`); await sleep(1500);
writeFileSync(`${out}/D1.png`, await t2.shot());
console.log('docs errors', await t2.eval('JSON.stringify(__errs)'), 'markets rows', await t2.eval(`document.querySelectorAll('#mkTable tr').length`));
await t2.close();
