# Engine specification

`site/assets/engine.js` is the whole exchange. It is a set of pure functions over one plain account object, so the
same code settles a live tick, a candle replayed after an absence, a Rewind day and the landing-page sandbox. This
document is the rulebook; `test/engine.test.mjs` checks it.

## Constants

| Name | Value | Meaning |
|---|---|---|
| `START` | 50,000 aUSD | Balance of every new run |
| `TAKER` | 0.05% of notional | Market and stop fills, closes, liquidity-taking |
| `MAKER` | 0.02% of notional | Resting limit fills |
| `MAINT` | 0.5% of notional at the mark | Maintenance margin |
| `MIN_SIZE` | 10 aUSD of notional | Smallest order |
| Leverage cap | Hyperliquid's per market (10x to 40x); 5x on Robinhood Chain stocks | Read from Hyperliquid's `meta` on load |

## Account

```js
{ v: 2, run, started, cash, pos: { SYM: position }, orders: [], fills: [], closed: [], curve: [[t, value]], runs: [], seq, seen }
```

`cash` is free balance. Margin of open positions and the hold of resting orders are outside it. `seen` is the last
moment the account was settled; the away replay starts there.

## Positions are netted

There is at most one position per market: `{ side, qty, entry, margin, liq, tp, sl, trip }`.

An order on the **same side** adds to it. Entry becomes the size-weighted average:

```
entry' = (entry · qty + price · q) / (qty + q)
margin' = margin + price · q / lev
```

An order on the **opposite side** first closes up to the open quantity, realising
`(price − entry) · closed · d` where `d = +1` for a long and `−1` for a short, and releasing that share of the margin.
Whatever is left of the order opens a new position the other way (a flip). A reduce-only order never opens or
flips.

## Liquidation price

Isolated margin: a position can only lose its own margin. It is liquidated when margin plus unrealised PnL falls to
the maintenance requirement at the mark:

```
margin + (L − entry) · qty · d = MAINT · qty · L
⇒ L = (entry · qty · d − margin) / (qty · (d − MAINT))
```

The liquidation price is recomputed whenever margin changes: funding paid out of margin moves it closer, adding
margin moves it away. On liquidation the position closes at `L` and its whole margin is lost; there is no extra
penalty (real venues charge one).

## Orders

| Type | Triggers on | Fills at | Fee |
|---|---|---|---|
| Market | immediately | the mark (Hyperliquid) or a pool swap quote (Robinhood Chain stocks) | taker |
| Limit | a trade reaching the price: `last ≤ price` for a long, `last ≥ price` for a short | the limit price | maker |
| Stop | the mark crossing the price | the stop price | taker |
| TP / SL | the mark crossing the level | the level, whole position | taker |

A long limit must rest below the mark and a short limit above it; a stop the other way round. Resting orders hold
`size / lev + fee` from `cash` until they fill or are cancelled; at fill time the hold is released and the fill
charges margin and fee normally. A stop loss beyond the liquidation price is refused, since it would never fire.

## One step

`step(account, sym, { markLo, markHi, lastLo, lastHi, t })` checks one price range against everything on that market,
in this order:

1. resting orders (limits against the last-trade range, stops against the mark range);
2. liquidation against the mark range;
3. stop loss, then take profit.

A live tick passes `lo = hi = price`. A replayed candle passes its low and high, so a wick that would have liquidated
you does.

## Funding

`settleFunding(account, sym, rate, mark, t)` pays `qty · mark · rate · d` out of the position's margin, once per
funding timestamp. Hyperliquid funds hourly; a positive rate means longs pay shorts. Live, Aven settles at the top of
each hour with the rate in force; away, it replays Hyperliquid's recorded funding history. Robinhood Chain stocks
are spot tokens and pay no funding.

## Trips, stats and runs

Every position carries a **trip**: maximum quantity and margin, entry and exit cost, realised price PnL, fees and
funding. When the position reaches zero the trip is closed with its reason (`market`, `limit`, `stop loss`,
`take profit`, `liquidation`…) and `net = pnl − fees − funding`. The journal's statistics come only from closed trips:

- **win rate** = trips with `net > 0` ÷ all trips
- **profit factor** = gross won ÷ gross lost
- **average win / loss**, **liquidations**, **fees + funding**, **average hold**

The equity curve samples `free + margin + held + unrealised` once a minute while the app is open. A **run** is one
50,000 aUSD account; `newRun()` archives its final value and starts the next.

## Liquidation odds

`risk.js` estimates the chance that the mark touches a level within `T` hours, using the market's hourly log
returns over the last three days (`σ` per hour) and the touch probability of a driftless random walk:

```
P(touch within T) = 2 · (1 − Φ( |ln(level / mark)| / (σ · √T) ))
```

It is a statistic, not a forecast. Real returns have fat tails, so real touches happen more often than this says.
