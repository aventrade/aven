// Rewind: trade a real day again. Pick a market and one of its wildest days of the last two weeks; the day's real
// 5-minute candles replay from midnight UTC at 1, 3 or 10 candles a second on a separate 50,000 aUSD account, with
// the same engine as the live app: liquidations, the real hourly funding of that day, fees. Results stay in this browser.
import * as E from './engine.js';
import * as feed from './feed.js';

const $ = id => document.getElementById(id);
const KEY = 'aven.rewind.v1';
const DAY = 86400e3, STEP = 300e3;
const R = { sym: 'BTC', day: null, speed: 3, bars: [], i: 0, acct: null, timer: 0, chart: null, series: null, lines: [], funding: [], fi: 0, log: [] };

const history = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const saveHistory = h => { try { localStorage.setItem(KEY, JSON.stringify(h.slice(0, 50))); } catch {} };
const dayLabel = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const clock = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

function marketsChips() {
  $('rwMk').innerHTML = E.MARKETS.filter(m => m.coin).map(m => `<button type="button" data-s="${m.sym}" class="${m.sym === R.sym ? 'on' : ''}">${m.sym}</button>`).join('');
}

// the wildest complete days within reach of 5-minute candles (Hyperliquid keeps about 17 days of them)
async function days() {
  $('rwDays').innerHTML = '<div class="empty">Finding the wildest days…</div>';
  const today = Math.floor(Date.now() / DAY) * DAY;
  const rows = await feed.rangeKlines(R.sym, today - 15 * DAY, today, '1h');
  const by = new Map();
  for (const b of rows) { const d = Math.floor((b.time * 1000) / DAY) * DAY; if (!by.has(d)) by.set(d, []); by.get(d).push(b); }
  const list = [...by.entries()].filter(([d, b]) => b.length >= 20 && d >= today - 15 * DAY).map(([d, b]) => {
    const hi = Math.max(...b.map(x => x.high)), lo = Math.min(...b.map(x => x.low)), o = b[0].open, c = b[b.length - 1].close;
    return { d, range: (hi - lo) / o, move: (c - o) / o };
  }).sort((a, b) => b.range - a.range).slice(0, 6);
  if (!list.length) { $('rwDays').innerHTML = '<div class="empty">No complete days found for this market yet. Pick another one.</div>'; return; }
  R.day = list[0].d;
  $('rwDays').innerHTML = list.map((x, i) => `<button type="button" data-d="${x.d}" class="rwday ${i ? '' : 'on'}"><b>${dayLabel(x.d)}</b><span>${(x.range * 100).toFixed(1)}% range</span><span class="lbl">closed ${x.move >= 0 ? 'up' : 'down'} ${Math.abs(x.move * 100).toFixed(1)}%</span></button>`).join('');
}

function makeChart() {
  if (R.chart) return;
  R.chart = LightweightCharts.createChart($('rwChart'), {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: 'rgba(255,255,255,.6)', fontFamily: 'IBM Plex Mono', fontSize: 11 },
    grid: { vertLines: { color: 'rgba(255,255,255,.05)' }, horzLines: { color: 'rgba(255,255,255,.05)' } },
    rightPriceScale: { borderColor: 'rgba(255,255,255,.16)' },
    timeScale: { borderColor: 'rgba(255,255,255,.16)', timeVisible: true },
    crosshair: { vertLine: { labelBackgroundColor: '#fff' }, horzLine: { labelBackgroundColor: '#fff' } },
  });
  R.series = R.chart.addCandlestickSeries({ upColor: '#fff', downColor: '#000', borderUpColor: '#fff', borderDownColor: '#fff', wickUpColor: '#fff', wickDownColor: 'rgba(255,255,255,.7)' });
}

async function start() {
  $('rwStart').disabled = true;
  $('rwStart').textContent = 'Loading the day…';
  try {
    const [bars, fh] = await Promise.all([feed.rangeKlines(R.sym, R.day, R.day + DAY - 1, '5m'), feed.fundingHistory(R.sym, R.day).catch(() => [])]);
    R.bars = bars.filter(b => b.time * 1000 >= R.day && b.time * 1000 < R.day + DAY);
    if (R.bars.length < 100) throw new Error('Not enough candles for that day.');
    R.funding = fh.filter(f => f.t >= R.day && f.t < R.day + DAY); R.fi = 0;
  } catch (x) {
    $('rwStart').disabled = false; $('rwStart').textContent = 'Start the day';
    $('rwMsg').textContent = x.message || 'Could not load that day.'; return;
  }
  R.acct = E.fresh(); R.acct.seen = R.day; R.i = 12; R.log = [];
  $('rwSetup').hidden = true; $('rwEnd').hidden = true; $('rwPlay').hidden = false;
  makeChart();
  const d = E.dp(R.bars[0].close);
  R.series.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: 10 ** -d } });
  R.series.setData(R.bars.slice(0, R.i));
  // about half a day of 5-minute candles in view, the newest kept at the right edge
  R.chart.timeScale().applyOptions({ barSpacing: Math.max(3, Math.min(9, $('rwChart').clientWidth / 150)), rightOffset: 6 });
  R.chart.timeScale().scrollToRealTime();
  $('rwLev').max = E.market(R.sym).max;
  if (+$('rwLev').value > E.market(R.sym).max) $('rwLev').value = E.market(R.sym).max;
  $('rwTitle').textContent = `${R.sym} · ${dayLabel(R.day)}`;
  paint();
  play();
}

const bar = () => R.bars[Math.min(R.i, R.bars.length) - 1];
const markNow = () => bar().close;

function tick() {
  if (R.i >= R.bars.length) return finish();
  const b = R.bars[R.i++];
  const t = b.time * 1000;
  while (R.fi < R.funding.length && R.funding[R.fi].t <= t + STEP) {
    const f = R.funding[R.fi++];
    const pay = E.settleFunding(R.acct, R.sym, f.rate, b.open, f.t);
    if (pay) note(`${clock(f.t)} funding ${pay > 0 ? 'paid' : 'received'} ${E.fmt(Math.abs(pay))}`);
  }
  for (const ev of E.step(R.acct, R.sym, { markLo: b.low, markHi: b.high, lastLo: b.low, lastHi: b.high, t })) note(`${clock(t)} ${ev.kind}${ev.side ? ' ' + ev.side : ''}`, true);
  R.series.update(b);
  R.chart.timeScale().scrollToRealTime();
  paint();
}

function play() { clearInterval(R.timer); R.timer = setInterval(tick, 1000 / R.speed); $('rwPause').textContent = 'Pause'; }
function pause() { clearInterval(R.timer); R.timer = 0; $('rwPause').textContent = 'Play'; }

function note(text, loud = false) { R.log.unshift({ text, loud }); $('rwLog').innerHTML = R.log.slice(0, 14).map(l => `<div class="${l.loud ? 'loud' : ''}">${l.text}</div>`).join(''); }

function paint() {
  const b = bar(), mk = b.close, A = R.acct;
  const q = E.equity(A, { [R.sym]: mk });
  $('rwClock').textContent = clock(b.time * 1000);
  $('rwProg').style.width = `${(R.i / R.bars.length) * 100}%`;
  $('rwMark').textContent = E.fmtPrice(mk);
  $('rwEq').textContent = E.fmt(q.total);
  const ret = ((q.total - E.START) / E.START) * 100;
  $('rwRet').textContent = Math.abs(ret) < 0.005 ? 'even so far' : `${E.signed(ret)}% on the day`;
  const p = A.pos[R.sym];
  $('rwPos').innerHTML = p
    ? `<span class="tag ${p.side}">${p.side} ${E.effLev(p, mk).toFixed(1)}x</span> entry ${E.fmtPrice(p.entry)} · liq ${E.fmtPrice(p.liq)} · <b>${E.signed(E.upnl(p, mk))}</b>`
    : '<span class="lbl">Flat. Pick a side.</span>';
  $('rwClose').disabled = !p;
  R.lines.forEach(l => R.series.removePriceLine(l)); R.lines = [];
  if (p) {
    R.lines.push(R.series.createPriceLine({ price: p.entry, color: '#fff', lineWidth: 1, lineStyle: 0, title: 'entry' }));
    R.lines.push(R.series.createPriceLine({ price: p.liq, color: 'rgba(255,255,255,.55)', lineWidth: 1, lineStyle: 2, title: 'liq' }));
  }
}

function order(side) {
  try {
    const margin = +$('rwMargin').value, lev = +$('rwLev').value, mk = markNow();
    E.marketOrder(R.acct, { sym: R.sym, side, size: margin * lev, lev, price: mk });
    note(`${clock(bar().time * 1000)} ${side} ${E.fmt(margin * lev, 0)} at ${E.fmtPrice(mk)}`);
    paint();
  } catch (x) { note(x.message, true); }
}

function finish(early = false) {
  pause();
  const A = R.acct, mk = markNow();
  if (A.pos[R.sym]) E.closePart(A, R.sym, 1, mk, early ? 'stopped early' : 'end of day');
  const st = E.stats(A.closed);
  const final = E.equity(A, {}).total, ret = ((final - E.START) / E.START) * 100;
  const h = history();
  const best = h.filter(x => x.sym === R.sym && x.day === R.day).reduce((m, x) => Math.max(m, x.final), -Infinity);
  h.unshift({ sym: R.sym, day: R.day, final, trades: st.n, liqs: st.liqs, played: Date.now(), upTo: R.i, of: R.bars.length });
  saveHistory(h);
  $('rwPlay').hidden = true; $('rwEnd').hidden = false;
  const verdict = st.n === 0 ? 'You sat the whole day out.' : st.liqs ? `Liquidated ${st.liqs === 1 ? 'once' : st.liqs + ' times'}.` : ret > 0 ? 'You beat the day.' : 'The day beat you.';
  $('rwSum').innerHTML = `<span class="lbl">${R.sym} · ${dayLabel(R.day)} · ${early ? `stopped at ${clock(bar().time * 1000)}` : 'full day'}</span>
    <h2 class="disp">${verdict}</h2>
    <div class="rw-k"><div><span class="lbl">Start</span><b>${E.fmt(E.START, 0)}</b></div><div><span class="lbl">Finish</span><b>${E.fmt(final)}</b></div>
    <div><span class="lbl">Return</span><b>${Math.abs(ret) < 0.005 ? 'even' : E.signed(ret) + '%'}</b></div><div><span class="lbl">Trades</span><b>${st.n || 'none'}</b></div>
    ${best > -Infinity ? `<div><span class="lbl">Your best on this day</span><b>${E.fmt(Math.max(best, final))}</b></div>` : ''}</div>`;
  const text = `Rewound ${R.sym} on ${dayLabel(R.day)} with @aventrade_: 50,000 → ${E.fmt(final, 0)} (${E.signed(ret, 1)}%). Real candles, paper money.`;
  $('rwShare').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  paintHistory();
}

function paintHistory() {
  const h = history();
  $('rwHist').innerHTML = h.length
    ? `<table class="tbl"><tr><th>Market</th><th>Day</th><th>Finish</th><th>Return</th><th>Trades</th><th>Played</th></tr>${h.map(x => `<tr><td>${x.sym}</td><td>${dayLabel(x.day)}</td><td>${E.fmt(x.final)}</td><td><b>${Math.abs(x.final - E.START) < 0.5 ? 'even' : E.signed(((x.final - E.START) / E.START) * 100) + '%'}</b></td><td>${x.trades || 'none'}${x.liqs ? ` · ${x.liqs} liq.` : ''}</td><td>${new Date(x.played).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td></tr>`).join('')}</table>`
    : '<div class="empty">Your rewinds land here with their result.</div>';
}

export function mountRewind() {
  marketsChips();
  $('rwMk').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; R.sym = b.dataset.s; marketsChips(); days().catch(() => { $('rwDays').innerHTML = '<div class="empty">Could not read past days. Try again in a moment.</div>'; }); });
  $('rwDays').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; R.day = +b.dataset.d; $('rwDays').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  $('rwSpeed').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; R.speed = +b.dataset.x; $('rwSpeed').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); if (R.timer) play(); });
  $('rwStart').addEventListener('click', start);
  $('rwPause').addEventListener('click', () => (R.timer ? pause() : play()));
  $('rwQuit').addEventListener('click', () => finish(true));
  $('rwLong').addEventListener('click', () => order('long'));
  $('rwShort').addEventListener('click', () => order('short'));
  $('rwClose').addEventListener('click', () => { if (R.acct.pos[R.sym]) { E.closePart(R.acct, R.sym, 1, markNow(), 'close'); note(`${clock(bar().time * 1000)} closed at ${E.fmtPrice(markNow())}`); paint(); } });
  $('rwLev').addEventListener('input', () => ($('rwLevOut').textContent = `${$('rwLev').value}x`));
  $('rwAgain').addEventListener('click', () => { $('rwEnd').hidden = true; $('rwSetup').hidden = false; $('rwStart').disabled = false; $('rwStart').textContent = 'Start the day'; });
}
let shown = false;
export function showRewind() {
  paintHistory();
  if (!shown) { shown = true; days().catch(() => { $('rwDays').innerHTML = '<div class="empty">Could not read past days. Try again in a moment.</div>'; }); }
}
export const rewindRunning = () => !!R.timer;
export const stopRewind = () => pause();
