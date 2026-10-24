import { createField } from './field.js';
import * as E from './engine.js';
import * as feed from './feed.js';

const $ = id => document.getElementById(id);
const field = createField($('field'));
field.setScroll(0.85);

// table of contents: scroll without a hash, highlight the section in view
const toc = $('toc');
toc.addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  const el = $(b.dataset.go);
  scrollTo({ top: el.getBoundingClientRect().top + scrollY - 80, behavior: 'smooth' });
});
const io = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) toc.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.go === e.target.id));
}, { rootMargin: '-30% 0px -60% 0px' });
document.querySelectorAll('.doc section[id]').forEach(s => io.observe(s));

function table() {
  $('mkTable').innerHTML = '<tr><th>Market</th><th>Group</th><th>Mark</th><th>Funding / h</th><th>Max leverage</th></tr>' + E.MARKETS.map(m => {
    const f = feed.funding[m.sym];
    return `<tr><td><b>${m.sym}</b> <span class="lbl">${m.name}</span></td><td>${m.group}</td><td>${feed.marks[m.sym] ? E.fmtPrice(feed.marks[m.sym]) : ''}</td><td>${m.rh ? 'none, spot token' : f ? E.rate(f.rate) : ''}</td><td>${m.max}x</td></tr>`;
  }).join('');
}
table();
feed.loadAll().then(table).catch(() => {});
setInterval(() => feed.loadAll().then(table).catch(() => {}), 15000);
