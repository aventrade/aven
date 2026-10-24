// The paper engine against hand-made numbers: fills, netting, liquidation, funding, orders, stops, runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../site/assets/engine.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('a market long takes margin and the taker fee from free balance', () => {
  const s = E.fresh();
  E.marketOrder(s, { sym: 'BTC', side: 'long', size: 20000, lev: 20, price: 100000 });
  const p = s.pos.BTC;
  near(p.qty, 0.2);
  near(p.margin, 1000);
  near(s.cash, E.START - 1000 - 20000 * E.TAKER);
});

test('liquidation price: margin plus PnL equals maintenance at the mark', () => {
  const s = E.fresh();
  E.marketOrder(s, { sym: 'BTC', side: 'long', size: 20000, lev: 20, price: 100000 });
  const p = s.pos.BTC;
  near(p.margin + E.upnl(p, p.liq), E.MAINT * p.qty * p.liq);
  E.marketOrder(s, { sym: 'ETH', side: 'short', size: 5000, lev: 10, price: 2000 });
  const q = s.pos.ETH;
  near(q.margin + E.upnl(q, q.liq), E.MAINT * q.qty * q.liq);
  assert.ok(q.liq > 2000);
});

test('adding to a position averages the entry; an opposite order reduces, closes, then flips', () => {
  const s = E.fresh();
  E.marketOrder(s, { sym: 'ETH', side: 'long', size: 1000, lev: 10, price: 2000 });
  E.marketOrder(s, { sym: 'ETH', side: 'long', size: 1000, lev: 10, price: 2200 });
  const p = s.pos.ETH;
  near(p.entry, (1000 + 1000) / (0.5 + 1000 / 2200));   // size-weighted: total notional over total quantity
  const qty = p.qty;
  E.marketOrder(s, { sym: 'ETH', side: 'short', size: qty * 2100 * 3, lev: 5, price: 2100 });
  assert.equal(s.pos.ETH.side, 'short');
  near(s.pos.ETH.qty, qty * 2);
  assert.equal(s.closed[0].side, 'long');
});

test('a candle through the liquidation price liquidates and loses the margin', () => {
  const s = E.fresh();
  E.marketOrder(s, { sym: 'BTC', side: 'long', size: 20000, lev: 20, price: 100000 });
  const liq = s.pos.BTC.liq, cash = s.cash;
  const fired = E.step(s, 'BTC', { markLo: liq - 1, markHi: 100100, lastLo: liq - 1, lastHi: 100100 });
  assert.equal(fired[0].kind, 'liquidated');
  assert.ok(!s.pos.BTC);
  near(s.cash, cash);
  assert.equal(s.closed[0].reason, 'liquidation');
  near(s.closed[0].pnl, -1000);
});

test('funding: positive rate, the long pays out of its margin and the liquidation moves closer', () => {
  const s = E.fresh();
  E.marketOrder(s, { sym: 'BTC', side: 'long', size: 20000, lev: 20, price: 100000 });
  const before = s.pos.BTC.liq;
  const pay = E.settleFunding(s, 'BTC', 0.0001, 100000, Date.now() + 1);
  near(pay, 2);
  near(s.pos.BTC.margin, 998);
  assert.ok(s.pos.BTC.liq > before);
  assert.equal(E.settleFunding(s, 'BTC', 0.0001, 100000, s.pos.BTC.lastFunding), 0, 'the same timestamp never pays twice');
});

test('a resting limit fills only when trades reach it, at its own price, with the maker fee', () => {
  const s = E.fresh();
  E.placeOrder(s, { sym: 'ETH', side: 'long', type: 'limit', price: 2000, size: 1000, lev: 10 }, 2100);
  assert.equal(E.step(s, 'ETH', { markLo: 2050, markHi: 2060, lastLo: 2050, lastHi: 2060 }).length, 0);
  E.step(s, 'ETH', { markLo: 1990, markHi: 2010, lastLo: 1999, lastHi: 2010 });
  assert.equal(s.pos.ETH.entry, 2000);
  near(s.fills[0].fee, 1000 * E.MAKER);
  assert.throws(() => E.placeOrder(s, { sym: 'ETH', side: 'long', type: 'limit', price: 2200, size: 100, lev: 2 }, 2100), /below the market/);
});

test('stops and targets trigger on the mark; a stop past liquidation is refused', () => {
  const s = E.fresh();
  E.marketOrder(s, { sym: 'SOL', side: 'short', size: 1000, lev: 5, price: 100 });
  E.setTpSl(s, 'SOL', 90, 105, 100);
  assert.equal(E.step(s, 'SOL', { markLo: 99, markHi: 106, lastLo: 99, lastHi: 106 })[0].kind, 'stop loss');
  E.marketOrder(s, { sym: 'SOL', side: 'long', size: 1000, lev: 5, price: 100 });
  assert.throws(() => E.setTpSl(s, 'SOL', null, 50, 100), /past the liquidation/);
});

test('equity adds up: free + margin + held by orders + unrealised', () => {
  const s = E.fresh();
  E.marketOrder(s, { sym: 'BTC', side: 'long', size: 10000, lev: 10, price: 100000 });
  E.placeOrder(s, { sym: 'ETH', side: 'short', type: 'limit', price: 2500, size: 1000, lev: 10 }, 2000);
  const q = E.equity(s, { BTC: 101000 });
  near(q.total, q.free + q.locked + q.held + q.upnl);
  near(q.upnl, 100);
});

test('a new run archives the old one and starts at 50,000', () => {
  let s = E.fresh();
  E.marketOrder(s, { sym: 'BTC', side: 'long', size: 10000, lev: 10, price: 100000 });
  s = E.newRun(s, { BTC: 100000 });
  assert.equal(s.run, 2);
  assert.equal(s.cash, E.START);
  assert.equal(s.runs.length, 1);
});

test('leverage caps follow the market', () => {
  const s = E.fresh();
  assert.throws(() => E.marketOrder(s, { sym: 'NVDA', side: 'long', size: 1000, lev: 6, price: 200 }), /1x to 5x/);
});

test('formatting never prints a bare zero where a word belongs', () => {
  assert.equal(E.amt(0), 'none');
  assert.equal(E.signedOr(0.001), 'flat');
  assert.equal(E.rate(0), 'flat');
  assert.equal(E.rate(0.0000125), '+0.0013%');
  assert.equal(E.rate(-0.0000003996), '−0.000040%');
  assert.equal(E.fmt(NaN), '');
});
