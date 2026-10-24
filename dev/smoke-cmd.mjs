// node dev/smoke-cmd.mjs <out> [base] : the command line's live preview and result log, and the Mirror view
import { writeFileSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
const [out, base = 'http://localhost:8792'] = process.argv.slice(2);
const tab = await launch({ width: 1600, height: 1000 });
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs=[];addEventListener('error',e=>__errs.push(e.message+' @'+e.filename?.split('/').pop()+':'+e.lineno));addEventListener('unhandledrejection',e=>__errs.push(String(e.reason)));if(!sessionStorage.k){localStorage.clear();sessionStorage.k=1}` });
const ev = js => tab.eval(js);
const NL = 'String.fromCharCode(10)';
await tab.goto(base + '/trade/?m=BTC', 7000);
await ev(`document.getElementById('cmdOpen').click()`); await sleep(300);
console.log('empty log:', await ev(`document.getElementById('cmdOut').innerText`));
const type = async line => {
  await ev(`(()=>{const i=document.getElementById('cmdIn');i.value=${JSON.stringify(line)};i.dispatchEvent(new Event('input'))})()`); await sleep(250);
  const prev = await ev(`document.getElementById('cmdPrev').innerText`);
  await ev(`document.getElementById('cmdIn').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`); await sleep(700);
  const res = await ev(`document.querySelector('#cmdOut .cl .cl-res')?.innerText`);
  console.log(`\n/ ${line}\n  preview: ${prev}\n  result:  ${res}`);
};
for (const l of ['long btc 20x 1000', 'long btc 10x 500', 'short eth 10x 500 @' + Math.round(await ev(`(async()=>{const f=await import('/assets/feed.js');return f.marks.ETH*1.03})()`)), 'tp btc ' + Math.round(await ev(`(async()=>{const f=await import('/assets/feed.js');return f.marks.BTC*1.02})()`)), 'margin btc +300', 'alert sol above 999', 'close btc 50%', 'pair long nvda short spy 400 3x', 'close pair', 'cancel all', 'long doge', 'go hype']) await type(l);
writeFileSync(out + '/cmd.png', await tab.shot());
await ev(`document.getElementById('cmd').hidden=true; document.querySelector('#views [data-view=mirror]').click()`); await sleep(6000);
console.log('\nMIRROR head:', await ev(`document.getElementById('mwHead').innerText.split(${NL}).join(' | ')`));
console.log('MIRROR rows:', await ev(`document.querySelectorAll('#mwPos tr').length - 1`), '| first:', await ev(`document.querySelectorAll('#mwPos tr')[1]?.innerText.split(${NL}).join(' ').slice(0,200)`));
console.log('MIRROR fills:', await ev(`document.querySelectorAll('#mwFills tr').length - 1`));
const btn = await ev(`(()=>{const b=document.querySelector('[data-copy]');if(!b)return 'no copyable position';b.click();return b.dataset.copy+' '+b.dataset.side+' '+b.dataset.lev+'x'})()`); await sleep(1500);
console.log('mirror copy:', btn, '→ toast:', await ev(`[...document.querySelectorAll('.toast')].map(t=>t.innerText).join(' || ')`));
writeFileSync(out + '/mirror.png', await tab.shot());
console.log('errors', await ev('JSON.stringify(__errs)'));
await tab.close();
