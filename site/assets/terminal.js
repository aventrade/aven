import { createField } from './field.js';
import * as E from './engine.js';
import * as feed from './feed.js';
import * as settle from './settle.js';
import { toast } from './ui.js';
import { drawReceipt } from './card.js';
import { parse } from './command.js';
import { initJournal, paint as paintJournal } from './journal.js';
import { RH_STOCKS } from './rhpools.js';
import * as risk from './risk.js';
import { mountRewind, showRewind, stopRewind } from './rewind.js';
import { mountFunding, showFunding } from './fundingboard.js';
import { stressHtml } from './stress.js';
import { mountMirror, showMirror } from './mirror.js';
const RH_INFO = Object.fromEntries(RH_STOCKS.map(p => [p.sym, p]));

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

const field = createField($('field'));
field.setScroll(0.62);

let s = E.load();
const extras = st => { st.alerts ||= []; st.pairs ||= []; return st; };
extras(s);
const ui = {
  sym: E.bySym((params.get('m') || '').toUpperCase()) ? params.get('m').toUpperCase() : 'BTC',
  side: params.get('side') === 'short' ? 'short' : 'long',
  type: 'market',
  interval: '15m',
  tab: 'pos',
};
if (+params.get('margin') > 0) $('margin').value = +params.get('margin');
if (+params.get('lev') > 0) $('lev').value = +params.get('lev');

const persist = () => E.save(s);
addEventListener('storage', e => { if (e.key === E.STORAGE_KEY) { s = extras(E.load()); drawLines(); paintAll(); } });

// ---- market list, grouped
const groups = [...new Set(E.MARKETS.map(m => m.group))];
$('list').innerHTML = groups.map(g => `<div class="grp lbl">${g}</div>` + E.MARKETS.filter(m => m.group === g).map(m => `
  <button data-s="${m.sym}"><b>${m.sym}</b><span class="p" data-px="${m.sym}"></span><span class="lbl" data-fr="${m.sym}">${m.max}x</span><span class="chg p" data-chg="${m.sym}"></span></button>`).join('')).join('');
$('list').addEventListener('click', e => { const b = e.target.closest('button'); if (b) pick(b.dataset.s); });

// ---- chart
const IVS = ['1m', '5m', '15m', '1h', '4h', '1d'];
$('ivs').innerHTML = IVS.map(i => `<button data-i="${i}" class="${i === ui.interval ? 'on' : ''}">${i}</button>`).join('');
$('ivs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  ui.interval = b.dataset.i;
  $('ivs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  loadChart();
});

const chart = LightweightCharts.createChart($('chart'), {
  autoSize: true,
  layout: { background: { color: 'transparent' }, textColor: 'rgba(255,255,255,.6)', fontFamily: 'IBM Plex Mono', fontSize: 11 },
  grid: { vertLines: { color: 'rgba(255,255,255,.05)' }, horzLines: { color: 'rgba(255,255,255,.05)' } },
  rightPriceScale: { borderColor: 'rgba(255,255,255,.16)' },
  timeScale: { borderColor: 'rgba(255,255,255,.16)', timeVisible: true },
  crosshair: { mode: 0, vertLine: { color: 'rgba(255,255,255,.4)', labelBackgroundColor: '#fff' }, horzLine: { color: 'rgba(255,255,255,.4)', labelBackgroundColor: '#fff' } },
});
const candles = chart.addCandlestickSeries({
  upColor: '#ffffff', downColor: '#000000', borderUpColor: '#ffffff', borderDownColor: '#ffffff', wickUpColor: '#ffffff', wickDownColor: 'rgba(255,255,255,.7)',
});
let lines = [], chartToken = 0;

async function loadChart() {
  const t = ++chartToken;
  try {
    const rows = await feed.klines(ui.sym, ui.interval, 500);
    if (t !== chartToken) return;
    const d = E.dp(rows[rows.length - 1]?.close);
    candles.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: 10 ** -d } });
    candles.setData(rows);
    chart.timeScale().scrollToRealTime();
    field.setSeries(rows.slice(-120).map(r => r.close));
  } catch { toast('Could not load candles; the live stream will fill in.'); }
  feed.connect({ sym: ui.sym, interval: ui.interval });
  feed.loadOI(ui.sym).catch(() => {});
  drawLines();
}

function drawLines() {
  lines.forEach(l => candles.removePriceLine(l));
  lines = [];
  const p = s.pos[ui.sym];
  const line = (price, title, style = 0, alpha = 1) => lines.push(candles.createPriceLine({ price, color: `rgba(255,255,255,${alpha})`, lineWidth: 1, lineStyle: style, title }));
  if (p) {
    line(p.entry, `${p.side === 'long' ? 'LONG' : 'SHORT'} entry`);
    line(p.liq, 'liquidation', 2, 0.6);
    if (p.tp) line(p.tp, 'TP', 1, 0.45);
    if (p.sl) line(p.sl, 'SL', 1, 0.45);
  }
  for (const o of s.orders.filter(o => o.sym === ui.sym)) line(o.price, `${o.type} ${o.side}`, 3, 0.5);
}

function pick(sym) {
  ui.sym = sym;
  const m = E.market(sym);
  $('lev').max = m.max;
  if (+$('lev').value > m.max) $('lev').value = m.max;
  $('levChips').innerHTML = [2, 5, 10, 20, m.max].filter((v, i, a) => v <= m.max && a.indexOf(v) === i).map(v => `<button type="button" data-l="${v}">${v === m.max ? 'max ' : ''}${v}x</button>`).join('');
  $('tp').value = $('sl').value = $('price').value = '';
  const q = new URLSearchParams(location.search); q.set('m', sym);
  history.replaceState(null, '', '?' + q);
  $('book').innerHTML = '<div class="empty">Waiting for depth…</div>';
  $('bookL').textContent = feed.isRh(sym) ? 'Pool · Robinhood Chain' : 'Order book · Hyperliquid';
  bar = null;
  loadChart();
  paintAll();
}

// ---- ticket
$('otype').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  ui.type = b.dataset.o;
  $('otype').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  $('priceRow').hidden = ui.type === 'market';
  $('tpslRow').hidden = ui.type !== 'market';
  $('priceLbl').textContent = ui.type === 'limit' ? 'Limit price' : 'Trigger price (mark)';
  paintTicket();
});
$('useMark').addEventListener('click', () => { const m = feed.marks[ui.sym]; if (m) { $('price').value = +m.toFixed(E.dp(m)); paintTicket(); } });
$('side').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; ui.side = b.dataset.side; paintTicket(); });
$('pcts').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const lev = +$('lev').value, p = +b.dataset.p / 100;
  $('margin').value = Math.floor(((s.cash * p) / (1 + lev * E.TAKER)) * 100) / 100;
  paintTicket();
});
$('levChips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('lev').value = b.dataset.l; paintTicket(); });
['margin', 'lev', 'tp', 'sl', 'price', 'reduce'].forEach(id => $(id).addEventListener('input', paintTicket));

// what a market order of this size fills at: the mark on Hyperliquid markets, a swap quote on the pool's active
// liquidity (with its LP fee) on Robinhood Chain stocks
function fillPrice(sym, side, size) {
  if (!feed.isRh(sym)) return feed.marks[sym];
  const q = feed.rh.quote(sym, side === 'long' ? 'buy' : 'sell', size);
  if (q.tooBig) throw new Error(`${sym}: ${E.fmt(size, 0)} aUSD would move the pool ${(q.impact * 100).toFixed(2)}%, past the ${feed.rh.MAX_IMPACT * 100}% Aven allows on one swap. Try a smaller size.`);
  return q.fill;
}
function closeAt(sym, share) {
  const p = s.pos[sym]; if (!p) throw new Error(`No ${sym} position.`);
  const size = p.qty * share * feed.marks[sym];
  E.closePart(s, sym, share, fillPrice(sym, p.side === 'long' ? 'short' : 'long', size));
}

function submit({ sym, side, type, margin, lev, price, tp, sl, reduce }) {
  const mark = feed.marks[sym];
  const size = margin * lev;
  if (type === 'market') {
    const p = E.marketOrder(s, { sym, side, size, lev, price: fillPrice(sym, side, size), reduce, tp, sl });
    persist(); drawLines(); paintAll();
    toast(p ? `${p.side.toUpperCase()} ${sym} · ${E.fmt(p.qty * mark, 0)} aUSD at ${E.fmtPrice(p.entry)} avg` : `${sym} position closed`);
  } else {
    const o = E.placeOrder(s, { sym, side, type, price, size, lev, reduce }, mark);
    persist(); drawLines(); paintAll();
    toast(`${type} ${side} ${sym} resting at ${E.fmtPrice(o.price)}`);
  }
}

$('ticket').addEventListener('submit', e => {
  e.preventDefault();
  const err = $('err');
  err.hidden = true;
  try {
    submit({ sym: ui.sym, side: ui.side, type: ui.type, margin: +$('margin').value, lev: +$('lev').value, price: +$('price').value,
      tp: +$('tp').value || null, sl: +$('sl').value || null, reduce: $('reduce').checked });
    $('tp').value = $('sl').value = '';
  } catch (x) { err.textContent = x.message; err.hidden = false; }
});

function paintTicket() {
  const m = E.market(ui.sym), mark = feed.marks[ui.sym];
  const margin = +$('margin').value || 0, lev = +$('lev').value;
  let price = ui.type === 'market' ? mark : +$('price').value || mark, impact = null;
  if (ui.type === 'market' && feed.isRh(ui.sym) && mark && margin) {
    try { const q = feed.rh.quote(ui.sym, ui.side === 'long' ? 'buy' : 'sell', margin * lev); price = q.fill; impact = q; } catch {}
  }
  $('side').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.side === ui.side));
  $('levChips').querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.l === lev));
  $('levOut').textContent = `${lev}x of ${m.max}x`;
  $('freeHint').textContent = `free ${E.fmt(s.cash)}`;
  const go = $('go');
  go.textContent = `${ui.type === 'market' ? '' : ui.type + ' '}${ui.side} ${ui.sym} · ${lev}x`;
  go.classList.toggle('short', ui.side === 'short');
  if (!price) { $('summary').innerHTML = '<div class="row"><span>Waiting for the mark</span><span>…</span></div>'; return; }
  const size = margin * lev;
  const pv = E.preview(s, { sym: ui.sym, side: ui.side, size, lev, price });
  const cur = s.pos[ui.sym];
  const rows = [
    [ui.type === 'market' ? (impact ? 'Pool quote' : 'Fills near') : 'Fills at', E.fmtPrice(price)],
    ...(impact ? [['Price impact + LP fee', `${(impact.impact * 100).toFixed(3)}%${impact.tooBig ? ' · too big' : ''}`]] : []),
    ['Size', `${E.fmt(size)} · ${E.fmt(pv.qty, pv.qty < 1 ? 5 : 3)} ${ui.sym}`],
    [`Fee (${ui.type === 'limit' ? 'maker 0.02' : 'taker 0.05'}%)`, E.fmt(size * (ui.type === 'limit' ? E.MAKER : E.TAKER))],
  ];
  if (cur && cur.side !== ui.side) rows.push(['Effect', pv.after ? (pv.after.side === cur.side ? `reduces ${cur.side}` : `flips to ${pv.after.side}`) : `closes ${cur.side}`]);
  else if (cur) rows.push(['Effect', `adds to ${cur.side}, avg ${E.fmtPrice(pv.after.entry)}`]);
  rows.push(['Liquidation', pv.liq ? E.fmtPrice(pv.liq) : 'none, this closes it']);
  if (pv.liq) rows.push(['Room', `${((Math.abs(pv.liq - price) / price) * 100).toFixed(2)}%`]);
  if (pv.liq && mark) rows.push(['Liquidation odds, 24h', risk.pct(risk.touchOdds(ui.sym, mark, pv.liq, 24))]);
  $('summary').innerHTML = rows.map(([a, b]) => `<div class="row"><span>${a}</span><span>${b}</span></div>`).join('');
}

// ---- tabs & tables
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  ui.tab = b.dataset.t;
  $('tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  paintTables();
});

$('pos').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const sym = b.dataset.sym, mark = feed.marks[sym];
  try {
    if (b.dataset.act === 'close') {
      closeAt(sym, +b.dataset.k);
      toast(+b.dataset.k >= 1 ? `${sym} closed at ${E.fmtPrice(mark)}` : `${sym} cut by ${b.dataset.k * 100}%`);
    } else if (b.dataset.act === 'margin') {
      const v = prompt(`Add margin to ${sym} (aUSD). Use a minus sign to take some out.`, '100');
      if (v === null) return;
      E.addMargin(s, sym, +v);
    } else if (b.dataset.act === 'tpsl') {
      const p = s.pos[sym];
      const v = prompt(`TP and SL for ${sym}, on the mark, separated by a space. Leave a side empty with "-".`, `${p.tp || '-'} ${p.sl || '-'}`);
      if (v === null) return;
      const [tp, sl] = v.trim().split(/\s+/).map(x => (x === '-' ? null : +x || null));
      E.setTpSl(s, sym, tp, sl, mark);
    } else if (b.dataset.act === 'cancel') {
      E.cancelOrder(s, +b.dataset.id);
    } else if (b.dataset.act === 'stress') {
      ui.stress = !ui.stress; ui.stressHtml = ui.stress ? '<div class="stress"><span class="lbl">Reading the worst hours…</span></div>' : '';
      paintTables();
      if (ui.stress) stressHtml(s).then(h => { ui.stressHtml = h; if (ui.stress) { const o = $('stressOut'); if (o) o.innerHTML = h; } });
      return;
    } else if (b.dataset.act === 'unalert') {
      s.alerts = s.alerts.filter(a => a.id !== +b.dataset.id);
    } else if (b.dataset.act === 'closepair') {
      closePairs(+b.dataset.id);
    } else if (b.dataset.act === 'receipt') {
      share(null, sym);
      return;
    } else if (b.dataset.act === 'go') { pick(sym); return; }
    persist(); drawLines(); paintAll();
  } catch (x) { toast(x.message, 3600); }
});

const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function paintTables() {
  const box = $('pos');
  const positions = Object.entries(s.pos);
  $('nPos').textContent = positions.length ? `(${positions.length})` : '';
  $('nOrd').textContent = s.orders.length + s.alerts.length ? `(${s.orders.length + s.alerts.length})` : '';
  $('nLiq').textContent = feed.whaleTotal.n ? `(${feed.whaleTotal.n})` : '';
  if (ui.tab === 'pos') {
    if (!positions.length) { box.innerHTML = '<div class="empty">No open positions. Pick a side in the order ticket, or press / and type one.</div>'; return; }
    box.innerHTML = pairStrip() + `<div class="stressbar"><button class="mini" data-act="stress" type="button">${ui.stress ? 'Hide stress test' : 'Stress test: worst real hour'}</button></div><div id="stressOut">${ui.stressHtml || ''}</div>` + `<table class="tbl"><tr><th>Market</th><th>Size</th><th>Entry</th><th>Mark</th><th>Liq.</th><th title="Chance the mark touches the liquidation price within 24 hours, from 3 days of hourly volatility">Liq. odds 24h</th><th>Margin</th><th>PnL</th><th>Funding</th><th>TP / SL</th><th></th></tr>${positions.map(([sym, p]) => {
      const mark = feed.marks[sym], pl = mark ? E.upnl(p, mark) : 0, r = mark ? E.roe(p, mark) : 0;
      const room = mark ? Math.abs(p.liq - mark) / mark : 0;
      return `<tr><td><button class="sym-btn" data-act="go" data-sym="${sym}">${sym}</button> <span class="tag ${p.side}">${p.side} ${mark ? E.effLev(p, mark).toFixed(1) : '—'}x</span>${p.pair ? ` <span class="lbl">pair #${p.pair}</span>` : ''}</td>
        <td>${E.fmt(p.qty * (mark || p.entry))}</td><td>${E.fmtPrice(p.entry)}</td><td>${mark ? E.fmtPrice(mark) : ''}</td>
        <td>${E.fmtPrice(p.liq)}<div class="room"><i style="width:${Math.min(100, room * 1000)}%"></i></div></td>
        <td><b>${risk.pct(mark ? risk.touchOdds(sym, mark, p.liq, 24) : null)}</b></td>
        <td>${E.fmt(p.margin)}</td><td><b>${E.signedOr(pl)}</b>${Math.abs(r) >= 0.0005 ? ` <span class="lbl">${E.signed(r * 100, 1)}%</span>` : ''}</td>
        <td>${E.signedOr(-p.trip.funding, feed.isRh(sym) ? 'none, spot' : 'none yet')}</td>
        <td><button class="sym-btn" data-act="tpsl" data-sym="${sym}">${p.tp || p.sl ? `${p.tp ? 'TP ' + E.fmtPrice(p.tp) : 'no TP'} · ${p.sl ? 'SL ' + E.fmtPrice(p.sl) : 'no SL'}` : 'set TP / SL'}</button></td>
        <td class="acts"><button class="mini" data-act="close" data-k="0.25" data-sym="${sym}">25%</button><button class="mini" data-act="close" data-k="0.5" data-sym="${sym}">50%</button><button class="mini" data-act="close" data-k="1" data-sym="${sym}">Close</button><button class="mini" data-act="margin" data-sym="${sym}">± Margin</button><button class="mini" data-act="receipt" data-sym="${sym}">Receipt</button></td></tr>`;
    }).join('')}</table>`;
  } else if (ui.tab === 'ord') {
    const alerts = s.alerts.length ? `<table class="tbl"><tr><th>Alert</th><th>When the mark is</th><th>Mark now</th><th>Set</th><th></th></tr>${s.alerts.map(a => `<tr><td>${a.sym}</td><td>${a.dir} ${E.fmtPrice(a.price)}</td><td>${feed.marks[a.sym] ? E.fmtPrice(feed.marks[a.sym]) : ''}</td><td>${when(a.created)}</td><td><button class="mini" data-act="unalert" data-id="${a.id}">Remove</button></td></tr>`).join('')}</table>` : '';
    if (!s.orders.length) { box.innerHTML = alerts + '<div class="empty">No resting orders. Limit and stop orders wait here and fill on the live tape, even while you are away. Price alerts: type / alert btc above 82000.</div>'; return; }
    box.innerHTML = alerts + `<table class="tbl"><tr><th>Market</th><th>Type</th><th>Price</th><th>Size</th><th>Lev.</th><th>Mark</th><th>Placed</th><th></th></tr>${s.orders.map(o => `
      <tr><td>${o.sym} <span class="tag ${o.side}">${o.side}</span></td><td>${o.type}${o.reduce ? ' · reduce' : ''}</td><td>${E.fmtPrice(o.price)}</td><td>${E.fmt(o.size)}</td><td>${o.lev}x</td>
      <td>${feed.marks[o.sym] ? E.fmtPrice(feed.marks[o.sym]) : ''}</td><td>${when(o.created)}</td><td><button class="mini" data-act="cancel" data-id="${o.id}">Cancel</button></td></tr>`).join('')}</table>`;
  } else if (ui.tab === 'fills') {
    if (!s.fills.length) { box.innerHTML = '<div class="empty">No fills yet.</div>'; return; }
    box.innerHTML = `<table class="tbl"><tr><th>Market</th><th>Side</th><th>Price</th><th>Qty</th><th>Fee</th><th>How</th><th>When</th></tr>${s.fills.slice(0, 80).map(f => `
      <tr><td>${f.sym}</td><td><span class="tag ${f.side}">${f.side === 'long' ? 'buy' : 'sell'}</span></td><td>${E.fmtPrice(f.price)}</td><td>${E.fmt(f.qty, f.qty < 1 ? 5 : 3)}</td><td>${E.amt(f.fee)}</td><td>${f.why}</td><td>${when(f.t)}</td></tr>`).join('')}</table>`;
  } else {
    const L = feed.whaleTotal;
    const head = `<div class="radar-head"><div><span class="lbl">Real prints of $${E.compact(feed.WHALE)}+ on Hyperliquid since you opened this page</span><b>${L.n ? '$' + E.compact(L.usd) : 'listening'}</b></div>
      <div><span class="lbl">Bought</span><b>${L.buy ? '$' + E.compact(L.buy) : 'none yet'}</b></div><div><span class="lbl">Sold</span><b>${L.sell ? '$' + E.compact(L.sell) : 'none yet'}</b></div><div><span class="lbl">Prints</span><b>${L.n || 'none yet'}</b></div></div>`;
    if (!feed.whales.length) { box.innerHTML = head + '<div class="empty">Listening to every trade on these markets. Big prints land here as they happen.</div>'; return; }
    box.innerHTML = head + `<table class="tbl"><tr><th>Market</th><th>Side</th><th>Price</th><th>Value</th><th>When</th></tr>${feed.whales.slice(0, 60).map(l => `
      <tr><td>${l.sym}</td><td><span class="tag ${l.side === 'buy' ? 'long' : 'short'}">${l.side}</span></td><td>${E.fmtPrice(l.price)}</td><td>$${E.fmt(l.usd, 0)}</td><td>${E.ago(Date.now() - l.time)} ago</td></tr>`).join('')}</table>`;
  }
}

function paintAccount() {
  const q = E.equity(s, feed.marks);
  $('aRun').textContent = `Run ${s.run} · account value`;
  $('aTot').textContent = E.fmt(q.total);
  const ret = ((q.total - E.START) / E.START) * 100;
  $('aRet').textContent = Math.abs(ret) < 0.005 ? `even since ${when(s.started)}` : `${E.signed(ret)}% since ${when(s.started)}`;
  $('aFree').textContent = E.fmt(q.free);
  $('aLock').textContent = E.amt(q.locked);
  $('aUp').textContent = E.signedOr(q.upnl);
  $('aHeld').textContent = E.amt(q.held);
}

function paintBar() {
  const m = E.market(ui.sym), st = feed.stats[ui.sym], mk = feed.marks[ui.sym], f = feed.funding[ui.sym];
  $('bSym').textContent = `${m.sym}-PERP`;
  $('bPx').textContent = mk ? E.fmtPrice(mk) : '';
  $('bMax').textContent = `${m.max}x`;
  const rhm = feed.isRh(ui.sym), ws = feed.rh.wallSt[ui.sym];
  $('bIdxL').textContent = rhm ? `Wall St${ws?.session ? ' · ' + ws.session : ''}` : 'Oracle';
  $('bFundL').textContent = rhm ? 'Funding' : 'Funding 1h / next';
  $('bOiL').textContent = rhm ? 'Pool liquidity' : 'Open interest';
  $('bIdx').textContent = rhm ? (ws ? E.fmtPrice(ws.last) : '') : feed.index[ui.sym] ? E.fmtPrice(feed.index[ui.sym]) : '';
  if (rhm) $('bFund').textContent = 'none, spot token';
  else if (f) $('bFund').textContent = `${E.rate(f.rate)} · ${E.ago(f.next - Date.now())}`;
  if (rhm) $('bOi').textContent = feed.rh.day[ui.sym] ? `$${E.compact(feed.rh.day[ui.sym].liqUsd)}` : '';
  else if (feed.oi[ui.sym] && mk) $('bOi').textContent = `$${E.compact(feed.oi[ui.sym] * mk)}`;
  if (rhm) paintPool();
  if (st) {
    $('bChg').textContent = `${Math.abs(st.change).toFixed(2)}%`;
    $('bChg').className = 'chg ' + (st.change >= 0 ? 'up' : 'dn');
    $('bVol').textContent = `$${E.compact(st.vol)}`;
  }
  document.title = mk ? `${E.fmtPrice(mk)} ${m.sym} · Aven` : 'Trade · Aven';
  for (const b of $('list').querySelectorAll('button')) b.classList.toggle('on', b.dataset.s === ui.sym);
  for (const el of document.querySelectorAll('[data-px]')) { const v = feed.marks[el.dataset.px]; if (v) el.textContent = E.fmtPrice(v); }
  for (const el of document.querySelectorAll('[data-fr]')) { const v = feed.funding[el.dataset.fr]; if (feed.isRh(el.dataset.fr)) el.textContent = 'on-chain'; else if (v) el.textContent = E.rate(v.rate); }
  for (const el of document.querySelectorAll('[data-chg]')) {
    const c = feed.stats[el.dataset.chg]; if (!c) continue;
    el.textContent = `${Math.abs(c.change).toFixed(2)}%`;
    el.className = 'chg p ' + (c.change >= 0 ? 'up' : 'dn');
  }
}

function paintAll() { paintBar(); paintTicket(); paintAccount(); paintTables(); }

function paintBook({ bids, asks }) {
  if (feed.isRh(ui.sym)) return;
  const a = asks.slice(0, 10).reverse(), b = bids.slice(0, 10);
  if (!a.length || !b.length) return;
  const max = Math.max(...a.map(x => x[1] * x[0]), ...b.map(x => x[1] * x[0]));
  const row = ([p, q], cls) => `<div class="r ${cls}"><i style="width:${((q * p) / max) * 100}%"></i><span>${E.fmtPrice(p)}</span><span>${E.compact(q * p)}</span></div>`;
  const mid = (b[0][0] + a[a.length - 1][0]) / 2, spread = a[a.length - 1][0] - b[0][0];
  $('book').innerHTML = a.map(x => row(x, 'ask')).join('') +
    `<div class="mid">${E.fmtPrice(mid)} <span class="lbl">spread ${E.fmt(spread, E.dp(mid))}</span></div>` + b.map(x => row(x, 'bid')).join('');
}

// ---- stocks: the pool panel and a live candle built from each on-chain read
const IVS_S = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
let bar = null;
function stockBar(px) {
  const t = Math.floor(Date.now() / 1000 / IVS_S[ui.interval]) * IVS_S[ui.interval];
  if (!bar || bar.time !== t) bar = { time: t, open: bar && bar.time < t ? bar.close : px, high: px, low: px, close: px };
  bar.high = Math.max(bar.high, px); bar.low = Math.min(bar.low, px); bar.close = px;
  try { candles.update({ ...bar }); } catch {}
}
function paintPool() {
  const p = feed.rh.pools[ui.sym], st = RH_INFO[ui.sym];
  if (!p) { $('book').innerHTML = '<div class="empty">Reading the pool on Robinhood Chain…</div>'; return; }
  const sizes = [1000, 5000, 10000, 25000];
  const rows = sizes.map(u => {
    let b, sl; try { b = feed.rh.quote(ui.sym, 'buy', u); sl = feed.rh.quote(ui.sym, 'sell', u); } catch { return ''; }
    const cell = q => q.tooBig ? '<span class="lbl">too big</span>' : `${(q.impact * 100).toFixed(2)}%`;
    return `<div class="r"><span>${E.compact(u)}</span><span>${cell(b)}</span><span>${cell(sl)}</span></div>`;
  }).join('');
  $('book').innerHTML = `<div class="pool">
    <div class="r head"><span>${st.v4 ? 'Uniswap v4' : st.pool === '0x04f3a0eb5d782a2f63870a029e3916f5d0d03d24' ? 'SushiSwap v3' : 'Uniswap v3'} · fee ${(p.fee * 100).toFixed(2)}%</span><span>block ${feed.rh.block.toLocaleString('en-US')}</span></div>
    <div class="r"><span>Pool price</span><span>${E.fmtPrice(p.price)}</span></div>
    <div class="r"><span>Read</span><span>${E.ago(Date.now() - p.at)} ago</span></div>
    <div class="r head"><span>Size</span><span>Buy impact</span><span>Sell impact</span></div>${rows}
    <a class="ul lbl" href="https://dexscreener.com/robinhood/${st.pool}" target="_blank" rel="noopener">See the pool on DexScreener</a></div>`;
}

// ---- live loop
let dirty = false, lastBook = 0;
feed.on((type, data) => {
  if (type === 'status') { $('feedState').innerHTML = `<span class="live-dot"></span>${data}`; return; }
  if (type === 'kline') { candles.update(data); return; }
  if (type === 'mark' && data === 'RH' && feed.isRh(ui.sym) && feed.marks[ui.sym]) stockBar(feed.marks[ui.sym]);
  if (type === 'depth') { const now = performance.now(); if (now - lastBook > 250) { lastBook = now; paintBook(data); } return; }
  if (type === 'whale') {
    field.pulse({ usd: data.usd, side: data.side === 'buy' ? 'long' : 'short', label: `${data.sym} ${data.side.toUpperCase()} $${E.compact(data.usd)}` });
    if (ui.tab === 'radar') dirty = true;
    $('nLiq').textContent = `(${feed.whaleTotal.n})`;
    return;
  }
  dirty = true;
});

const NAMES = { liquidated: 'liquidated', 'stop loss': 'stopped out', 'take profit': 'hit take profit' };
function report(ev) {
  if (ev.kind === 'filled') return `${ev.o.type} ${ev.o.side} ${ev.o.sym} filled at ${E.fmtPrice(ev.o.price)}`;
  if (ev.kind === 'rejected') return `${ev.o.type} ${ev.o.side} ${ev.o.sym} skipped: not enough free aUSD`;
  if (ev.kind === 'cancelled') return `reduce-only ${ev.o.sym} cancelled: nothing left to reduce`;
  if (ev.kind === 'funding') return `${ev.sym} funding ${ev.pay > 0 ? 'paid' : 'received'}: ${E.fmt(Math.abs(ev.pay))} aUSD`;
  return `${ev.sym} ${ev.side} ${NAMES[ev.kind] || ev.kind}`;
}

setInterval(() => {
  const fired = settle.live(s);
  if (fired.length) {
    persist(); drawLines();
    for (const ev of fired) toast(report(ev), 4200);
    dirty = true;
  }
  if (s.alerts.length && checkAlerts()) { persist(); dirty = true; }
  E.sample(s, feed.marks);
  if (dirty) { dirty = false; paintAll(); }
}, 300);
setInterval(() => { persist(); feed.loadOI(ui.sym).catch(() => {}); }, 30e3);
addEventListener('pagehide', persist);

// ---- receipts (open position: marked to the live mark)
function share(trip, sym) {
  let r;
  if (trip) r = { ...trip, margin: trip.maxMargin, live: false };
  else {
    const p = s.pos[sym], mark = feed.marks[sym];
    r = { ...p.trip, sym, side: p.side, entry: p.entry, exit: mark, lev: +E.effLev(p, mark).toFixed(1), pnl: E.upnl(p, mark),
      net: E.upnl(p, mark) - p.trip.fees - p.trip.funding, margin: p.margin, live: true, closed: Date.now() };
  }
  drawReceipt($('card'), r, s.run);
  $('dl').href = $('card').toDataURL('image/png');
  const pct = (r.net / r.margin) * 100;
  const text = `${r.side === 'long' ? 'Long' : 'Short'} ${r.sym} ${r.lev}x on @aventrade_: ${E.signed(pct, 1)}% on paper. Real mark, real funding, fake money.`;
  $('tw').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  $('shareModal').hidden = false;
}
window.avenShare = share;
$('closeShare').addEventListener('click', () => ($('shareModal').hidden = true));
$('shareModal').addEventListener('click', e => { if (e.target.id === 'shareModal') $('shareModal').hidden = true; });
$('awayOk').addEventListener('click', () => ($('awayModal').hidden = true));

// ---- command line
const cmd = $('cmd'), cmdIn = $('cmdIn');
let lastCmd = '';
const cmdLog = [];
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function paintCmdLog() {
  $('cmdOut').innerHTML = cmdLog.length
    ? cmdLog.map(l => `<div class="cl ${l.ok ? 'ok' : 'bad'}"><div class="cl-in"><span class="pr">/</span> ${esc(l.line)}<span class="lbl">${l.at}</span></div><div class="cl-res">${l.ok ? '✓' : '×'} ${esc(l.msg)}</div></div>`).join('')
    : '<div class="cl-empty">Type a command and press Enter. The result shows here: fill price, size, liquidation, fee. Try <b>long btc 20x 1000</b>.</div>';
}
const openCmd = () => { cmd.hidden = false; cmdIn.value = ''; preview(); paintCmdLog(); setTimeout(() => cmdIn.focus(), 0); };
$('cmdOpen').addEventListener('click', openCmd);
addEventListener('keydown', e => {
  if (e.key === 'Escape') { cmd.hidden = true; $('shareModal').hidden = true; $('awayModal').hidden = true; return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (!typing && (e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey)))) { e.preventDefault(); openCmd(); }
});
cmd.addEventListener('click', e => { if (e.target === cmd) cmd.hidden = true; });
const away = (a, b) => `${E.signed(((a - b) / b) * 100)}% from the mark`;
// every command returns a line saying exactly what happened, with the numbers that matter
export function run(line) {
  const c = parse(line);
  const mark = c.sym && c.sym !== 'ALL' ? feed.marks[c.sym] : null;
  if (c.sym && c.sym !== 'ALL' && !mark && c.op !== 'cancel') throw new Error(`Waiting for the ${c.sym} mark, one second.`);
  let msg = '';
  if (c.op === 'go') {
    pick(c.sym);
    const f = feed.funding[c.sym];
    msg = `${c.sym} · mark ${E.fmtPrice(mark)} · ${feed.isRh(c.sym) ? `pool liquidity $${E.compact(feed.rh.day[c.sym]?.liqUsd || 0)}, no funding` : `funding ${E.rate(f?.rate)} an hour`} · up to ${E.market(c.sym).max}x`;
  } else if (c.op === 'order') {
    const lev = c.lev ?? Math.min(10, E.market(c.sym).max), size = c.margin * lev;
    const had = s.pos[c.sym] ? { ...s.pos[c.sym] } : null;
    submit({ ...c, lev });
    const p = s.pos[c.sym];
    if (c.type !== 'market') {
      const o = s.orders[s.orders.length - 1];
      msg = `${c.type} ${c.side} ${c.sym} resting at ${E.fmtPrice(o.price)} (${away(o.price, mark)}) · ${E.fmt(size, 0)} size at ${lev}x · holds ${E.fmt(o.hold)} aUSD until it fills`;
    } else if (!p) msg = `${c.sym} ${had.side} closed at ${E.fmtPrice(s.fills[0].price)} · net ${E.signedOr(s.closed[0]?.net ?? 0, 'even')} aUSD`;
    else {
      const odds = risk.touchOdds(c.sym, mark, p.liq, 24);
      const verb = had && had.side === p.side ? 'added to' : had ? 'flipped to' : 'opened';
      msg = `${verb} ${p.side.toUpperCase()} ${c.sym} · ${E.fmt(p.qty * mark, 0)} aUSD at ${E.fmtPrice(s.fills[0].price)}${had && had.side === p.side ? `, avg now ${E.fmtPrice(p.entry)}` : ''} · liquidation ${E.fmtPrice(p.liq)} (${((Math.abs(p.liq - mark) / mark) * 100).toFixed(2)}% away${odds != null ? `, ${risk.pct(odds)} odds in 24h` : ''}) · fee ${E.fmt(s.fills[0].fee)}`;
      if (c.tp || c.sl) msg += ` · ${c.tp ? 'TP ' + E.fmtPrice(c.tp) : ''}${c.tp && c.sl ? ', ' : ''}${c.sl ? 'SL ' + E.fmtPrice(c.sl) : ''}`;
    }
  } else if (c.op === 'close') {
    const before = s.closed.length, pl = s.pos[c.sym] ? E.upnl(s.pos[c.sym], mark) * c.share : 0;
    closeAt(c.sym, c.share);
    const f = s.fills[0];
    msg = s.closed.length > before
      ? `${c.sym} closed at ${E.fmtPrice(f.price)} · trade net ${E.signedOr(s.closed[0].net, 'even')} aUSD after fees and funding`
      : `${c.sym} cut by ${Math.round(c.share * 100)}% at ${E.fmtPrice(f.price)} · price PnL on that part ${E.signedOr(pl, 'flat')} · ${E.fmt(s.pos[c.sym].qty * mark, 0)} aUSD still open`;
  } else if (c.op === 'margin') {
    E.addMargin(s, c.sym, c.amount);
    msg = `${c.sym} margin ${E.signed(c.amount)} · now ${E.fmt(s.pos[c.sym].margin)} · liquidation moves to ${E.fmtPrice(s.pos[c.sym].liq)}`;
  } else if (c.op === 'tp' || c.op === 'sl') {
    const p = s.pos[c.sym]; if (!p) throw new Error(`No ${c.sym} position.`);
    E.setTpSl(s, c.sym, c.op === 'tp' ? c.price : p.tp, c.op === 'sl' ? c.price : p.sl, mark);
    const gain = E.upnl(p, c.price);
    msg = `${c.op === 'tp' ? 'take profit' : 'stop loss'} on ${c.sym} at ${E.fmtPrice(c.price)} (${away(c.price, mark)}) · closes the whole position for about ${E.signedOr(gain, 'even')} aUSD of price PnL`;
  } else if (c.op === 'cancel') {
    const list = s.orders.filter(o => c.sym === 'ALL' || o.sym === c.sym), back = list.reduce((a, o) => a + o.hold, 0);
    if (!list.length) throw new Error(c.sym === 'ALL' ? 'No resting orders to cancel.' : `No resting ${c.sym} orders.`);
    for (const o of list) E.cancelOrder(s, o.id);
    msg = `${list.length} order${list.length === 1 ? '' : 's'} cancelled · ${E.fmt(back)} aUSD back to free`;
  } else if (c.op === 'alert') {
    addAlert(c);
    const a = s.alerts[s.alerts.length - 1];
    msg = `alert set: ${a.sym} ${a.dir} ${E.fmtPrice(a.price)} (${away(a.price, mark)}) · a toast${'Notification' in window && Notification.permission === 'granted' ? ' and a notification' : ''} when the mark gets there`;
  } else if (c.op === 'alerts-clear') {
    const n = s.alerts.length; s.alerts = [];
    msg = n ? `${n} alert${n === 1 ? '' : 's'} removed` : 'No alerts were set.';
  } else if (c.op === 'pair') {
    openPair(c);
    const pr = s.pairs[s.pairs.length - 1];
    msg = `pair #${pr.id} open: ${pr.legs.map(l => `${l.side} ${l.sym} at ${E.fmtPrice(pr.entry[l.sym])}`).join(' / ')} · ${E.fmt(pr.margin)} margin each at ${pr.lev}x · ${E.fmt(pr.margin * pr.lev * 2, 0)} aUSD gross`;
  } else if (c.op === 'close-pair') {
    const before = s.closed.length;
    closePairs(c.id);
    const net = s.closed.slice(0, s.closed.length - before).reduce((a, t) => a + t.net, 0);
    msg = `${c.id ? `pair #${c.id}` : 'every pair'} closed · net ${E.signedOr(net, 'even')} aUSD across ${s.closed.length - before} legs`;
  }
  persist(); drawLines(); paintAll();
  c.msg = msg;
  return c;
}
window.avenRun = run;

// what the line will do, worked out as you type, before Enter
function preview() {
  const line = cmdIn.value.trim(), el = $('cmdPrev');
  if (!line) { el.innerHTML = '<span class="lbl">long · short · pair · close · margin · tp · sl · alert · cancel · go</span>'; return; }
  try {
    const c = parse(line);
    let t = '';
    if (c.op === 'order') {
      const lev = c.lev ?? Math.min(10, E.market(c.sym).max), size = c.margin * lev, mark = feed.marks[c.sym];
      if (!mark) t = `${c.side} ${c.sym} · waiting for the mark`;
      else {
        const price = c.type === 'market' ? fillPrice(c.sym, c.side, size) : c.price;
        const pv = E.preview(s, { sym: c.sym, side: c.side, size, lev, price });
        t = `${c.type} ${c.side} ${c.sym} · ${E.fmt(size, 0)} size at ${lev}x · ${c.type === 'market' ? 'fills near' : 'rests at'} ${E.fmtPrice(price)} · liquidation ${pv.liq ? E.fmtPrice(pv.liq) : 'none, this closes it'} · margin ${E.fmt(c.margin)} of ${E.fmt(s.cash)} free`;
      }
    } else if (c.op === 'close') t = s.pos[c.sym] ? `close ${Math.round(c.share * 100)}% of ${c.sym} ${s.pos[c.sym].side} · price PnL now ${E.signedOr(E.upnl(s.pos[c.sym], feed.marks[c.sym]) * c.share, 'flat')}` : `no ${c.sym} position to close`;
    else if (c.op === 'pair') t = `pair: ${c.legs.map(l => `${l.side} ${l.sym}`).join(' / ')} · ${E.fmt(c.margin)} each`;
    else if (c.op === 'alert') t = `alert on ${c.sym} at ${E.fmtPrice(c.price)}${feed.marks[c.sym] ? ` (${away(c.price, feed.marks[c.sym])})` : ''}`;
    else if (c.op === 'go') t = `switch to ${c.sym}`;
    else if (c.op === 'tp' || c.op === 'sl') {
      const p = s.pos[c.sym], m = feed.marks[c.sym];
      t = !p ? `no ${c.sym} position to protect` : `${c.op === 'tp' ? 'take profit' : 'stop loss'} on ${c.sym} at ${E.fmtPrice(c.price)}${m ? ` (${away(c.price, m)})` : ''} · about ${E.signedOr(E.upnl(p, c.price), 'even')} aUSD if it fires`;
    } else if (c.op === 'margin') {
      const p = s.pos[c.sym];
      t = !p ? `no ${c.sym} position` : `${c.sym} margin ${E.signed(c.amount)} · liquidation moves to ${E.fmtPrice(E.liqPrice({ ...p, margin: p.margin + c.amount }))}`;
    } else if (c.op === 'cancel') {
      const n = s.orders.filter(o => c.sym === 'ALL' || o.sym === c.sym).length;
      t = n ? `cancel ${n} resting order${n === 1 ? '' : 's'}` : 'nothing resting to cancel';
    } else if (c.op === 'close-pair') t = s.pairs.length ? `close ${c.id ? `pair #${c.id}` : `${s.pairs.length} pair${s.pairs.length === 1 ? '' : 's'}`}` : 'no open pairs';
    else if (c.op === 'alerts-clear') t = `remove ${s.alerts.length || 'no'} alert${s.alerts.length === 1 ? '' : 's'}`;
    else t = `${c.op.replace('-', ' ')} ${c.sym && c.sym !== 'ALL' ? c.sym : ''}`;
    el.innerHTML = `<span class="ok">↵</span> ${esc(t)}`;
  } catch (x) { el.innerHTML = `<span class="lbl">… ${esc(x.message)}</span>`; }
}
cmdIn.addEventListener('input', preview);
cmdIn.addEventListener('keydown', e => {
  if (e.key === 'ArrowUp') { cmdIn.value = lastCmd; preview(); return; }
  if (e.key !== 'Enter') return;
  const line = cmdIn.value.trim();
  if (!line) return;
  lastCmd = line;
  const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  try {
    const c = run(line);
    cmdLog.unshift({ line, msg: c.msg || 'done', ok: true, at });
    cmdIn.value = '';
    if (c.op === 'go') setTimeout(() => (cmd.hidden = true), 900);
  } catch (x) { cmdLog.unshift({ line, msg: x.message, ok: false, at }); }
  cmdLog.length = Math.min(cmdLog.length, 6);
  paintCmdLog(); preview();
});

// ---- price alerts: checked on every mark, shown as a toast and, if allowed, a browser notification
function addAlert({ sym, dir, price }) {
  const mark = feed.marks[sym];
  if (!mark) throw new Error('Waiting for the live mark.');
  dir ||= price > mark ? 'above' : 'below';
  if (dir === 'above' ? price <= mark : price >= mark) throw new Error(`${sym} is already ${dir} ${E.fmtPrice(price)}.`);
  s.alerts.push({ id: s.seq++, sym, dir, price, created: Date.now() });
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  toast(`Alert set: ${sym} ${dir} ${E.fmtPrice(price)}`);
}
function checkAlerts() {
  let hit = false;
  for (const a of [...s.alerts]) {
    const m = feed.marks[a.sym]; if (!m) continue;
    if (a.dir === 'above' ? m < a.price : m > a.price) continue;
    s.alerts.splice(s.alerts.indexOf(a), 1); hit = true;
    const msg = `${a.sym} is ${a.dir} ${E.fmtPrice(a.price)} · mark ${E.fmtPrice(m)}`;
    toast(`Alert · ${msg}`, 6000);
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Aven alert', { body: msg, icon: '/assets/logo.svg', tag: 'aven-' + a.id }); } catch {}
  }
  return hit;
}

// ---- pair trades: two market orders in one line, tracked together as a spread
function openPair({ legs, margin, lev }) {
  const L = lev ?? Math.min(5, ...legs.map(l => E.market(l.sym).max));
  for (const l of legs) {
    if (L > E.market(l.sym).max) throw new Error(`${l.sym} allows up to ${E.market(l.sym).max}x.`);
    if (s.pos[l.sym] && s.pos[l.sym].side !== l.side) throw new Error(`You already hold ${l.sym} the other way; close it first.`);
    if (!feed.marks[l.sym]) throw new Error(`Waiting for the ${l.sym} mark.`);
    fillPrice(l.sym, l.side, margin * L);   // throws if the pool can't take it
  }
  const need = legs.length * margin * (1 + L * E.TAKER);
  if (need > s.cash) throw new Error(`A pair needs ${E.fmt(need)} free, you have ${E.fmt(s.cash)}.`);
  const id = s.seq++;
  const entry = {};
  for (const l of legs) {
    const p = E.marketOrder(s, { sym: l.sym, side: l.side, size: margin * L, lev: L, price: fillPrice(l.sym, l.side, margin * L) });
    p.pair = id; entry[l.sym] = p.entry;
  }
  s.pairs.push({ id, legs, margin, lev: L, entry, opened: Date.now() });
  toast(`Pair #${id} open: ${legs.map(l => `${l.side} ${l.sym}`).join(' / ')} · ${E.fmt(margin)} each at ${L}x`);
}
function closePairs(id) {
  const list = s.pairs.filter(p => id == null || p.id === id);
  if (!list.length) throw new Error(id == null ? 'No open pairs.' : `No pair #${id}.`);
  for (const pr of list) for (const l of pr.legs) if (s.pos[l.sym] && s.pos[l.sym].pair === pr.id) closeAt(l.sym, 1);
  s.pairs = s.pairs.filter(p => !list.includes(p));
}
function pairStrip() {
  s.pairs = s.pairs.filter(pr => pr.legs.some(l => s.pos[l.sym]?.pair === pr.id));
  if (!s.pairs.length) return '';
  return `<div class="pairs">${s.pairs.map(pr => {
    let pl = 0;
    const legs = pr.legs.map(l => { const p = s.pos[l.sym], m = feed.marks[l.sym]; if (p && m && p.pair === pr.id) pl += E.upnl(p, m); const ch = m ? ((m - pr.entry[l.sym]) / pr.entry[l.sym]) * 100 : 0; return `<span class="tag ${l.side}">${l.side} ${l.sym}</span> <span class="lbl">${E.signed(ch)}%</span>`; }).join(' ');
    return `<div class="pr"><b>Pair #${pr.id}</b>${legs}<b class="pl">${E.signed(pl)}</b><span class="lbl">${E.signed((pl / (pr.margin * pr.legs.length)) * 100, 1)}%</span><button class="mini" data-act="closepair" data-id="${pr.id}">Close pair</button></div>`;
  }).join('')}</div>`;
}

// ---- views: trading and the journal live on the same page, switched without changing the route
initJournal({ get: () => s, set: n => { s = n; drawLines(); paintAll(); }, persist, share: trip => share(trip) });
mountRewind();
mountFunding(sym => { view('trade'); pick(sym); });
mountMirror({
  toast,
  copy({ sym, side, lev, margin, from }) {
    try {
      const c = run(`${side} ${sym.toLowerCase()} ${lev}x ${margin}`);
      toast(`Mirrored ${from.slice(0, 6)}…: ${c.msg}`, 6000);
    } catch (x) { toast(x.message, 5000); }
  },
});
const VIEWS = { journal: 'jView', rewind: 'rwView', funding: 'fView', mirror: 'mView' };
function view(v) {
  ui.view = VIEWS[v] ? v : 'trade';
  document.querySelector('.term').hidden = ui.view !== 'trade';
  for (const [k, id] of Object.entries(VIEWS)) $(id).hidden = ui.view !== k;
  if (ui.view !== 'rewind') stopRewind();
  $('views').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === ui.view));
  const q = new URLSearchParams(location.search);
  if (ui.view !== 'trade') q.set('view', ui.view); else q.delete('view');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  document.body.classList.toggle('jmode', ui.view !== 'trade');
  scrollTo(0, 0);
  if (ui.view === 'journal') paintJournal();
  if (ui.view === 'rewind') showRewind();
  if (ui.view === 'funding') showFunding();
  if (ui.view === 'mirror') showMirror();
}
$('views').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) view(b.dataset.view); });
addEventListener('storage', e => { if (e.key === E.STORAGE_KEY && ui.view === 'journal') paintJournal(); });

// ---- go
pick(ui.sym);
view(params.get('view'));
feed.loadAll().then(async () => {
  paintAll();
  const res = await settle.away(s);
  if (res.fired.length || Math.abs(res.funding) > 0.005) {
    $('awayGap').textContent = E.ago(res.gap);
    const rows = res.fired.map(ev => [new Date(ev.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), report(ev)]);
    if (Math.abs(res.funding) > 0.005) rows.push(['funding', `${res.funding > 0 ? 'paid' : 'received'} ${E.fmt(Math.abs(res.funding))} aUSD across open positions`]);
    $('awayList').innerHTML = rows.map(([a, b]) => `<div class="row"><span>${a}</span><span>${b}</span></div>`).join('');
    $('awayModal').hidden = false;
  }
  if (res.failed?.length) retryAway();
  persist(); drawLines(); paintAll();
}).catch(() => settle.markReady());

// markets whose replay could not be fetched yet are retried until they catch up
function retryAway() {
  setTimeout(async () => {
    const res = await settle.away(s).catch(() => null);
    if (!res) return retryAway();
    for (const ev of res.fired) toast(`While you were away: ${report(ev)}`, 5200);
    if (res.fired.length) { drawLines(); dirty = true; }
    persist();
    if (res.failed.length) retryAway();
  }, 45e3);
}
