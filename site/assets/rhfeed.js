// Robinhood Chain stock tokens, priced from their pools on-chain. Every few seconds one batched eth_call reads
// slot0 and the active liquidity of each pool (v3 pools directly, v4 pools through the PoolManager's extsload) plus the
// WETH/USDG pool, and turns sqrtPriceX96 into a dollar price: WETH-quoted pools through ETH/USDG, SPY-quoted pools
// through the SPY token's own price. Fills are quoted with Uniswap v3/v4 swap maths on the pool's active liquidity.
// 24h change and volume come from DexScreener; the underlying stock's last trade and session from Shuntdesk's
// Yahoo Finance read.

import { RPC, POOL_MANAGER, WETH, USDG, ETH_USDG, RH_STOCKS } from './rhpools.js';

export const STOCK_SYMS = RH_STOCKS.map(s => s.sym);
export const pools = {};   // sym -> { sqrt, L, quoteUsd, price, at }
export const day = {};     // sym -> { change, vol, liqUsd }
export const wallSt = {};  // sym -> { last, close, session, at }
export let block = 0;
export let ethUsd = 0;
const MAX_IMPACT = 0.015;   // an order that would move the pool further than this crosses out of the active range

const pad = h => h.replace(/^0x/, '').padStart(64, '0');
const plus3 = h => '0x' + (BigInt(h) + 3n).toString(16).padStart(64, '0');
const sqrtOf = word => Number(BigInt('0x' + word.slice(2, 66)) & ((1n << 160n) - 1n)) / 2 ** 96;
const liqOf = word => Number(BigInt(word) & ((1n << 128n) - 1n));

const CALLS = [{ to: ETH_USDG.pool, data: '0x3850c7bd' }];
for (const p of RH_STOCKS) {
  if (p.v4) CALLS.push({ to: POOL_MANAGER, data: '0x1e2eaeaf' + pad(p.slot) }, { to: POOL_MANAGER, data: '0x1e2eaeaf' + pad(plus3(p.slot)) });
  else CALLS.push({ to: p.pool, data: '0x3850c7bd' }, { to: p.pool, data: '0x1a686502' });
}

async function rpcBatch() {
  const body = [{ jsonrpc: '2.0', id: 0, method: 'eth_blockNumber', params: [] }, ...CALLS.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'eth_call', params: [c, 'latest'] }))];
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const out = []; for (const x of r) out[x.id] = x.result;
  return out;
}

// quote per stock, human units, from a pool's sqrt price
function quotePerStock(p, sqrt) {
  const raw = sqrt * sqrt;
  const d0 = p.stock0 ? p.dStock : p.dQuote, d1 = p.stock0 ? p.dQuote : p.dStock;
  const oneP0 = raw * 10 ** (d0 - d1);
  return p.stock0 ? oneP0 : 1 / oneP0;
}

// LP fee in hundredths of a basis point: v3 pools answer fee(), v4 pools carry lpFee in slot0's top bits
const fees = {};
async function loadFees() {
  const v3 = RH_STOCKS.filter(p => !p.v4);
  const body = v3.map((p, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: [{ to: p.pool, data: '0xddca3f43' }, 'latest'] }));
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  for (const x of r) fees[v3[x.id].sym] = parseInt(x.result, 16) / 1e6;
}
let feesLoaded = null;

export async function poll() {
  feesLoaded ||= loadFees().catch(() => { feesLoaded = null; });
  const r = await rpcBatch();
  block = parseInt(r[0], 16);
  const se = sqrtOf(r[1]);
  const raw = se * se;
  ethUsd = ETH_USDG.weth0 ? raw * 10 ** (ETH_USDG.dWeth - ETH_USDG.dUsdg) : 1 / (raw * 10 ** (ETH_USDG.dUsdg - ETH_USDG.dWeth));
  const usd = { [WETH]: ethUsd, [USDG]: 1 };
  const order = RH_STOCKS.map((p, i) => [p, i]).sort((a, b) => (a[0].quote === WETH || a[0].quote === USDG ? -1 : 0) - (b[0].quote === WETH || b[0].quote === USDG ? -1 : 0));
  for (const [p, i] of order) {
    const s0 = r[2 + i * 2], li = r[3 + i * 2];
    if (!s0 || s0 === '0x') continue;
    const sqrt = sqrtOf(s0), L = liqOf(li);
    if (p.v4) fees[p.sym] = Number((BigInt(s0) >> 208n) & 0xffffffn) / 1e6;
    const qUsd = usd[p.quote];
    if (!qUsd || !sqrt) continue;
    const price = quotePerStock(p, sqrt) * qUsd;
    usd[p.addr] = price;
    pools[p.sym] = { sqrt, L, quoteUsd: qUsd, price, at: Date.now(), fee: fees[p.sym] ?? 0 };
  }
  return pools;
}

// what a swap of `usd` dollars would fill at on the pool's active liquidity. side: 'buy' | 'sell' the stock.
export function quote(sym, side, usdSize) {
  const p = RH_STOCKS.find(s => s.sym === sym), st = pools[sym];
  if (!p || !st) throw new Error('Waiting for the pool price.');
  const { sqrt: s, L, quoteUsd } = st;
  const keep = 1 - (st.fee || 0);   // the pool takes its LP fee out of the amount coming in
  const qd = 10 ** p.dQuote, sd = 10 ** p.dStock;
  let quoteRaw, stockRaw;
  if (side === 'buy') {
    quoteRaw = (usdSize / quoteUsd) * qd;                       // paid in
    const net = quoteRaw * keep;
    if (p.stock0) { const s2 = s + net / L; stockRaw = L * (1 / s - 1 / s2); }
    else { const inv = 1 / s + net / L; stockRaw = L * (s - 1 / inv); }
  } else {
    stockRaw = (usdSize / st.price) * sd;                       // sold in
    const net = stockRaw * keep;
    if (p.stock0) { const inv = 1 / s + net / L; quoteRaw = L * (s - 1 / inv); }
    else { const s2 = s + net / L; quoteRaw = L * (1 / s - 1 / s2); }
  }
  const fill = ((quoteRaw / qd) / (stockRaw / sd)) * quoteUsd;
  const impact = Math.abs(fill - st.price) / st.price;
  return { fill, impact, fee: st.fee || 0, mid: st.price, tooBig: !(impact <= MAX_IMPACT) || !(stockRaw > 0) };
}
export { MAX_IMPACT };

export async function loadDay() {
  const rows = await fetch('https://api.dexscreener.com/tokens/v1/robinhood/' + RH_STOCKS.map(s => s.addr).join(',')).then(r => r.json());
  for (const s of RH_STOCKS) {
    const list = rows.filter(x => x.baseToken.address.toLowerCase() === s.addr);
    if (!list.length) continue;
    const main = list.find(x => x.pairAddress.toLowerCase() === s.pool) || list[0];
    day[s.sym] = { change: main.priceChange?.h24 ?? 0, vol: list.reduce((a, x) => a + (x.volume?.h24 || 0), 0), liqUsd: main.liquidity?.usd || 0 };
  }
}

export async function loadWallSt() {
  const j = await fetch('https://shuntdesk.com/api/v1/stocks').then(r => r.json());
  for (const [sym, v] of Object.entries(j.rows || {})) wallSt[sym] = { ...v, at: j.read };
}

// candles from GeckoTerminal's index of the same pool
const TF = { '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4], '1d': ['day', 1] };
// GeckoTerminal's free tier allows about 30 calls a minute per visitor, so recent answers are kept for 30 s
const cache = new Map();
export async function candles(sym, interval = '15m', limit = 500, before = null) {
  const key = `${sym}|${interval}|${limit}|${before ? Math.floor(before / 60e3) : ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30e3) return hit.rows;
  const rows = await fetchCandles(sym, interval, limit, before);
  cache.set(key, { at: Date.now(), rows });
  return rows;
}
async function fetchCandles(sym, interval, limit, before) {
  const p = RH_STOCKS.find(s => s.sym === sym);
  const [tf, agg] = TF[interval];
  const u = `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${p.pool}/ohlcv/${tf}?aggregate=${agg}&limit=${Math.min(1000, limit)}&currency=usd&token=${p.addr}${before ? `&before_timestamp=${Math.floor(before / 1000)}` : ''}`;
  const j = await fetch(u, { headers: { accept: 'application/json' } }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const seen = new Set();
  return (j.data?.attributes?.ohlcv_list || []).map(k => ({ time: k[0], open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5] }))
    .sort((a, b) => a.time - b.time).filter(b => !seen.has(b.time) && seen.add(b.time));
}
