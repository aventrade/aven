// node dev/overflow.mjs <out-dir> [base] : phone-width audit. Lists elements that stick out past the viewport (outside
// a horizontally scrolling container), text clipped inside its own box, and controls narrower than 32px; screenshots.
import { writeFileSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';

const [out, base = 'http://localhost:8792'] = process.argv.slice(2);
const PAGES = [['home', '/'], ['trade', '/trade/'], ['journal', '/trade/?view=journal'], ['rewind', '/trade/?view=rewind'], ['funding', '/trade/?view=funding'], ['mirror', '/trade/?view=mirror'], ['docs', '/docs/'], ['404', '/nope']];
const AUDIT = `(() => {
  const W = document.documentElement.clientWidth, bad = [];
  const scrollsX = el => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if ((s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') && p !== document.body && p !== document.documentElement) return true; } return false; };
  const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[hidden], .marquee, canvas, script, style') || el.tagName === 'CANVAS') continue;
    const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if ((r.right > W + 1 || r.left < -1) && !scrollsX(el) && s.position !== 'fixed') bad.push('OUT ' + name(el) + ' ' + Math.round(r.left) + '..' + Math.round(r.right) + ' "' + (el.innerText || '').slice(0, 30).replace(/\\s+/g, ' ') + '"');
    if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && s.overflow !== 'visible' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) bad.push('CLIP ' + name(el) + ' "' + el.innerText.slice(0, 30) + '"');
    if ((el.tagName === 'BUTTON' || el.tagName === 'A') && (r.width < 30 || r.height < 26) && el.innerText.trim()) bad.push('TINY ' + name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return [document.documentElement.scrollWidth > W ? 'PAGE scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + W : null, ...new Set(bad)].filter(Boolean);
})()`;

for (const width of [360, 390]) {
  const tab = await launch({ width, height: 800, mobile: true, scale: 2 });
  for (const [name, path] of PAGES) {
    await tab.goto(base + path, 4500);
    const tall = await tab.eval('document.documentElement.scrollHeight');
    let issues = [];
    for (let y = 0; y < tall; y += 700) {
      await tab.eval(`scrollTo(0, ${y})`); await sleep(350);
      issues.push(...await tab.eval(AUDIT));
    }
    issues = [...new Set(issues)];
    console.log(`${width}px ${name}: ${issues.length ? '\n  ' + issues.slice(0, 25).join('\n  ') : 'clean'}`);
    if (width === 390) { await tab.eval('scrollTo(0,0)'); await sleep(800); writeFileSync(`${out}/${name}-390.png`, await tab.shot()); }
  }
  await tab.close();
}
