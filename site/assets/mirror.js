// Mirror: look at any Hyperliquid account's live positions and copy one onto your paper account. The list of top
// traders is a snapshot of Hyperliquid's public leaderboard (whales.js, dated); everything about their positions is
// read live from Hyperliquid (clearinghouseState and userFills). Watching an account polls it and says when it moves.
import * as E from './engine.js';
import * as feed from './feed.js';
import { WHALES, SNAPSHOT } from './whales.js';

const $ = id => document.getElementById(id);
const INFO = 'https://api.hyperliquid.xyz/info';
const post = body => fetch(INFO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
const bySymCoin = Object.fromEntries(E.MARKETS.filter(m => m.coin).map(m => [m.coin, m.sym]));
const M = { addr: null, state: null, fills: [], timer: 0, last: null, api: null };

function list() {
  $('mwList').innerHTML = WHALES.map((w, i) => `<button type="button" class="mw ${M.addr === w.address ? 'on' : ''}" data-a="${w.address}">
    <span class="mw-n">${String(i + 1).padStart(2, '0')}</span><b>${w.name ? w.name.replace(/</g, '') : short(w.address)}</b>
    <span>$${E.compact(w.accountValue)}</span><span class="lbl">30d ${E.signed(w.monthPnl / 1e6, 1)}M · ${E.signed(w.monthRoi * 100, 1)}%</span></button>`).join('');
  $('mwSnap').textContent = `Top 20 by 30-day PnL · leaderboard snapshot ${SNAPSHOT} · positions are live`;
}

async function open(addr) {
  M.addr = addr.toLowerCase(); M.last = null;
  list();
  $('mwHead').innerHTML = `<span class="lbl">Reading ${short(M.addr)} from Hyperliquid…</span>`;
  $('mwPos').innerHTML = ''; $('mwFills').innerHTML = '';
  await refresh(true);
  clearInterval(M.timer);
  M.timer = setInterval(() => { if (!$('mView').hidden) refresh(false); }, 15e3);
}

async function refresh(first) {
  const addr = M.addr;
  let st, fills;
  try { [st, fills] = await Promise.all([post({ type: 'clearinghouseState', user: addr }), post({ type: 'userFills', user: addr })]); }
  catch { $('mwHead').innerHTML = '<span class="lbl">Could not read that account right now. Retrying in 15 seconds.</span>'; return; }
  if (addr !== M.addr) return;
  const pos = (st.assetPositions || []).map(p => p.position).filter(p => +p.szi);
  // tell the visitor when the watched account opens, closes or flips something
  const sig = Object.fromEntries(pos.map(p => [p.coin, Math.sign(+p.szi)]));
  if (M.last && !first) {
    for (const [coin, sgn] of Object.entries(sig)) if (M.last[coin] !== sgn) M.api.toast(`${short(addr)} ${M.last[coin] ? 'flipped' : 'opened'} ${sgn > 0 ? 'LONG' : 'SHORT'} ${coin}`, 6000);
    for (const coin of Object.keys(M.last)) if (!sig[coin]) M.api.toast(`${short(addr)} closed ${coin}`, 6000);
  }
  M.last = sig;
  const av = +st.marginSummary.accountValue, ntl = +st.marginSummary.totalNtlPos;
  const up = pos.reduce((a, p) => a + +p.unrealizedPnl, 0);
  const w = WHALES.find(x => x.address === addr);
  $('mwHead').innerHTML = `<div><span class="lbl">${w?.name ? w.name.replace(/</g, '') + ' · ' : ''}${addr}</span>
    <b class="mw-av">$${E.compact(av)}</b><span class="lbl">account value · ${pos.length ? `${pos.length} open · $${E.compact(ntl)} exposure · ${(ntl / av).toFixed(1)}x` : 'no open positions right now'}</span></div>
    <div class="mw-up"><span class="lbl">Unrealised</span><b>${pos.length ? `${up >= 0 ? '+' : '−'}$${E.compact(Math.abs(up))}` : 'flat'}</b><span class="lbl">watching · refreshes every 15 s</span></div>`;
  const rows = pos.sort((a, b) => +b.positionValue - +a.positionValue).map(p => {
    const sym = bySymCoin[p.coin], side = +p.szi > 0 ? 'long' : 'short', lev = p.leverage?.value || 1;
    const mark = sym ? feed.marks[sym] : null;
    return `<tr><td><b>${p.coin.replace(/^xyz:/, '')}</b></td><td><span class="tag ${side}">${side} ${lev}x</span></td><td>$${E.compact(+p.positionValue)}</td>
      <td>${E.fmtPrice(+p.entryPx)}</td><td>${mark ? E.fmtPrice(mark) : '<span class="lbl">not on Aven</span>'}</td><td>${p.liquidationPx ? E.fmtPrice(+p.liquidationPx) : '<span class="lbl">none, well covered</span>'}</td>
      <td><b>${E.signed(+p.unrealizedPnl / 1e3, 1)}K</b> <span class="lbl">${E.signed(+p.returnOnEquity * 100, 1)}%</span></td>
      <td>${sym ? `<button class="mini" data-copy="${sym}" data-side="${side}" data-lev="${Math.min(lev, E.market(sym).max)}">Mirror on paper</button>` : ''}</td></tr>`;
  }).join('');
  $('mwPos').innerHTML = pos.length
    ? `<table class="tbl"><tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>Liquidation</th><th>Unrealised</th><th></th></tr>${rows}</table>`
    : '<div class="empty">This account holds nothing right now. Its recent trades are below; watching it will tell you when it opens one.</div>';
  const recent = (fills || []).slice(0, 12);
  $('mwFills').innerHTML = recent.length
    ? `<table class="tbl"><tr><th>When</th><th>Market</th><th>Trade</th><th>Price</th><th>Value</th><th>Closed PnL</th></tr>${recent.map(f => `<tr><td>${new Date(f.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
      <td>${f.coin.replace(/^xyz:/, '')}</td><td>${f.dir}</td><td>${E.fmtPrice(+f.px)}</td><td>$${E.compact(+f.px * +f.sz)}</td><td>${+f.closedPnl ? E.signed(+f.closedPnl) : '<span class="lbl">opening</span>'}</td></tr>`).join('')}</table>`
    : '<div class="empty">No recent trades on record.</div>';
}

export function mountMirror(api) {
  M.api = api;
  list();
  $('mwList').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) open(b.dataset.a); });
  $('mwForm').addEventListener('submit', e => {
    e.preventDefault();
    const a = $('mwAddr').value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { $('mwHead').innerHTML = '<span class="lbl">That is not a Hyperliquid address: 0x followed by 40 hex characters.</span>'; return; }
    open(a);
  });
  $('mwPos').addEventListener('click', e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const margin = +$('mwMargin').value || 500;
    api.copy({ sym: b.dataset.copy, side: b.dataset.side, lev: +b.dataset.lev, margin, from: M.addr });
  });
}
export function showMirror() { if (!M.addr) open(WHALES[0].address); }
