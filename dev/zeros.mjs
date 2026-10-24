// node dev/zeros.mjs [base] [width] : finds visible text that shows a bare zero or a dash placeholder
// ("0", "0.00", "$0", "0%", "+0.00", "—", "-", "– / –"), or broken values (NaN, undefined, Infinity), on every page
// and app view, after the data has loaded. Prints each hit with its element and where it is.
import { launch, sleep } from './cdp.mjs';

const base = process.argv[2] || 'http://localhost:8792';
const width = +(process.argv[3] || 1440);
const PAGES = [['home', '/'], ['trade', '/trade/'], ['trade-stock', '/trade/?m=NVDA'], ['journal', '/trade/?view=journal'], ['rewind', '/trade/?view=rewind'], ['funding', '/trade/?view=funding'], ['mirror', '/trade/?view=mirror'], ['docs', '/docs/']];
const AUDIT = `(() => {
  const ZERO = /^[+−\\-]?\\$?0+([.,]0+)?(%|\\s?aUSD|x|\\s?\\/h|K|M|B)?$/;
  const DASH = /^[—–\\-−\\s\\/·]+$/;
  const BAD = /NaN|undefined|Infinity|\\[object/;
  const out = [];
  const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/)[0] : '');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const t = n.nodeValue.trim(); if (!t) continue;
    const el = n.parentElement; if (!el || el.closest('[hidden], script, style, .marquee, .tv-lightweight-charts, #chart, #curve, #rwChart')) continue;
    const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    if (ZERO.test(t) || DASH.test(t) || BAD.test(t) || /(^|\\s)—(\\s|$)/.test(t)) out.push(name(el) + ' "' + t.slice(0, 40) + '" ← ' + name(el.parentElement));
  }
  return out;
})()`;

const tab = await launch({ width, height: 900, mobile: width < 600, scale: 1 });
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs=[];addEventListener('error',e=>__errs.push(e.message+' @'+e.filename?.split('/').pop()+':'+e.lineno));addEventListener('unhandledrejection',e=>__errs.push(String(e.reason)))` });
// a few real paper trades first, so the journal and tables are audited with data in them, not only empty
await tab.goto(base + '/trade/?m=BTC', 7000);
for (const c of ['long btc 10x 500', 'close btc', 'short eth 5x 400', 'close eth', 'long sol 3x 300', 'long nvda 2x 300', 'close nvda'])
  { try { await tab.eval(`avenRun(${JSON.stringify(c)})`); } catch {} await sleep(500); }
for (const [name, path] of PAGES) {
  await tab.goto(base + path, 7000);
  const tall = await tab.eval('document.documentElement.scrollHeight');
  let hits = [];
  for (let y = 0; y < tall; y += 800) { await tab.eval(`scrollTo(0, ${y})`); await sleep(500); hits.push(...await tab.eval(AUDIT)); }
  if (name === 'home') { await tab.eval(`document.querySelector('#mtabs [data-g=Stocks]')?.click()`); await sleep(2500); hits.push(...await tab.eval(AUDIT)); }
  if (name === 'trade') {
    for (const t of ['ord', 'fills', 'radar']) { await tab.eval(`document.querySelector('#tabs [data-t=${t}]').click()`); await sleep(500); hits.push(...await tab.eval(AUDIT)); }
  }
  hits = [...new Set(hits)];
  const errs = await tab.eval('JSON.stringify(__errs)');
  console.log(`${name}: ${hits.length ? hits.length + ' hits\n  ' + hits.slice(0, 40).join('\n  ') : 'clean'}${errs !== '[]' ? '\n  ERRORS ' + errs : ''}`);
}
await tab.close();
