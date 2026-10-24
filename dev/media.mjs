// node dev/media.mjs <out-dir> [base] : the screenshots in docs/media, taken from the running site with live data
// and real paper trades placed through the app's own command line.
import { writeFileSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
const [out, base = 'http://localhost:8792'] = process.argv.slice(2);
const shot = async (tab, name) => { writeFileSync(`${out}/${name}.png`, await tab.shot()); console.log('shot', name); };
const scrollTo = (tab, sel) => tab.eval(`scrollTo(0, document.querySelector('${sel}').getBoundingClientRect().top + scrollY - 70)`);

let tab = await launch({ width: 1600, height: 960 });
await tab.goto(base + '/', 7000);
await shot(tab, 'landing');
await scrollTo(tab, '#cli'); await sleep(12000);
await shot(tab, 'sandbox');
await tab.close();

tab = await launch({ width: 1600, height: 1000 });
await tab.goto(base + '/trade/?m=BTC', 7000);
for (const c of ['long btc 20x 1500', 'short eth 10x 1000', 'long hype 5x 600', 'long nvda 5x 800', 'pair long msft short qqq 500 3x', 'long sol 10x 400', 'close sol', 'short gold 10x 500', 'close gold', 'long eth 5x 300', 'alert btc above 85000'])
  { try { await tab.eval(`avenRun(${JSON.stringify(c)})`); } catch (e) { console.log('skip', c, e.message.split('\n')[0]); } await sleep(700); }
await tab.eval(`[...document.querySelectorAll('.toast')].forEach(t => t.remove())`);
await sleep(4000);
await shot(tab, 'trade');
await tab.eval(`document.querySelector('[data-act=stress]').click()`); await sleep(7000);
await shot(tab, 'stress');
await tab.eval(`document.querySelector('[data-act=stress]').click()`);
await tab.eval(`document.getElementById('cmdOpen').click()`); await sleep(300);
for (const c of ['long btc 10x 500', 'tp btc ' + Math.round(await tab.eval(`(async()=>(await import('/assets/feed.js')).marks.BTC*1.03)()`)), 'margin hype +100', 'close btc 25%']) {
  await tab.eval(`(()=>{const i=document.getElementById('cmdIn');i.value=${JSON.stringify(c)};i.dispatchEvent(new Event('input'));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`); await sleep(800);
}
await tab.eval(`(()=>{const i=document.getElementById('cmdIn');i.value='short eth 10x 800 @' + Math.round(${await tab.eval(`(async()=>(await import('/assets/feed.js')).marks.ETH*1.02)()`)});i.dispatchEvent(new Event('input'))})()`); await sleep(500);
await tab.eval(`[...document.querySelectorAll('.toast')].forEach(t => t.remove())`);
await shot(tab, 'command');
await tab.eval(`document.getElementById('cmd').hidden = true`);
await tab.eval(`document.querySelector('#list [data-s=NVDA]').click()`); await sleep(6000);
await shot(tab, 'stocks');
await tab.eval(`document.querySelector('#views [data-view=journal]').click()`); await sleep(2500);
await shot(tab, 'journal');
await tab.eval(`document.querySelector('#views [data-view=funding]').click()`); await sleep(5000);
await shot(tab, 'funding');
await tab.eval(`document.querySelector('#views [data-view=mirror]').click()`); await sleep(7000);
await shot(tab, 'mirror');
await tab.eval(`document.querySelector('#views [data-view=rewind]').click()`); await sleep(5000);
await tab.eval(`document.querySelector('#rwSpeed [data-x="10"]').click(); document.getElementById('rwStart').click()`); await sleep(4000);
await tab.eval(`document.getElementById('rwLong').click()`); await sleep(9000);
await tab.eval(`document.querySelector('#rwSpeed [data-x="1"]')?.click(); document.getElementById('rwPause').click()`);
await shot(tab, 'rewind');
await tab.close();

tab = await launch({ width: 390, height: 844, mobile: true, scale: 2 });
await tab.goto(base + '/', 6000); await shot(tab, 'phone-home');
await tab.goto(base + '/trade/?m=ETH', 6000); await shot(tab, 'phone-trade');
await tab.close();
