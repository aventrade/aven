// The funding board: every Hyperliquid market's live funding next to what Binance and Bybit charge for the same coin
// (Hyperliquid's predictedFundings feed), all turned into the same units: per hour, per year, and what 10,000 aUSD
// of position pays or earns in a day. Positive means longs pay shorts.
import * as E from './engine.js';

const $ = id => document.getElementById(id);
const VENUES = [['HlPerp', 'Hyperliquid'], ['BinPerp', 'Binance'], ['BybitPerp', 'Bybit']];
let rows = [], at = 0, sortKey = 'abs', timer = 0, onPick = null;

async function load() {
  const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"predictedFundings"}' }).then(r => r.json());
  const by = Object.fromEntries(r.map(([coin, v]) => [coin, Object.fromEntries(v.filter(x => x[1]).map(([k, f]) => [k, { hourly: +f.fundingRate / f.fundingIntervalHours, next: f.nextFundingTime, every: f.fundingIntervalHours }]))]));
  rows = E.MARKETS.filter(m => m.coin && by[m.coin]).map(m => ({ m, v: by[m.coin] }));
  at = Date.now();
}

const apr = h => h * 24 * 365 * 100;
const cell = f => !f ? '<span class="lbl">not listed</span>' : !f.hourly ? '<b>flat</b><span class="lbl">nobody pays</span>' : `<b>${Math.abs(apr(f.hourly)) < 0.05 ? (f.hourly > 0 ? '+<0.1%' : '−<0.1%') : E.signed(apr(f.hourly), 1) + '%'}</b><span class="lbl">${E.rate(f.hourly)}/h</span>`;

function paint() {
  const box = $('fundBoard');
  if (!rows.length) { box.innerHTML = '<div class="empty">Reading funding from Hyperliquid, Binance and Bybit…</div>'; return; }
  const list = [...rows].sort((a, b) => sortKey === 'abs' ? Math.abs(b.v.HlPerp?.hourly || 0) - Math.abs(a.v.HlPerp?.hourly || 0)
    : sortKey === 'spread' ? Math.abs(spread(b)) - Math.abs(spread(a)) : a.m.sym.localeCompare(b.m.sym));
  const max = Math.max(...rows.map(r => Math.abs(apr(r.v.HlPerp?.hourly || 0))), 1e-9);
  box.innerHTML = `<table class="tbl fund"><tr><th>Market</th><th>Hyperliquid, a year</th><th>Binance</th><th>Bybit</th><th>Gap vs Binance</th><th>10,000 aUSD long, a day</th><th></th></tr>${list.map(({ m, v }) => {
    const hl = v.HlPerp, day = hl ? -10000 * hl.hourly * 24 : 0, sp = spread({ v });
    const w = hl ? Math.min(100, (Math.abs(apr(hl.hourly)) / max) * 100) : 0;
    return `<tr><td><button class="sym-btn" data-pick="${m.sym}">${m.sym}</button> <span class="lbl">${m.group}</span></td>
      <td class="heat"><i class="${hl && hl.hourly < 0 ? 'neg' : ''}" style="width:${w}%"></i>${cell(hl)}</td><td>${cell(v.BinPerp)}</td><td>${cell(v.BybitPerp)}</td>
      <td>${sp == null ? '<span class="lbl">no Binance market</span>' : Math.abs(sp) < 0.05 ? 'level' : `${E.signed(sp, 1)} pts`}</td>
      <td>${hl ? (Math.abs(day) < 0.005 ? '<span class="lbl">about even</span>' : `${day > 0 ? 'earns' : 'pays'} ${E.fmt(Math.abs(day))}`) : ''}</td>
      <td><button class="mini" data-pick="${m.sym}">Trade</button></td></tr>`;
  }).join('')}</table>`;
  $('fundAt').textContent = `read ${E.ago(Date.now() - at)} ago · refreshes every minute`;
}
// Hyperliquid's yearly rate minus Binance's, in percentage points: who is paying more for the same exposure
function spread({ v }) { return v.HlPerp && v.BinPerp ? apr(v.HlPerp.hourly) - apr(v.BinPerp.hourly) : null; }

export function mountFunding(pick) {
  onPick = pick;
  $('fundSort').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    sortKey = b.dataset.sort;
    $('fundSort').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    paint();
  });
  $('fundBoard').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) onPick(b.dataset.pick); });
}
export async function showFunding() {
  paint();
  try { await load(); } catch { $('fundBoard').innerHTML = '<div class="empty">Could not reach Hyperliquid. Retrying in a minute.</div>'; }
  paint();
  clearInterval(timer);
  timer = setInterval(async () => { if ($('fView').hidden) return clearInterval(timer); try { await load(); } catch {} paint(); }, 60e3);
}
