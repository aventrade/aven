// Robinhood Chain stock fills: the in-range Uniswap swap maths behind rhfeed.quote(), checked against the
// constant-liquidity invariants rather than against itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pools, quote, MAX_IMPACT } from '../site/assets/rhfeed.js';
import { RH_STOCKS } from '../site/assets/rhpools.js';

// a pool state that prices NVDA (token0 or token1, whichever the table says) at $200 with a 0.05% LP fee
function seed(sym, price, L) {
  const p = RH_STOCKS.find(s => s.sym === sym);
  const quoteUsd = 1;
  const humanQuotePerStock = price / quoteUsd;
  const d0 = p.stock0 ? p.dStock : p.dQuote, d1 = p.stock0 ? p.dQuote : p.dStock;
  const oneP0 = p.stock0 ? humanQuotePerStock : 1 / humanQuotePerStock;  // token1 per token0, human
  const raw = oneP0 / 10 ** (d0 - d1);
  pools[sym] = { sqrt: Math.sqrt(raw), L, quoteUsd, price, fee: 0.0005, at: Date.now() };
}

test('a buy fills above the pool price and a sell below it', () => {
  seed('NVDA', 200, 1e22);
  const b = quote('NVDA', 'buy', 5000), s = quote('NVDA', 'sell', 5000);
  assert.ok(b.fill > 200 && s.fill < 200);
  assert.ok(b.impact > 0.0005 * 0.99, 'the LP fee alone is already in the impact');
});

test('impact grows with size and shrinks with liquidity', () => {
  seed('NVDA', 200, 1e22);
  const small = quote('NVDA', 'buy', 1000).impact, big = quote('NVDA', 'buy', 20000).impact;
  assert.ok(big > small);
  seed('NVDA', 200, 4e22);
  assert.ok(quote('NVDA', 'buy', 20000).impact < big);
});

test('orders past the active-range guard are flagged', () => {
  seed('COIN', 160, 1e16);
  const q = quote('COIN', 'buy', 50000);
  assert.ok(q.impact > MAX_IMPACT);
  assert.equal(q.tooBig, true);
});

test('both token orderings in the table are handled', () => {
  for (const p of RH_STOCKS) {
    seed(p.sym, 300, 1e22);
    const b = quote(p.sym, 'buy', 1000);
    assert.ok(Math.abs(b.mid - 300) < 1e-6 && b.fill > 300, `${p.sym} buy`);
  }
});
