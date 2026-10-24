# Changelog

All notable changes to Aven. The live site is always the latest entry.

## 0.9.0 · 2026-10-24

- **Mirror.** Open any Hyperliquid account: live account value, positions with size, entry, liquidation price and
  unrealised PnL, the latest trades. Copy a position onto paper in one click. Watching an account announces when it
  opens, flips or closes something. Top 20 accounts by 30-day PnL from a dated leaderboard snapshot.
- **Command line results.** A preview line while typing; after Enter, the fill price, size, liquidation price and
  its odds, fees, or the reason for a refusal. The last six commands stay listed.

## 0.8.0 · 2026-10-24

- **Rewind.** Replay one of a market's six wildest days of the last two weeks in real 5-minute candles, with that
  day's funding, at 1, 3 or 10 candles a second, on a separate 50,000 aUSD account.
- **Funding board.** Hyperliquid's live funding beside Binance and Bybit for the same coin, per hour, per year and
  per day on 10,000 aUSD, with the gap to Binance.
- **Stress test.** Each open position against the worst real hour its market had in 90 days.
- No bare zero or dash placeholder anywhere: loading values shimmer, real zeros read as words, small funding rates
  show enough precision.

## 0.7.0 · 2026-10-24

- **Robinhood Chain stocks.** Thirteen official stock tokens priced from their pools on-chain every three seconds:
  Uniswap v3 `slot0`, SushiSwap v3, and Uniswap v4 through the PoolManager's `extsload`. Fills quoted with swap maths
  on active liquidity, LP fee included; orders over 1.5% impact refused; 5x cap; no funding; pool panel instead of a
  book; Wall St reference in the bar.
- **Liquidation odds** for every position and in the ticket, from three days of hourly volatility.
- **Price alerts** with browser notifications; **pair trades** tracked as one spread.
- Away replay holds back and retries a market whose history can't be fetched instead of skipping it.

## 0.6.0 · 2026-10-24

- One app route: trading, journal and later views switch inside `/trade/`.
- `/docs/`, an interactive command-line sandbox on the landing page, a five-step how-it-works, a phone menu, and an
  audit pass for anything past the edge at 360 px.

## 0.5.0 · 2026-10-24

- **Moved to Hyperliquid.** Browsers in Indonesia couldn't reach any `binance.com` host; Hyperliquid's public API
  answered everywhere. Mark, oracle, hourly funding, open interest, book and trades from one websocket.
- **Engine v2**: netted positions, market / limit / stop / reduce-only orders, real funding, isolated margin,
  partial closes, add or pull margin; a run is one 50,000 aUSD account.
- **Away settlement**: missed candles and funding replayed in order on return.
- **Command line**, **journal** with tags and CSV, **whale tape**, **receipts**; 16 markets including gold,
  silver, WTI crude and a US tech 100 index.

## 0.1.0 · 2026-10-24

- First version: landing page with the halftone field and the dotted A, a paper trading terminal on Binance
  prices, share card, 30-second reel.
