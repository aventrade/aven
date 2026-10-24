# Data sources

Every number on Aven is read from one of these. None needs a key; all are called from the visitor's browser.

| Source | Used for | Cadence | Limits and fallbacks |
|---|---|---|---|
| Hyperliquid websocket `wss://api.hyperliquid.xyz/ws` | mark, oracle, mid, funding rate, open interest, 24h stats (`activeAssetCtx`, all markets); trades (whale tape, limit fills); `l2Book`; candles for the market on screen | push, about 1/s per market | reconnects with backoff; REST snapshot every 4 s while it's down |
| Hyperliquid info API `api.hyperliquid.xyz/info` | `metaAndAssetCtxs` (main and `xyz` dexes), `candleSnapshot`, `fundingHistory`, `predictedFundings`, `clearinghouseState`, `userFills` | on load and on demand | about 17 days of 5-minute candles, about 3.5 days of 1-minute |
| Robinhood Chain RPC `robinhood-rpc.publicnode.com` | pool `slot0` / `liquidity`, v4 `extsload`, LP fees, latest block | every 3 s, one batch | no historical logs on the public endpoint |
| GeckoTerminal `api.geckoterminal.com` | stock pool candles (chart, away replay, volatility, stress test) | on demand | about 30 calls a minute per visitor; cached 30 s; failed replays retried |
| DexScreener `api.dexscreener.com` | stock tokens' 24h change, volume, pool liquidity | every minute | |
| Shuntdesk `shuntdesk.com/api/v1/stocks` | underlying stocks' last trade and market session (Yahoo Finance) | every 2 minutes | |
| Hyperliquid leaderboard | the dated top-20 list in Mirror | snapshot, rebuilt by hand | the full file is about 38 MB, too big for a browser |

## Why Hyperliquid and not a centralised exchange

The first version of Aven used Binance's futures feed. In testing from Indonesia, browsers could not reach any
`binance.com` host (nor Bybit's or OKX's) while command-line tools could; only Binance's spot mirror
`binance.vision` answered. Hyperliquid answered from every place it was tried, it is itself a perpetuals venue, and
its public API exposes the mark, oracle, funding and positions that a perpetuals simulator needs.

## What is simulated

Aven is honest about the gap between paper and a real venue:

- **No slippage on Hyperliquid markets.** Market orders fill at the mark, whatever the size. (Stock tokens do get
  price impact, from their pools.)
- **No liquidation penalty.** A liquidated position loses its margin and nothing more; real venues charge a fee and
  can socialise losses.
- **Away replay uses trade candles.** Hyperliquid publishes no mark-price candles, so replays use trade candles for
  both mark and last. Live, the real mark is used.
- **Fills of resting orders on stocks** happen at the order price, without swap impact.
- **Swap quotes stay in the active range.** Tick crossing isn't modelled, so orders above 1.5% impact are refused
  rather than quoted.
- **Liquidation odds** assume a driftless random walk; real markets have fat tails.
- **aUSD** has no value.
