# Robinhood Chain stocks: on-chain pricing

The thirteen stock markets are not priced from a feed. Every three seconds Aven reads each token's pool on
Robinhood Chain and works out the dollar price and the fill a swap of your size would get. This page is how.

## The tokens

`site/assets/rhpools.js` lists the official tokens by address: NVDA, TSLA, AAPL, META, GOOGL, AMZN, MSFT, AMD, COIN,
PLTR, MSTR, SPY, QQQ. Look-alike contracts with vanity addresses that copy the first and last characters exist, so
the list is fixed rather than searched. Each token is priced from its deepest pool at the time the table was built
by `dev/rhprobe.mjs`.

| Pool kind | Tokens | Read with |
|---|---|---|
| Uniswap v3 | NVDA, AAPL, GOOGL, SPY | `slot0()` → `sqrtPriceX96`, `liquidity()` |
| SushiSwap v3 | COIN | same interface |
| Uniswap v4 | TSLA, META, AMZN, MSFT, AMD, PLTR, MSTR, QQQ | the PoolManager's `extsload()` |

The Uniswap v4 PoolManager on Robinhood Chain is `0x8366a39cc670b4001a1121b8f6a443a643e40951`. A v4 pool's state
lives at `keccak256(abi.encode(poolId, 6))`: the first word packs `sqrtPriceX96` (low 160 bits), the tick, the
protocol fee and the LP fee (bits 208 to 231); the pool's active liquidity is three slots further on. The slots are
computed once, offline, and stored in the table, so the browser needs no keccak.

## From sqrtPriceX96 to dollars

```
s     = sqrtPriceX96 / 2^96                        // √(token1 per token0), in raw units
p01   = s² · 10^(decimals0 − decimals1)            // token1 per token0, in whole tokens
quote per stock = p01 if the stock is token0, else 1 / p01
```

Quote tokens are turned into dollars in one batched `eth_call` per tick:

- **USDG** is taken at $1;
- **WETH** through the WETH/USDG pool (`0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca`);
- **SPY** (seven v4 pools are quoted in the SPY token) through the SPY/WETH pool read in the same batch.

On the day this was built the on-chain price matched DexScreener and GeckoTerminal within 0.1%; DexScreener's own
figure lagged the chain by about a minute, which is why Aven reads the chain itself.

## Quoting a fill

A market order is quoted with the constant-liquidity swap maths of Uniswap v3/v4 on the pool's active liquidity
`L`, after taking the pool's LP fee out of the amount coming in. For a pool where the stock is token0:

```
buy  (pay token1 Δy):   s' = s + Δy·(1−fee)/L         stock out = L · (1/s − 1/s')
sell (pay token0 Δx):   1/s' = 1/s + Δx·(1−fee)/L     quote out = L · (s − s')
fill = quote amount / stock amount, in dollars
```

and the mirror image when the stock is token1. The result is the price the swap would get inside the current active
range. Ticks are not crossed, so an order big enough to leave the range is refused: Aven allows at most **1.5%**
of combined price impact and fee on one order. On a thin pool that refusal comes early (a 45,000 aUSD COIN order
would move its pool about 11%).

`test/pool-quote.test.mjs` checks the invariants: a buy fills above and a sell below the pool price, impact grows with
size and shrinks with liquidity, the guard trips, and both token orderings are handled.

## Everything else about a stock market

- **Leverage** up to 5x. **Funding**: none, these are spot tokens.
- **Candles** for the chart, Rewind-free history and the away replay come from GeckoTerminal's index of the same pool.
  Its free tier allows about 30 requests a minute per visitor; answers are cached 30 seconds, and a replay that
  can't be fetched is retried rather than skipped.
- **Wall St** in the bar is the underlying stock's last trade and session (Yahoo Finance, via
  `shuntdesk.com/api/v1/stocks`). The tokens trade on-chain around the clock, so they can drift from it while the US
  market is closed.
- **24h change, volume and pool liquidity** come from DexScreener.

## Rebuilding the table

Pools change: liquidity moves, new pools appear. Rebuild with:

```bash
node dev/rhprobe.mjs     # needs js-sha3 for the v4 slot hashes; prints on-chain vs DexScreener vs GeckoTerminal
```
