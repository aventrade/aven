// Live perpetuals data from Hyperliquid's public API (no key, no account): mark, oracle and mid price, hourly funding,
// open interest, 24h stats, the order book, candles and every trade. One websocket carries all of it; REST fills
// in candles, funding history and a snapshot on load.

import { MARKETS } from './engine.js';
import * as RH from './rhfeed.js';

const INFO = 'https://api.hyperliquid.xyz/info';
const WS = 'wss://api.hyperliquid.xyz/ws';
export const WHALE = 50_000; // prints at or above this many dollars go on the whale tape

export const marks = {};    // sym -> mark price (PnL, liquidations, stops)
export const last = {};     // sym -> latest trade or mid (limit fills)
export const index = {};    // sym -> oracle price
export const funding = {};  // sym -> { rate (hourly), next }
export const stats = {};    // sym -> { change, vol }
export const oi = {};       // sym -> open interest in coins
export const whales = [];   // recent big prints, newest first
export const whaleTotal = { usd: 0, n: 0, buy: 0, sell: 0, since: Date.now() };

const listeners = new Set();
export const on = fn => (listeners.add(fn), () => listeners.delete(fn));
const emit = (type, data) => listeners.forEach(fn => fn(type, data));

const HL = MARKETS.filter(m => m.coin);
const byCoin = Object.fromEntries(HL.map(m => [m.coin, m.sym]));
const coinOf = sym => MARKETS.find(m => m.sym === sym).coin;
const isRh = sym => !!MARKETS.find(m => m.sym === sym)?.rh;
export { isRh };
export const rh = RH;
const nextHour = () => Math.ceil(Date.now() / 3600e3) * 3600e3;

const info = body => fetch(INFO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

function applyCtx(sym, c) {
  const mk = +c.markPx;
  marks[sym] = mk;
  index[sym] = +c.oraclePx;
  if (c.midPx && !last[sym]) last[sym] = +c.midPx;
  funding[sym] = { rate: +c.funding, next: nextHour() };
  oi[sym] = +c.openInterest;
  const prev = +c.prevDayPx;
  stats[sym] = { change: prev ? ((mk - prev) / prev) * 100 : 0, vol: +c.dayNtlVlm };
}

// Robinhood Chain stocks: pool state every 3 s, 24h stats every minute, the Wall St reference every 2 minutes
function applyRh() {
  for (const sym of RH.STOCK_SYMS) {
    const p = RH.pools[sym]; if (!p) continue;
    marks[sym] = p.price; last[sym] = p.price; index[sym] = RH.wallSt[sym]?.last || 0;
    funding[sym] = { rate: 0, next: null };
    const d = RH.day[sym];
    stats[sym] = { change: d ? d.change : 0, vol: d ? d.vol : 0 };
    oi[sym] = 0;
  }
}
let rhTimer = 0;
async function rhTick() {
  try { await RH.poll(); applyRh(); emit('mark', 'RH'); emit('tick', null); emit('status', ws && ws.readyState === 1 ? 'live' : 'reconnecting'); } catch {}
}
export function startRh() {
  if (rhTimer) return;
  rhTimer = setInterval(rhTick, 3000);
  RH.loadDay().then(applyRh).catch(() => {}); setInterval(() => RH.loadDay().then(applyRh).catch(() => {}), 60e3);
  RH.loadWallSt().then(applyRh).catch(() => {}); setInterval(() => RH.loadWallSt().then(applyRh).catch(() => {}), 120e3);
  return rhTick();
}

export async function loadAll() {
  const rhFirst = startRh();
  const [[mainMeta, mainCtx], [xyzMeta, xyzCtx]] = await Promise.all([info({ type: 'metaAndAssetCtxs' }), info({ type: 'metaAndAssetCtxs', dex: 'xyz' })]);
  await rhFirst;
  for (const [meta, ctx] of [[mainMeta, mainCtx], [xyzMeta, xyzCtx]]) {
    meta.universe.forEach((u, i) => {
      const sym = byCoin[u.name]; if (!sym) return;
      MARKETS.find(m => m.sym === sym).max = u.maxLeverage;
      applyCtx(sym, ctx[i]);
    });
  }
  emit('tick', null);
}
export const loadOI = async () => {};

const MS = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 };
const toBar = k => ({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
export const klines = (sym, interval = '15m', limit = 500) => isRh(sym) ? RH.candles(sym, interval, limit) :
  info({ type: 'candleSnapshot', req: { coin: coinOf(sym), interval, startTime: Date.now() - MS[interval] * limit, endTime: Date.now() } }).then(r => r.map(toBar));
// Hyperliquid has no mark-price candles; trade candles stand in for both mark and last when replaying an absence
export const rangeKlines = (sym, start, end, interval = '1m') => isRh(sym)
  ? RH.candles(sym, interval, 1000, end).then(rows => rows.filter(b => b.time * 1000 >= start - MS[interval])) :
  info({ type: 'candleSnapshot', req: { coin: coinOf(sym), interval, startTime: start, endTime: end } }).then(r => r.map(toBar));
export const fundingHistory = (sym, start) => isRh(sym) ? Promise.resolve([]) :
  info({ type: 'fundingHistory', coin: coinOf(sym), startTime: start }).then(r => r.map(f => ({ t: f.time, rate: +f.fundingRate, mark: 0 })));

let ws = null, focus = null, retry = 0, poll = 0;
const send = sub => ws && ws.readyState === 1 && ws.send(JSON.stringify({ method: 'subscribe', subscription: sub }));
const unsend = sub => ws && ws.readyState === 1 && ws.send(JSON.stringify({ method: 'unsubscribe', subscription: sub }));

export function connect(f = null) {
  const prev = focus;
  focus = f;
  if (ws && ws.readyState === 1) {
    if (prev && !isRh(prev.sym)) { unsend({ type: 'l2Book', coin: coinOf(prev.sym) }); unsend({ type: 'candle', coin: coinOf(prev.sym), interval: prev.interval }); }
    if (focus && !isRh(focus.sym)) { send({ type: 'l2Book', coin: coinOf(focus.sym) }); send({ type: 'candle', coin: coinOf(focus.sym), interval: focus.interval }); }
    return;
  }
  if (!ws) open();
}

function open() {
  ws = new WebSocket(WS);
  ws.onopen = () => {
    retry = 0; clearInterval(poll); poll = 0;
    for (const m of HL) { send({ type: 'activeAssetCtx', coin: m.coin }); send({ type: 'trades', coin: m.coin }); }
    if (focus && !isRh(focus.sym)) { send({ type: 'l2Book', coin: coinOf(focus.sym) }); send({ type: 'candle', coin: coinOf(focus.sym), interval: focus.interval }); }
    emit('status', 'live');
  };
  ws.onmessage = e => {
    const { channel, data } = JSON.parse(e.data);
    if (channel === 'activeAssetCtx') {
      const sym = byCoin[data.coin]; if (!sym) return;
      applyCtx(sym, data.ctx);
      emit('mark', sym);
    } else if (channel === 'trades') {
      for (const t of data) {
        const sym = byCoin[t.coin]; if (!sym) continue;
        const px = +t.px, usd = px * +t.sz;
        last[sym] = px;
        if (focus && sym === focus.sym) emit('trade', { sym, price: px, usd, buy: t.side === 'B', time: t.time });
        if (usd >= WHALE) {
          const w = { sym, side: t.side === 'B' ? 'buy' : 'sell', price: px, usd, time: t.time };
          whales.unshift(w); whales.length = Math.min(whales.length, 150);
          whaleTotal.usd += usd; whaleTotal.n++; whaleTotal[w.side] += usd;
          emit('whale', w);
        }
      }
      emit('tick', null);
    } else if (channel === 'l2Book') {
      if (!focus || byCoin[data.coin] !== focus.sym) return;
      const [b, a] = data.levels;
      emit('depth', { bids: b.map(l => [+l.px, +l.sz]), asks: a.map(l => [+l.px, +l.sz]) });
    } else if (channel === 'candle') {
      if (!focus || byCoin[data.s] !== focus.sym || data.i !== focus.interval) return;
      emit('kline', toBar(data));
    }
  };
  ws.onclose = () => {
    ws = null;
    emit('status', 'reconnecting');
    if (!poll) poll = setInterval(() => loadAll().catch(() => {}), 4000);
    setTimeout(open, Math.min(15000, 1000 * 2 ** retry++));
  };
}
setInterval(() => ws && ws.readyState === 1 && ws.send('{"method":"ping"}'), 30e3);
