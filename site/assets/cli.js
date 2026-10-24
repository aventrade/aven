// The landing page command line: a throwaway sandbox account in memory, the real parser and engine, the live mark.
// Autoplay types a short session until the visitor clicks a command or the input.
import * as E from './engine.js';
import * as feed from './feed.js';
import { parse } from './command.js';

const $ = id => document.getElementById(id);
const sb = { s: E.fresh(), auto: true };
const out = $('cliOut'), input = $('cliIn');
const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function suggestions() {
  const m = feed.marks;
  return ['long btc 20x 1000', `short eth 10x 500 @${m.ETH ? +(m.ETH * 1.02).toFixed(1) : 2450}`, `tp btc ${m.BTC ? Math.round(m.BTC * 1.03) : 83000}`,
    `sl btc ${m.BTC ? Math.round(m.BTC * 0.985) : 79500}`, 'margin btc +250', 'long gold 10x 400', `short oil 5x 300 stop ${m.OIL ? +(m.OIL * 0.99).toFixed(2) : 100}`,
    'close btc 50%', 'go hype', 'cancel all', 'close gold'];
}

function line(html, cls = '') {
  const d = document.createElement('div');
  d.className = cls; d.innerHTML = html; out.append(d);
  while (out.children.length > 40) out.firstChild.remove();
  out.scrollTop = out.scrollHeight;
}

function exec(text) {
  const S = sb.s, c = parse(text);
  const mark = c.sym && c.sym !== 'ALL' ? feed.marks[c.sym] : 1;
  if (!mark) throw new Error('Waiting for the live mark, one second.');
  const pos = () => { const p = S.pos[c.sym]; if (!p) throw new Error(`No ${c.sym} position in the sandbox.`); return p; };
  if (c.op === 'go') return `${c.sym} · mark ${E.fmtPrice(mark)} · funding ${E.signed(feed.funding[c.sym].rate * 100, 4)}%/h · max ${E.market(c.sym).max}x`;
  if (c.op === 'order') {
    const lev = c.lev ?? Math.min(10, E.market(c.sym).max), size = c.margin * lev;
    if (c.type === 'market') {
      const p = E.marketOrder(S, { sym: c.sym, side: c.side, size, lev, price: mark, reduce: c.reduce, tp: c.tp, sl: c.sl });
      if (!p) return `${c.sym} position closed at ${E.fmtPrice(mark)}`;
      return `${p.side.toUpperCase()} ${c.sym} · ${E.fmt(p.qty * mark, 0)} aUSD · avg ${E.fmtPrice(p.entry)} · liquidation ${E.fmtPrice(p.liq)}, ${((Math.abs(p.liq - mark) / mark) * 100).toFixed(2)}% away · fee ${E.fmt(size * E.TAKER)}`;
    }
    const o = E.placeOrder(S, { sym: c.sym, side: c.side, type: c.type, price: c.price, size, lev, reduce: c.reduce }, mark);
    return `${c.type} ${c.side} ${c.sym} resting at ${E.fmtPrice(o.price)} · mark ${E.fmtPrice(mark)} · holds ${E.fmt(o.hold)} aUSD`;
  }
  if (c.op === 'close') {
    const pl = E.upnl(pos(), mark) * c.share;
    E.closePart(S, c.sym, c.share, mark);
    return `${c.sym} ${c.share >= 1 ? 'closed' : `cut by ${Math.round(c.share * 100)}%`} at ${E.fmtPrice(mark)} · price PnL ${E.signed(pl)}`;
  }
  if (c.op === 'margin') {
    pos(); E.addMargin(S, c.sym, c.amount);
    return `${c.sym} margin ${E.signed(c.amount)} · liquidation now ${E.fmtPrice(S.pos[c.sym].liq)}`;
  }
  if (c.op === 'tp' || c.op === 'sl') {
    const p = pos();
    E.setTpSl(S, c.sym, c.op === 'tp' ? c.price : p.tp, c.op === 'sl' ? c.price : p.sl, mark);
    return `${c.op === 'tp' ? 'take profit' : 'stop loss'} on ${c.sym} at ${E.fmtPrice(c.price)}, ${E.signed(((c.price - mark) / mark) * 100)}% from the mark`;
  }
  if (c.op === 'cancel') {
    const list = S.orders.filter(o => c.sym === 'ALL' || o.sym === c.sym);
    list.forEach(o => E.cancelOrder(S, o.id));
    return `${list.length} order${list.length === 1 ? '' : 's'} cancelled`;
  }
}

function run(text) {
  line(`<span class="pr">/</span> ${esc(text)}`, 'cmdl');
  try { line(`✓ ${exec(text)}`, 'res ok'); } catch (x) { line(`× ${esc(x.message)}`, 'res bad'); }
  paint();
}

function paint() {
  const S = sb.s;
  for (const sym of new Set([...Object.keys(S.pos), ...S.orders.map(o => o.sym)])) {
    const m = feed.marks[sym]; if (!m) continue;
    for (const ev of E.step(S, sym, { markLo: m, markHi: m, lastLo: m, lastHi: m })) line(`! ${ev.sym || ev.o?.sym} ${ev.kind}`, 'res bad');
  }
  $('cliBal').textContent = E.fmt(E.equity(S, feed.marks).total);
  const rows = Object.entries(S.pos).map(([sym, p]) => {
    const mk = feed.marks[sym] || p.entry, pl = E.upnl(p, mk);
    // the ladder runs from the liquidation price to the take profit (or the same distance past entry)
    const far = p.tp || p.entry + (p.entry - p.liq);
    const lo = Math.min(p.liq, far, mk, p.sl || mk), hi = Math.max(p.liq, far, mk, p.sl || mk);
    const at = v => (((v - lo) / (hi - lo || 1)) * 100).toFixed(2);
    return `<div class="sbp"><div class="sbh"><b>${sym}</b><span class="tag ${p.side}">${p.side} ${E.effLev(p, mk).toFixed(1)}x</span><b class="pl">${E.signedOr(pl)}</b></div>
      <div class="ladder"><i class="liq" style="left:${at(p.liq)}%" title="liquidation"></i><i class="en" style="left:${at(p.entry)}%" title="entry"></i><i class="mkp" style="left:${at(mk)}%" title="mark"></i>${p.tp ? `<i class="tp" style="left:${at(p.tp)}%" title="take profit"></i>` : ''}${p.sl ? `<i class="sl" style="left:${at(p.sl)}%" title="stop loss"></i>` : ''}</div>
      <div class="sbk"><span>liq ${E.fmtPrice(p.liq)}</span><span>entry ${E.fmtPrice(p.entry)}</span><span>mark ${E.fmtPrice(mk)}</span></div></div>`;
  });
  rows.push(...S.orders.map(o => `<div class="sbo"><span class="tag ${o.side}">${o.type} ${o.side}</span><span>${o.sym} @ ${E.fmtPrice(o.price)}</span></div>`));
  $('cliPos').innerHTML = rows.join('') || '<div class="empty">Nothing open yet.</div>';
}

function takeOver() {
  if (!sb.auto) return;
  sb.auto = false;
  input.value = '';
  $('cliMode').textContent = 'your turn';
}

function autoplay() {
  const script = suggestions().slice(0, 5).concat(['close btc 50%', 'cancel all']);
  let i = 0, ci = 0;
  const step = () => {
    if (!sb.auto) return;
    const cmd = script[i];
    if (ci <= cmd.length) { input.value = cmd.slice(0, ci++); return setTimeout(step, 40 + Math.random() * 45); }
    input.value = ''; run(cmd); ci = 0; i++;
    if (i < script.length) return setTimeout(step, 1300);
    i = 0;
    setTimeout(() => { if (!sb.auto) return; sb.s = E.fresh(); out.innerHTML = ''; paint(); step(); }, 5000);
  };
  step();
}

$('cliChips').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { takeOver(); run(b.dataset.c); } });
input.addEventListener('focus', takeOver);
$('cliForm').addEventListener('submit', e => { e.preventDefault(); const v = input.value.trim(); if (v) { run(v); input.value = ''; } });

let started = false;
function start() {
  if (started || !feed.marks.BTC) return;
  started = true;
  $('cliChips').innerHTML = suggestions().map(c => `<button type="button" data-c="${c}">${c}</button>`).join('');
  line('Sandbox ready: 50,000 aUSD on the live mark. Click a command or type your own.', 'res');
  autoplay();
}
new IntersectionObserver(es => { if (es[0].isIntersecting) { start(); if (!started) feed.on(() => start()); } }, { threshold: 0.25 }).observe($('cli'));
setInterval(() => { if (Object.keys(sb.s.pos).length || sb.s.orders.length) paint(); }, 1500);
