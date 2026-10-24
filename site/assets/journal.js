// The journal view inside /trade/: stats, equity curve, leverage / market / tag breakdowns, the trade log with
// tags and notes, CSV export and runs. It works on the same account object as the trading view.
import * as E from './engine.js';
import * as feed from './feed.js';
import { toast } from './ui.js';

const $ = id => document.getElementById(id);
const TAGS = ['plan', 'fomo', 'revenge', 'scalp', 'hedge', 'news'];
let api = null, chart = null, area = null;
const S = () => api.get();

function makeChart() {
chart = LightweightCharts.createChart($('curve'), {
  autoSize: true,
  layout: { background: { color: 'transparent' }, textColor: 'rgba(255,255,255,.6)', fontFamily: 'IBM Plex Mono', fontSize: 11 },
  grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,.06)' } },
  rightPriceScale: { borderColor: 'rgba(255,255,255,.16)' },
  timeScale: { borderColor: 'rgba(255,255,255,.16)', timeVisible: true },
  crosshair: { vertLine: { labelBackgroundColor: '#fff' }, horzLine: { labelBackgroundColor: '#fff' } },
});
area = chart.addAreaSeries({ lineColor: '#ffffff', lineWidth: 2, topColor: 'rgba(255,255,255,.22)', bottomColor: 'rgba(255,255,255,0)' });
area.createPriceLine({ price: E.START, color: 'rgba(255,255,255,.35)', lineStyle: 2, lineWidth: 1, title: 'start' });
}

// a share of trades; none of them is "none", never 0%
const pct = x => (x > 0 ? `${Math.max(1, Math.round(x * 100))}%` : 'none');
const money = x => E.signedOr(x, 'even');
const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function table(rows, head) {
  if (!rows.length) return '<div class="empty">Nothing here yet.</div>';
  return `<table class="tbl"><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
}
function groupBy(trips, key) {
  const m = new Map();
  for (const t of trips) for (const k of [].concat(key(t))) { if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return [...m.entries()].map(([k, list]) => [k, E.stats(list)]);
}

export function paint(full = true) {
  if (!api || $('jView').hidden) return;
  if (!chart) makeChart();
  const s = S();
  const trips = s.closed;
  const st = E.stats(trips);
  const q = E.equity(s, feed.marks);
  $('jRun').textContent = `Run ${s.run} · started ${when(s.started)}`;
  const k = [
    ['Account value', E.fmt(q.total), Math.abs(q.total - E.START) < 0.005 ? `even on ${E.fmt(E.START, 0)}` : `${E.signed(((q.total - E.START) / E.START) * 100)}% on ${E.fmt(E.START, 0)}`],
    ['Realised net', st.n ? E.signedOr(st.net, 'even') : 'nothing yet', st.n ? `${st.n} closed trade${st.n === 1 ? '' : 's'}` : 'close a trade to start the record'],
    ['Win rate', st.n ? pct(st.winRate) : 'no trades yet', st.n ? `${st.wins} won · ${st.n - st.wins} lost` : 'counts every closed trade'],
    ['Profit factor', st.n ? (st.pf === Infinity ? 'no losers' : st.pf ? st.pf.toFixed(2) : 'no winners') : 'no trades yet', 'gross won ÷ gross lost'],
    ['Average win / loss', st.n ? `${st.wins ? E.fmt(st.avgWin, 0) : 'none'} / ${st.n - st.wins ? E.fmt(Math.abs(st.avgLoss), 0) : 'none'}` : 'no trades yet', 'aUSD per trade, after costs'],
    ['Liquidations', st.liqs ? String(st.liqs) : 'none', st.liqs ? `${pct(st.liqs / st.n)} of trades` : 'keep it that way'],
    ['Fees + funding', st.n ? E.amt(st.fees + st.funding) : 'none yet', st.n ? `fees ${E.amt(st.fees)} · funding ${E.signedOr(st.funding, 'none')}` : 'paid on every trade'],
    ['Average hold', st.n ? E.ago(st.hold) : 'no trades yet', st.best ? `best ${money(st.best.net)} · worst ${money(st.worst.net)}` : 'time from open to close'],
  ];
  $('kpis').innerHTML = k.map(([a, b, c]) => `<div class="kpi"><span class="lbl">${a}</span><b>${b}</b><span class="lbl">${c}</span></div>`).join('');

  const pts = s.curve.map(([t, v]) => ({ time: Math.floor(t / 1000), value: v }));
  const uniq = pts.filter((p, i) => i === 0 || p.time > pts[i - 1].time);
  uniq.push({ time: Math.max(Math.floor(Date.now() / 1000), (uniq.at(-1)?.time || 0) + 1), value: +q.total.toFixed(2) });
  area.setData(uniq);
  chart.timeScale().fitContent();
  if (!full) return;

  const bucket = t => (t.lev <= 3 ? '1–3x' : t.lev <= 10 ? '4–10x' : t.lev <= 20 ? '11–20x' : '21x +');
  const order = ['1–3x', '4–10x', '11–20x', '21x +'];
  const lev = groupBy(trips, bucket).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  $('byLev').innerHTML = table(lev.map(([k, v]) => [k, v.n, pct(v.winRate), `<b>${money(v.net)}</b>`, v.liqs || "none"]), ['Leverage', 'Trades', 'Won', 'Net', 'Liq.']);
  const mk = groupBy(trips, t => t.sym).sort((a, b) => b[1].net - a[1].net);
  $('byMkt').innerHTML = table(mk.map(([k, v]) => [k, v.n, pct(v.winRate), `<b>${money(v.net)}</b>`]), ['Market', 'Trades', 'Won', 'Net']);
  const tg = groupBy(trips.filter(t => t.tags.length), t => t.tags).sort((a, b) => a[1].net - b[1].net);
  $('byTag').innerHTML = tg.length
    ? table(tg.map(([k, v]) => [`#${k}`, v.n, pct(v.winRate), `<b>${money(v.net)}</b>`]), ['Tag', 'Trades', 'Won', 'Net'])
    : '<div class="empty">Tag your trades below (plan, fomo, revenge…) and this shows which habit pays and which one bleeds.</div>';

  $('log').innerHTML = trips.length ? `<table class="tbl jt"><tr><th>Market</th><th>Opened</th><th>Held</th><th>Entry → exit</th><th>Net</th><th>How</th><th>Tags</th><th>Note</th><th></th></tr>${trips.map(t => `
    <tr data-id="${t.id}"><td>${t.sym} <span class="tag ${t.side}">${t.side} ${t.lev}x</span></td><td>${when(t.opened)}</td><td>${E.ago(t.closed - t.opened)}</td>
    <td>${E.fmtPrice(t.entry)} → ${E.fmtPrice(t.exit)}</td><td><b>${money(t.net)}</b> <span class="lbl">${E.signed((t.net / t.maxMargin) * 100, 1)}%</span></td><td>${t.reason}</td>
    <td class="tagset">${TAGS.map(g => `<button type="button" data-tag="${g}" class="${t.tags.includes(g) ? 'on' : ''}">${g}</button>`).join('')}</td>
    <td><input class="note" value="${(t.note || '').replace(/"/g, '&quot;')}" placeholder="why did you take it?" maxlength="140"></td>
    <td><button class="mini" data-act="receipt" type="button">Receipt</button></td></tr>`).join('')}</table>`
    : '<div class="empty">No closed trades in this run yet. Everything you close, every stop and every liquidation lands here.</div>';

  $('runsBox').hidden = !s.runs.length;
  $('runs').innerHTML = table(s.runs.slice().reverse().map(r => [`Run ${r.run}`, when(r.started), when(r.ended), r.trades, `<b>${E.fmt(r.final)}</b>`, `${E.signed(((r.final - E.START) / E.START) * 100)}%`]),
    ['Run', 'Started', 'Ended', 'Trades', 'Final value', 'Return']);
}

$('log').addEventListener('click', e => {
  const row = e.target.closest('tr[data-id]'); if (!row) return;
  const t = S().closed.find(x => x.id === +row.dataset.id); if (!t) return;
  const tag = e.target.closest('button[data-tag]');
  if (tag) {
    const g = tag.dataset.tag;
    t.tags = t.tags.includes(g) ? t.tags.filter(x => x !== g) : [...t.tags, g];
    api.persist(); paint();
  } else if (e.target.closest('[data-act=receipt]')) {
    api.share(t);
    return;
  }
});
$('log').addEventListener('change', e => {
  if (!e.target.classList.contains('note')) return;
  const t = S().closed.find(x => x.id === +e.target.closest('tr').dataset.id);
  if (t) { t.note = e.target.value.slice(0, 140); api.persist(); toast('Note saved'); }
});

$('csv').addEventListener('click', () => {
  const s = S();
  const head = ['id', 'market', 'side', 'leverage', 'opened', 'closed', 'entry', 'exit', 'price_pnl', 'fees', 'funding', 'net', 'reason', 'tags', 'note'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = s.closed.map(t => [t.id, t.sym, t.side, t.lev, new Date(t.opened).toISOString(), new Date(t.closed).toISOString(), t.entry, t.exit, t.pnl.toFixed(2), t.fees.toFixed(2), t.funding.toFixed(2), t.net.toFixed(2), t.reason, t.tags.join(' '), t.note].map(esc).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' }));
  a.download = `aven-run-${s.run}.csv`;
  a.click();
});

$('newRun').addEventListener('click', () => {
  let s = S();
  const open = Object.keys(s.pos).length + s.orders.length;
  if (!confirm(`End run ${s.run}${open ? ` (open positions and orders are dropped)` : ''} and start run ${s.run + 1} with ${E.fmt(E.START, 0)} aUSD?`)) return;
  s = E.newRun(s, feed.marks);
  api.set(s); api.persist(); paint();
  toast(`Run ${s.run} started`);
});

export function initJournal(a) {
  api = a;
  feed.on(type => { if (type === 'mark') { clearTimeout(paint.t); paint.t = setTimeout(() => paint(false), 2000); } });
}
