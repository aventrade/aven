// node dev/smoke-new.mjs <out> [base] : Rewind (a full fast day), Funding board, Stress test, and the zero/dash audit
// with positions open
import { writeFileSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
const [out, base = 'http://localhost:8792'] = process.argv.slice(2);
const tab = await launch({ width: 1600, height: 1000 });
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs=[];addEventListener('error',e=>__errs.push(e.message+' @'+e.filename?.split('/').pop()+':'+e.lineno));addEventListener('unhandledrejection',e=>__errs.push(String(e.reason)));if(!sessionStorage.k){localStorage.clear();sessionStorage.k=1}` });
const ev = js => tab.eval(js);
const NL = 'String.fromCharCode(10)';

await tab.goto(base + '/trade/?m=BTC', 7000);
for (const c of ['long btc 40x 1000', 'short eth 10x 800', 'long nvda 5x 600', 'pair long msft short qqq 400 3x']) { try { await ev(`avenRun(${JSON.stringify(c)})`); } catch (e) { console.log('cmd fail', c, e.message.split('\n')[0]); } await sleep(600); }
await sleep(3000);
await ev(`document.querySelector('[data-act=stress]').click()`); await sleep(6000);
console.log('STRESS', await ev(`document.getElementById('stressOut').innerText.split(${NL}).join(' | ')`));
writeFileSync(out + '/stress.png', await tab.shot());
const ZERO = `(() => { const out=[]; const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); for(let n;(n=w.nextNode());){const t=n.nodeValue.trim(); const el=n.parentElement; if(!t||!el||el.closest('[hidden],script,style,.marquee,.tv-lightweight-charts')) continue; if(getComputedStyle(el).display==='none') continue;
  if(/^[+−-]?\\$?0+([.,]0+)?(%|\\s?aUSD|x|K|M|B)?$/.test(t)||/^[—–−-]+$/.test(t)||/NaN|undefined|Infinity/.test(t)) out.push(el.tagName+'.'+el.className+' "'+t+'"');} return [...new Set(out)]; })()`;
for (const t of ['pos', 'ord', 'fills', 'radar']) { await ev(`document.querySelector('#tabs [data-t=${t}]').click()`); await sleep(500); console.log('zeros', t, JSON.stringify(await ev(ZERO))); }

await ev(`document.querySelector('#views [data-view=funding]').click()`); await sleep(5000);
console.log('FUNDING rows', await ev(`document.querySelectorAll('#fundBoard tr').length`), '| first', await ev(`document.querySelectorAll('#fundBoard tr')[1]?.innerText.split(${NL}).join(' ').slice(0,160)`));
console.log('zeros funding', JSON.stringify(await ev(ZERO)));
writeFileSync(out + '/funding.png', await tab.shot());

await ev(`document.querySelector('#views [data-view=rewind]').click()`); await sleep(5000);
console.log('REWIND days', await ev(`[...document.querySelectorAll('#rwDays button')].map(b=>b.innerText.split(${NL}).join(' ')).join(' | ')`));
await ev(`document.querySelector('#rwSpeed [data-x="10"]').click(); document.getElementById('rwStart').click()`); await sleep(4000);
await ev(`document.getElementById('rwLong').click()`); await sleep(6000);
console.log('rewind mid', await ev(`document.getElementById('rwClock').innerText+' · '+document.getElementById('rwEq').innerText+' · '+document.getElementById('rwPos').innerText`));
writeFileSync(out + '/rewind.png', await tab.shot());
await ev(`document.getElementById('rwClose').click()`); await sleep(2000);
await ev(`document.getElementById('rwShort').click()`); await sleep(3000);
await ev(`document.getElementById('rwQuit').click()`); await sleep(1500);
console.log('rewind end', await ev(`document.getElementById('rwSum').innerText.split(${NL}).join(' | ')`));
console.log('zeros rewind', JSON.stringify(await ev(ZERO)));
writeFileSync(out + '/rewind-end.png', await tab.shot());
console.log('errors', await ev('JSON.stringify(__errs)'));
await tab.close();
