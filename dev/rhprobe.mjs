// node dev/rhprobe.mjs : builds the Robinhood Chain stock pool table (site/assets/rhpools.js) and checks that the
// price read from each pool's on-chain state matches DexScreener / GeckoTerminal.
// Needs js-sha3 for the v4 slot hashes, only here, never in the site: npm i --no-save js-sha3
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let keccak256;
try { ({ keccak256 } = require('js-sha3')); } catch { console.error('js-sha3 is missing: npm i --no-save js-sha3'); process.exit(1); }
const OUT = new URL('../site/assets/rhpools.js', import.meta.url);

const RPC = 'https://robinhood-rpc.publicnode.com';
const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const ETH_USDG = '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca';
const STOCKS = [
  ['NVDA', 'NVIDIA', '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec'], ['TSLA', 'Tesla', '0x322f0929c4625ed5bad873c95208d54e1c003b2d'],
  ['AAPL', 'Apple', '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9'], ['META', 'Meta', '0xc0d6457c16cc70d6790dd43521c899c87ce02f35'],
  ['GOOGL', 'Alphabet', '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3'], ['AMZN', 'Amazon', '0x12f190a9f9d7d37a250758b26824b97ce941bf54'],
  ['MSFT', 'Microsoft', '0xe93237c50d904957cf27e7b1133b510c669c2e74'], ['AMD', 'AMD', '0x86923f96303d656e4aa86d9d42d1e57ad2023fdc'],
  ['COIN', 'Coinbase', '0x6330d8c3178a418788df01a47479c0ce7ccf450b'], ['PLTR', 'Palantir', '0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a'],
  ['MSTR', 'Strategy', '0xec262a75e413fafd0df80480274532c79d42da09'], ['SPY', 'S&P 500 ETF', '0x117cc2133c37b721f49de2a7a74833232b3b4c0c'],
  ['QQQ', 'Nasdaq 100 ETF', '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68'],
];
const rpc = calls => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: [c, 'latest'] }))) })
  .then(r => r.json()).then(r => r.sort((a, b) => a.id - b.id).map(x => x.result));
const pad = h => h.replace(/^0x/, '').padStart(64, '0');

const ds = await fetch('https://api.dexscreener.com/tokens/v1/robinhood/' + STOCKS.map(s => s[2]).join(',')).then(r => r.json());
const tokens = new Set([WETH]);
const pools = [];
for (const [sym, name, addr] of STOCKS) {
  const p = ds.find(x => x.baseToken.address.toLowerCase() === addr);
  const quote = p.quoteToken.address.toLowerCase();
  const v4 = (p.labels || []).includes('v4');
  const [c0, c1] = [addr, quote].sort();
  tokens.add(addr); tokens.add(quote);
  const pool = { sym, name, addr, quote, quoteSym: p.quoteToken.symbol, v4, pool: p.pairAddress.toLowerCase(), dex: p.dexId, stock0: c0 === addr, liqUsd: p.liquidity.usd, ds: +p.priceUsd };
  if (v4) pool.slot = '0x' + keccak256(Buffer.from(pad(pool.pool) + pad('6'), 'hex'));
  pools.push(pool);
}
// decimals of every token involved
const tl = [...tokens];
const dec = Object.fromEntries((await rpc(tl.map(t => ({ to: t, data: '0x313ce567' })))).map((r, i) => [tl[i], parseInt(r, 16)]));
console.log('decimals', JSON.stringify(dec));

// read: v3 slot0 (0x3850c7bd) + liquidity (0x1a686502); v4 extsload(slot) and extsload(slot+3)
const plus = (h, n) => '0x' + (BigInt(h) + BigInt(n)).toString(16).padStart(64, '0');
const calls = [{ to: ETH_USDG, data: '0x3850c7bd' }];
for (const p of pools) {
  if (p.v4) calls.push({ to: POOL_MANAGER, data: '0x1e2eaeaf' + pad(p.slot) }, { to: POOL_MANAGER, data: '0x1e2eaeaf' + pad(plus(p.slot, 3)) });
  else calls.push({ to: p.pool, data: '0x3850c7bd' }, { to: p.pool, data: '0x1a686502' });
}
const res = await rpc(calls);
const sqrtOf = word => Number(BigInt('0x' + word.slice(2, 66)) & ((1n << 160n) - 1n)) / 2 ** 96;
// WETH/USDG: which side is WETH
const usdg = '0x' + 'x';
const ethPool = { stock0: WETH < '0x', };
const sE = sqrtOf(res[0]);
// token0 of ETH_USDG
const [t0] = await rpc([{ to: ETH_USDG, data: '0x0dfe1681' }]);
const ethIs0 = ('0x' + t0.slice(26)).toLowerCase() === WETH;
const usdgAddr = pools.find(p => p.quoteSym === 'USDG')?.quote;
const raw = sE * sE; // token1 per token0, raw units
const ethUsd = ethIs0 ? raw * 10 ** (18 - dec[usdgAddr]) : 1 / (raw * 10 ** (dec[usdgAddr] - 18));
console.log('ETH/USD from pool', ethUsd.toFixed(2));
const usd = { [WETH]: ethUsd, [usdgAddr]: 1 };
const priceIn = (p, s) => {
  const r = s * s, d0 = p.stock0 ? dec[p.addr] : dec[p.quote], d1 = p.stock0 ? dec[p.quote] : dec[p.addr];
  const p1per0 = r * 10 ** (d0 - d1);                 // token1 per token0, human units
  return p.stock0 ? p1per0 : 1 / p1per0;              // quote per stock
};
// SPY first, other pools may be quoted in SPY
const order = [...pools].sort((a, b) => (a.sym === 'SPY' ? -1 : b.sym === 'SPY' ? 1 : 0));
for (const p of order) {
  const i = 1 + pools.indexOf(p) * 2;
  const s = sqrtOf(res[i]);
  const q = priceIn(p, s);
  const qUsd = usd[p.quote];
  p.onchain = q * qUsd;
  usd[p.addr] = p.onchain;
  p.liquidity = Number(BigInt(res[i + 1]) & ((1n << 128n) - 1n));
}
const gk = await fetch('https://api.geckoterminal.com/api/v2/simple/networks/robinhood/token_price/' + STOCKS.map(s => s[2]).join(','), { headers: { accept: 'application/json' } }).then(r => r.json()).catch(() => ({}));
const gp = gk?.data?.attributes?.token_prices || {};
for (const p of pools) console.log(p.sym.padEnd(6), (p.v4 ? 'v4' : 'v3'), p.dex.padEnd(9), 'vs', p.quoteSym.padEnd(5), 'onchain', p.onchain.toFixed(3).padStart(9), 'dexscr', String(p.ds).padStart(8), 'gecko', (+gp[p.addr] || 0).toFixed(3).padStart(9), 'L', p.liquidity.toExponential(2));

const table = pools.map(p => ({ sym: p.sym, name: p.name, addr: p.addr, quote: p.quote, v4: p.v4, pool: p.pool, slot: p.slot || null, stock0: p.stock0, dStock: dec[p.addr], dQuote: dec[p.quote] }));
writeFileSync(OUT, `// Robinhood Chain stock tokens and the pool each one is priced from (the deepest pool for that token when this table
// was built by dev/rhprobe.mjs). v3 pools are read through slot0() and liquidity(); v4 pools live in the PoolManager
// and are read with extsload() at keccak256(poolId, 6) (slot0) and that slot + 3 (liquidity). Addresses are the
// official tokens; look-alike contracts with vanity addresses exist, so the list is fixed.
export const RPC = 'https://robinhood-rpc.publicnode.com';
export const POOL_MANAGER = '${POOL_MANAGER}';
export const WETH = '${WETH}';
export const USDG = '${usdgAddr}';
export const ETH_USDG = { pool: '${ETH_USDG}', weth0: ${ethIs0}, dWeth: 18, dUsdg: ${dec[usdgAddr]} };
export const RH_STOCKS = ${JSON.stringify(table, null, 2).replace(/"(\w+)":/g, '$1:')};
`);
console.log('wrote site/assets/rhpools.js');
