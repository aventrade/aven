import { createField } from './field.js';
import * as E from './engine.js';
import * as feed from './feed.js';
import { splitHeadings, reveal } from './ui.js';
import './cli.js';

const $ = id => document.getElementById(id);
const field = createField($('field'));
const onScroll = () => field.setScroll(scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight));
addEventListener('scroll', onScroll, { passive: true });
onScroll();
splitHeadings();
reveal();

// ---- markets
let group = 'Crypto';
function grid() {
  $('mkGrid').innerHTML = E.MARKETS.filter(m => m.group === group).map(m => `
    <a class="mk" href="/trade/?m=${m.sym}">
      <div class="tp"><b>${m.sym}</b><span class="lbl">${m.max}x</span></div>
      <span class="lbl">${m.name}</span>
      <canvas data-spark="${m.sym}" width="200" height="34"></canvas>
      <div class="px" data-px="${m.sym}">${feed.marks[m.sym] ? E.fmtPrice(feed.marks[m.sym]) : ''}</div>
      <div class="mrow"><span class="chg" data-chg="${m.sym}"></span><span class="lbl" data-fr="${m.sym}"></span></div>
    </a>`).join('');
  sparks();
  paint();
}
$('mtabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  group = b.dataset.g;
  $('mtabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  grid();
});

const sparkData = {};
function sparks() {
  for (const m of E.MARKETS.filter(m => m.group === group)) {
    const draw = closes => {
      const c = document.querySelector(`[data-spark="${m.sym}"]`); if (!c) return;
      const g = c.getContext('2d'), lo = Math.min(...closes), hi = Math.max(...closes);
      g.clearRect(0, 0, 200, 34); g.fillStyle = '#fff';
      closes.forEach((v, i) => g.fillRect((i / (closes.length - 1)) * 196 + 1, 31 - ((v - lo) / (hi - lo || 1)) * 28, 2.4, 2.4));
    };
    if (sparkData[m.sym]) { draw(sparkData[m.sym]); continue; }
    feed.klines(m.sym, '1h', 48).then(rows => {
      sparkData[m.sym] = rows.map(r => r.close);
      if (m.sym === 'BTC') field.setSeries(sparkData.BTC);
      draw(sparkData[m.sym]);
    }).catch(() => {});
  }
}

const tapeHtml = () => E.MARKETS.map(m => `<span><b>${m.sym}</b><span data-px="${m.sym}"></span> <span class="chg" data-chg="${m.sym}"></span></span>`).join('');
$('tape').innerHTML = tapeHtml() + tapeHtml();

function paint() {
  for (const el of document.querySelectorAll('[data-px]')) { const v = feed.marks[el.dataset.px]; if (v) el.textContent = E.fmtPrice(v); }
  for (const el of document.querySelectorAll('[data-ix]')) { const v = feed.index[el.dataset.ix]; if (v) el.textContent = E.fmtPrice(v); }
  for (const el of document.querySelectorAll('[data-fr]')) { const v = feed.funding[el.dataset.fr]; if (feed.isRh(el.dataset.fr)) el.textContent = 'on-chain · no funding'; else if (v) el.textContent = `${E.rate(v.rate)} /h`; }
  for (const el of document.querySelectorAll('[data-oi]')) { const v = feed.oi[el.dataset.oi], mk = feed.marks[el.dataset.oi]; if (v && mk) el.textContent = `$${E.compact(v * mk)}`; }
  for (const el of document.querySelectorAll('[data-chg]')) {
    const st = feed.stats[el.dataset.chg]; if (!st) continue;
    el.textContent = `${Math.abs(st.change).toFixed(2)}% 24h`;
    el.className = 'chg ' + (st.change >= 0 ? 'up' : 'dn');
  }
  const f = feed.funding.BTC;
  if (feed.marks.BTC) field.setLabel('BTC / aUSD', `BTC ${E.fmtPrice(feed.marks.BTC)}`);
  if (feed.marks.ETH) field.setLabel('ETH / aUSD', `ETH ${E.fmtPrice(feed.marks.ETH)}`);
  if (f) field.setLabel('FUNDING 0.00%', `FUNDING ${E.signed(f.rate * 100, 4)}%`);
  calc();
}

// ---- whale tape
function paintWhales() {
  const T = feed.whaleTotal;
  $('wTot').textContent = T.n ? `$${E.compact(T.usd)}` : 'listening';
  $('wBuy').textContent = T.buy ? `$${E.compact(T.buy)}` : 'none yet';
  $('wSell').textContent = T.sell ? `$${E.compact(T.sell)}` : 'none yet';
  $('wBar').style.width = T.usd ? `${(T.buy / T.usd) * 100}%` : '50%';
  if (!feed.whales.length) return;
  $('wList').innerHTML = feed.whales.slice(0, 9).map(w => `<div class="wrow"><b>${w.sym}</b><span class="tag ${w.side === 'buy' ? 'long' : 'short'}">${w.side}</span><span>${E.fmtPrice(w.price)}</span><b>$${E.compact(w.usd)}</b><span class="lbl">${E.ago(Date.now() - w.time)}</span></div>`).join('');
}

let queued = false;
feed.on((type, data) => {
  if (type === 'whale') {
    field.pulse({ usd: data.usd, side: data.side === 'buy' ? 'long' : 'short', label: `${data.sym} ${data.side.toUpperCase()} $${E.compact(data.usd)}` });
    paintWhales();
    return;
  }
  if (!queued) { queued = true; setTimeout(() => { queued = false; paint(); }, 400); }
});
setInterval(paintWhales, 5000);
feed.loadAll().then(grid).catch(() => grid());
feed.connect();

// ---- mobile menu
const burger = $('burger'), mnav = $('mnav');
const menu = open => { mnav.hidden = !open; burger.setAttribute('aria-expanded', open); document.body.classList.toggle('menu-open', open); };
burger.addEventListener('click', () => menu(mnav.hidden));
mnav.addEventListener('click', e => { if (e.target.closest('button, a')) menu(false); });

// ---- nav: scroll to a section without putting a hash in the URL
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  const el = document.getElementById(b.dataset.go); if (!el) return;
  scrollTo({ top: el.getBoundingClientRect().top + scrollY - 70, behavior: 'smooth' });
});

// ---- Robinhood Chain: latest block from a public RPC
async function block() {
  try {
    const r = await fetch('https://robinhood-rpc.publicnode.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' }).then(r => r.json());
    $('rhBlock').textContent = '#' + parseInt(r.result, 16).toLocaleString('en-US');
  } catch {}
}
block();
setInterval(block, 8000);

// ---- the field dims behind the reading sections and comes back for the hero and the end
function dim() {
  const h = innerHeight, y = scrollY, max = document.documentElement.scrollHeight - h;
  const k = Math.min(1, y / (h * 0.7)), end = Math.max(0, Math.min(1, (y - (max - h * 1.2)) / (h * 1.2)));
  $('field').style.opacity = (1 - k * 0.6 + end * 0.6).toFixed(3);
}
addEventListener('scroll', dim, { passive: true });
dim();

// ---- sizing calculator
const cs = { sym: 'BTC', side: 'long' };
$('cSyms').innerHTML = ['BTC', 'ETH', 'SOL', 'HYPE', 'GOLD'].map((s, i) => `<button data-s="${s}" class="${i ? '' : 'on'}">${s}</button>`).join('');
$('cSyms').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  cs.sym = b.dataset.s;
  $('cSyms').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  const lev = $('cLev'); lev.max = E.market(cs.sym).max;
  if (+lev.value > +lev.max) lev.value = lev.max;
  calc();
});
$('cSide').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  cs.side = b.dataset.side;
  $('cSide').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  calc();
});
$('cMargin').addEventListener('input', calc);
$('cLev').addEventListener('input', calc);

function calc() {
  const price = feed.marks[cs.sym];
  const margin = Math.max(0, +$('cMargin').value || 0), lev = +$('cLev').value;
  $('cLevOut').textContent = `${lev}x of ${E.market(cs.sym).max}x`;
  $('cGo').href = `/trade/?m=${cs.sym}&side=${cs.side}&lev=${lev}&margin=${margin}`;
  if (!price || !margin) { $('cOut').innerHTML = '<div class="row"><span>Waiting for the live mark</span><span>…</span></div>'; return; }
  const size = margin * lev;
  const pv = E.preview(E.fresh(), { sym: cs.sym, side: cs.side, size, lev, price });
  const f = feed.funding[cs.sym];
  const rows = [
    ['Mark', E.fmtPrice(price)],
    ['Position size', `${E.fmt(size)} aUSD`],
    ['Opening fee (taker)', `${E.fmt(size * E.TAKER)} aUSD`],
    ['Funding per hour, now', feed.isRh(cs.sym) ? 'none, spot token' : f && f.rate ? `${E.signed(-size * f.rate * (cs.side === 'long' ? 1 : -1))} aUSD` : 'flat right now'],
    ['Liquidation price', E.fmtPrice(pv.liq)],
    ['Share of a fresh account', `${E.fmt((margin / E.START) * 100, 1)}%`],
  ];
  $('cOut').innerHTML = rows.map(([a, b]) => `<div class="row"><span>${a}</span><span>${b}</span></div>`).join('');
  const room = Math.abs(pv.liq - price) / price;
  $('cRoom').textContent = `${(room * 100).toFixed(2)}% ${cs.side === 'long' ? 'drop' : 'rise'}`;
  $('cGauge').style.setProperty('--h', Math.min(100, room * 200));
}
