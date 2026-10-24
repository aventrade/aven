// Aven paper perpetuals engine. One netted, isolated-margin position per market (adding averages the entry, an
// opposite order reduces, closes or flips it), market / limit / stop orders, real funding settled from the
// futures funding rate, liquidation on the futures mark price. Pure functions over a plain state object, so the
// same code settles live ticks and the candles a visitor missed while away.

export const START = 50_000;
export const TAKER = 0.0005;      // market and stop fills
export const MAKER = 0.0002;      // resting limit fills
export const MAINT = 0.005;       // maintenance margin, share of notional at mark
export const MIN_SIZE = 10;       // minimum order notional, aUSD
export const FUNDING_MS = 3600e3; // Hyperliquid pays funding every hour

import { RH_STOCKS } from './rhpools.js';

// coin = the Hyperliquid name (HIP-3 markets carry their dex prefix); max = Hyperliquid's own max leverage
export const MARKETS = [
  { sym: 'BTC', coin: 'BTC', name: 'Bitcoin', max: 40, group: 'Crypto' },
  { sym: 'ETH', coin: 'ETH', name: 'Ethereum', max: 25, group: 'Crypto' },
  { sym: 'SOL', coin: 'SOL', name: 'Solana', max: 20, group: 'Crypto' },
  { sym: 'XRP', coin: 'XRP', name: 'XRP', max: 20, group: 'Crypto' },
  { sym: 'HYPE', coin: 'HYPE', name: 'Hyperliquid', max: 10, group: 'Crypto' },
  { sym: 'ZEC', coin: 'ZEC', name: 'Zcash', max: 10, group: 'Crypto' },
  { sym: 'BNB', coin: 'BNB', name: 'BNB', max: 10, group: 'Crypto' },
  { sym: 'DOGE', coin: 'DOGE', name: 'Dogecoin', max: 10, group: 'Crypto' },
  { sym: 'SUI', coin: 'SUI', name: 'Sui', max: 10, group: 'Crypto' },
  { sym: 'NEAR', coin: 'NEAR', name: 'Near', max: 10, group: 'Crypto' },
  { sym: 'ENA', coin: 'ENA', name: 'Ethena', max: 10, group: 'Crypto' },
  { sym: 'PEPE', coin: 'kPEPE', name: 'Pepe ×1000', max: 10, group: 'Crypto' },
  { sym: 'GOLD', coin: 'xyz:GOLD', name: 'Gold', max: 25, group: 'Macro' },
  { sym: 'SILVER', coin: 'xyz:SILVER', name: 'Silver', max: 25, group: 'Macro' },
  { sym: 'OIL', coin: 'xyz:CL', name: 'WTI crude', max: 20, group: 'Macro' },
  { sym: 'US100', coin: 'xyz:XYZ100', name: 'US tech 100', max: 30, group: 'Macro' },
  // Robinhood Chain stock tokens: priced from their own pools on-chain, no funding, 5x cap (the pools are thin)
  ...RH_STOCKS.map(s => ({ sym: s.sym, coin: null, rh: true, name: s.name, max: 5, group: 'Stocks' })),
];
export const market = sym => MARKETS.find(m => m.sym === sym) || MARKETS[0];
export const bySym = sym => MARKETS.find(m => m.sym === sym);

// decimals follow the price: 80,123.4 · 2,376.62 · 102.03 · 1.2883 · 0.07824 · 0.004471
export function dp(price) {
  if (!(price > 0)) return 2;
  if (price >= 10000) return 1;
  if (price >= 100) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  if (price >= 0.01) return 5;
  return 7;
}

const dir = side => (side === 'long' ? 1 : -1);
const opp = side => (side === 'long' ? 'short' : 'long');

export function fresh(run = 1) {
  return { v: 2, run, started: Date.now(), cash: START, pos: {}, orders: [], fills: [], closed: [], curve: [[Date.now(), START]], runs: [], seq: 1, seen: Date.now() };
}

// ---- position maths
export const notional = (p, mark) => p.qty * mark;
export const upnl = (p, mark) => (mark - p.entry) * p.qty * dir(p.side);
export const roe = (p, mark) => upnl(p, mark) / p.margin;
// mark at which margin + upnl = MAINT * qty * mark
export function liqPrice(p) {
  const d = dir(p.side);
  return (p.entry * p.qty * d - p.margin) / (p.qty * (d - MAINT));
}
export const effLev = (p, mark) => notional(p, mark) / Math.max(1e-9, p.margin + upnl(p, mark));

export function preview(s, { sym, side, size, lev, price }) {
  const cur = s.pos[sym];
  const qty = size / price;
  let p;
  if (!cur || cur.side === side) {
    const q = (cur?.qty || 0) + qty;
    p = { side, qty: q, entry: cur ? (cur.entry * cur.qty + price * qty) / q : price, margin: (cur?.margin || 0) + size / lev };
  } else if (qty < cur.qty) {
    const k = qty / cur.qty;
    p = { side: cur.side, qty: cur.qty - qty, entry: cur.entry, margin: cur.margin * (1 - k) };
  } else if (qty > cur.qty) {
    const rest = qty - cur.qty;
    p = { side, qty: rest, entry: price, margin: (rest * price) / lev };
  } else p = null;
  return {
    qty, fee: size * TAKER, margin: cur && cur.side !== side ? Math.max(0, size - cur.qty * price) / lev : size / lev,
    after: p, liq: p ? liqPrice(p) : null,
  };
}

// ---- fills
function record(s, f) { s.fills.unshift(f); s.fills.length = Math.min(s.fills.length, 300); }

function openTrip(s, sym, side, t) {
  return { id: s.seq++, sym, side, opened: t, maxQty: 0, maxMargin: 0, entryCost: 0, entryQty: 0, exitCost: 0, exitQty: 0, pnl: 0, fees: 0, funding: 0, note: '', tags: [] };
}

function finishTrip(s, p, t, reason) {
  const tr = p.trip;
  tr.closed = t;
  tr.reason = reason;
  tr.entry = tr.entryCost / tr.entryQty;
  tr.exit = tr.exitQty ? tr.exitCost / tr.exitQty : tr.entry;
  tr.lev = Math.round((tr.entry * tr.maxQty) / tr.maxMargin);
  tr.net = tr.pnl - tr.fees - tr.funding;
  s.closed.unshift(tr);
  s.closed.length = Math.min(s.closed.length, 500);
}

// fill an order of `qty` at `price` against the netted position; `margin` funds any opening part
export function fill(s, { sym, side, qty, price, lev, fee, t = Date.now(), why = 'market', reduce = false }) {
  const cur = s.pos[sym];
  const feeAmt = qty * price * fee;
  let rest = qty;
  if (cur && cur.side !== side) {
    const close = Math.min(rest, cur.qty);
    const k = close / cur.qty;
    const pnl = (price - cur.entry) * close * dir(cur.side);
    const freed = cur.margin * k;
    const back = Math.max(0, freed + pnl);
    s.cash += back;
    cur.trip.pnl += pnl;
    cur.trip.exitCost += price * close; cur.trip.exitQty += close;
    cur.qty -= close; cur.margin -= freed;
    rest -= close;
    if (cur.qty <= cur.trip.maxQty * 1e-9 || cur.qty <= 0) {
      cur.trip.fees += feeAmt * (close / qty);
      finishTrip(s, cur, t, why);
      delete s.pos[sym];
    } else cur.trip.fees += feeAmt;
    if (reduce) rest = 0;
  }
  if (rest > 1e-12 && !reduce) {
    const margin = (rest * price) / lev;
    s.cash -= margin;
    let p = s.pos[sym];
    if (!p) p = s.pos[sym] = { side, qty: 0, entry: price, margin: 0, opened: t, lastFunding: t, tp: null, sl: null, trip: openTrip(s, sym, side, t) };
    p.entry = (p.entry * p.qty + price * rest) / (p.qty + rest);
    p.qty += rest; p.margin += margin;
    p.trip.entryCost += price * rest; p.trip.entryQty += rest;
    p.trip.maxQty = Math.max(p.trip.maxQty, p.qty); p.trip.maxMargin = Math.max(p.trip.maxMargin, p.margin);
    if (!cur || cur.side !== side) p.trip.fees += feeAmt * (rest / qty);
    else p.trip.fees += feeAmt;
  }
  s.cash -= feeAmt;
  if (s.pos[sym]) s.pos[sym].liq = liqPrice(s.pos[sym]);
  record(s, { id: s.seq++, t, sym, side, qty, price, fee: feeAmt, why });
}

export function marketOrder(s, { sym, side, size, lev, price, reduce = false, tp = null, sl = null }) {
  const m = bySym(sym);
  if (!m) throw new Error('Unknown market.');
  if (!(price > 0)) throw new Error('No live price yet. Give the feed a second.');
  if (!(lev >= 1 && lev <= m.max)) throw new Error(`${sym} allows 1x to ${m.max}x.`);
  const cur = s.pos[sym];
  if (reduce && (!cur || cur.side === side)) throw new Error('Reduce-only needs an open position on the other side.');
  if (!(size >= MIN_SIZE) && !reduce) throw new Error(`Minimum order is ${MIN_SIZE} aUSD of size.`);
  const qty = reduce ? Math.min(cur.qty, size / price) : size / price;
  const pv = preview(s, { sym, side, size: qty * price, lev, price });
  if (!reduce && pv.margin + pv.fee > s.cash + 1e-9) throw new Error(`Not enough free aUSD: this needs ${fmt(pv.margin + pv.fee)}, you have ${fmt(s.cash)}.`);
  if (pv.after && pv.after.side === side && !reduce) {
    if (side === 'long' ? pv.liq >= price : pv.liq <= price) throw new Error('That size would be liquidated on entry.');
    checkTpSl({ ...pv.after, liq: pv.liq, tp, sl }, price);
  }
  fill(s, { sym, side, qty, price, lev, fee: TAKER, why: reduce ? 'reduce' : 'market', reduce });
  const p = s.pos[sym];
  if (p && p.side === side) {
    if (tp) p.tp = tp;
    if (sl) p.sl = sl;
  }
  return p;
}

function checkTpSl(p, mark) {
  const long = p.side === 'long';
  if (p.tp && (long ? p.tp <= mark : p.tp >= mark)) throw new Error(`Take profit must sit ${long ? 'above' : 'below'} the mark.`);
  if (p.sl && (long ? p.sl >= mark : p.sl <= mark)) throw new Error(`Stop loss must sit ${long ? 'below' : 'above'} the mark.`);
  if (p.sl && (long ? p.sl <= p.liq : p.sl >= p.liq)) throw new Error('Stop loss sits past the liquidation price, so it would never fire.');
}

export function setTpSl(s, sym, tp, sl, mark) {
  const p = s.pos[sym];
  if (!p) return;
  checkTpSl({ ...p, tp, sl }, mark);
  p.tp = tp || null; p.sl = sl || null;
}

export function placeOrder(s, { sym, side, type, price, size, lev, reduce = false }, mark) {
  const m = bySym(sym);
  if (!(price > 0)) throw new Error('Set a price for the order.');
  if (!(lev >= 1 && lev <= m.max)) throw new Error(`${sym} allows 1x to ${m.max}x.`);
  if (!(size >= MIN_SIZE)) throw new Error(`Minimum order is ${MIN_SIZE} aUSD of size.`);
  if (type === 'limit' && mark && (side === 'long' ? price >= mark : price <= mark)) throw new Error(`A ${side} limit rests ${side === 'long' ? 'below' : 'above'} the market. Use a market order to fill now.`);
  if (type === 'stop' && mark && (side === 'long' ? price <= mark : price >= mark)) throw new Error(`A ${side} stop triggers ${side === 'long' ? 'above' : 'below'} the market.`);
  const hold = reduce ? 0 : size / lev + size * (type === 'limit' ? MAKER : TAKER);
  if (hold > s.cash + 1e-9) throw new Error(`Not enough free aUSD: this order holds ${fmt(hold)}, you have ${fmt(s.cash)}.`);
  s.cash -= hold;
  const o = { id: s.seq++, sym, side, type, price, size, lev, reduce, hold, created: Date.now() };
  s.orders.push(o);
  return o;
}

export function cancelOrder(s, id) {
  const i = s.orders.findIndex(o => o.id === id);
  if (i < 0) return;
  s.cash += s.orders[i].hold;
  s.orders.splice(i, 1);
}

export function closePart(s, sym, share, price, why = 'close') {
  const p = s.pos[sym];
  if (!p || !(price > 0)) return;
  fill(s, { sym, side: opp(p.side), qty: share >= 1 ? p.qty : p.qty * share, price, lev: 1, fee: TAKER, why, reduce: true });
}

export function addMargin(s, sym, amount) {
  const p = s.pos[sym];
  if (!p) return;
  if (amount > 0 && amount > s.cash) throw new Error(`You have ${fmt(s.cash)} free.`);
  if (amount < 0 && p.margin + amount < (p.qty * p.entry) / bySym(sym).max) throw new Error('That would push leverage past the market maximum.');
  p.margin += amount; s.cash -= amount;
  p.trip.maxMargin = Math.max(p.trip.maxMargin, p.margin);
  p.liq = liqPrice(p);
}

function liquidate(s, sym, t) {
  const p = s.pos[sym];
  p.trip.pnl += -p.margin;
  p.trip.exitCost += p.liq * p.qty; p.trip.exitQty += p.qty;
  record(s, { id: s.seq++, t, sym, side: opp(p.side), qty: p.qty, price: p.liq, fee: 0, why: 'liquidation' });
  finishTrip(s, p, t, 'liquidation');
  delete s.pos[sym];
}

// one price step for a market: mark drives liquidations, stops and targets; last price drives resting limits.
// lo/hi let a whole candle be checked at once (offline catch-up); live ticks pass lo = hi = price.
export function step(s, sym, { markLo, markHi, lastLo, lastHi, t = Date.now() }) {
  const fired = [];
  for (const o of [...s.orders]) {
    if (o.sym !== sym) continue;
    const hit = o.type === 'limit'
      ? (o.side === 'long' ? lastLo <= o.price : lastHi >= o.price)
      : (o.side === 'long' ? markHi >= o.price : markLo <= o.price);
    if (!hit) continue;
    s.cash += o.hold;
    s.orders.splice(s.orders.indexOf(o), 1);
    const cur = s.pos[sym];
    if (o.reduce && (!cur || cur.side === o.side)) { fired.push({ kind: 'cancelled', o }); continue; }
    const qty = o.reduce ? Math.min(cur.qty, o.size / o.price) : o.size / o.price;
    const need = o.reduce ? 0 : preview(s, { sym, side: o.side, size: qty * o.price, lev: o.lev, price: o.price }).margin + qty * o.price * TAKER;
    if (need > s.cash + 1e-9) { fired.push({ kind: 'rejected', o }); continue; }
    fill(s, { sym, side: o.side, qty, price: o.price, lev: o.lev, fee: o.type === 'limit' ? MAKER : TAKER, t, why: o.type, reduce: o.reduce });
    fired.push({ kind: 'filled', o });
  }
  const p = s.pos[sym];
  if (p) {
    const long = p.side === 'long';
    if (long ? markLo <= p.liq : markHi >= p.liq) { liquidate(s, sym, t); fired.push({ kind: 'liquidated', sym, side: p.side }); }
    else if (p.sl && (long ? markLo <= p.sl : markHi >= p.sl)) { const side = p.side; closePart(s, sym, 1, p.sl, 'stop loss'); fired.push({ kind: 'stop loss', sym, side }); }
    else if (p.tp && (long ? markHi >= p.tp : markLo <= p.tp)) { const side = p.side; closePart(s, sym, 1, p.tp, 'take profit'); fired.push({ kind: 'take profit', sym, side }); }
  }
  return fired;
}

// funding settlement at a funding timestamp: longs pay shorts when the rate is positive
export function settleFunding(s, sym, rate, mark, t) {
  const p = s.pos[sym];
  if (!p || t <= p.lastFunding) return 0;
  const pay = p.qty * mark * rate * dir(p.side);
  p.margin -= pay;
  p.trip.funding += pay;
  p.lastFunding = t;
  p.liq = liqPrice(p);
  return pay;
}

export function equity(s, marks) {
  let locked = 0, up = 0, held = 0;
  for (const [sym, p] of Object.entries(s.pos)) { locked += p.margin; if (marks[sym] > 0) up += upnl(p, marks[sym]); }
  for (const o of s.orders) held += o.hold;
  return { free: s.cash, locked, held, upnl: up, total: s.cash + locked + held + up };
}

export function sample(s, marks) {
  const v = equity(s, marks).total, now = Date.now(), last = s.curve[s.curve.length - 1];
  if (last && now - last[0] < 60e3) return;
  s.curve.push([now, +v.toFixed(2)]);
  if (s.curve.length > 4000) s.curve.splice(0, s.curve.length - 4000);
}

export function newRun(s, marks) {
  const q = equity(s, marks);
  const runs = [...(s.runs || []), { run: s.run, started: s.started, ended: Date.now(), final: q.total, trades: s.closed.length }];
  const n = fresh(s.run + 1);
  n.runs = runs;
  return n;
}

// ---- stats for the journal
export function stats(trips) {
  const wins = trips.filter(t => t.net > 0), losses = trips.filter(t => t.net <= 0);
  const sum = a => a.reduce((x, t) => x + t.net, 0);
  const gw = sum(wins), gl = -sum(losses);
  return {
    n: trips.length, wins: wins.length, winRate: trips.length ? wins.length / trips.length : 0,
    net: sum(trips), avgWin: wins.length ? gw / wins.length : 0, avgLoss: losses.length ? -gl / losses.length : 0,
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    best: trips.reduce((b, t) => (!b || t.net > b.net ? t : b), null), worst: trips.reduce((b, t) => (!b || t.net < b.net ? t : b), null),
    fees: trips.reduce((x, t) => x + t.fees, 0), funding: trips.reduce((x, t) => x + t.funding, 0),
    liqs: trips.filter(t => t.reason === 'liquidation').length,
    hold: trips.length ? trips.reduce((x, t) => x + (t.closed - t.opened), 0) / trips.length : 0,
  };
}

// ---- formatting
export function fmt(n, d = 2) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const fmtPrice = n => fmt(n, dp(n));
// an amount where zero means "nothing": shows the word instead of 0.00
export const amt = (n, word = 'none', d = 2) => (Math.abs(n) < 0.5 * 10 ** -d ? word : fmt(n, d));
export const signedOr = (n, word = 'flat', d = 2) => (Math.abs(n) < 0.5 * 10 ** -d ? word : signed(n, d));
// a funding rate (fraction per period) as a percentage with two significant figures, never a bare 0.000%
export function rate(r) {
  if (!r) return 'flat';
  const v = Math.abs(r * 100);
  const txt = v < 0.00001 ? '<0.00001' : v >= 0.01 ? v.toFixed(4) : v.toPrecision(2);
  return (r > 0 ? '+' : '−') + txt + '%';
}
export const signed = (n, d = 2) => { const r = +Math.abs(n).toFixed(d); return (r === 0 ? '' : n > 0 ? '+' : '−') + fmt(r, d); };
export function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}
export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
}

// ---- storage, shared across tabs
export const STORAGE_KEY = 'aven.v2';
export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && s.v === 2) return s;
  } catch {}
  return fresh();
}
export function save(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}
