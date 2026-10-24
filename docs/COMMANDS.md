# Command line

Press `/` or `Ctrl`+`K` anywhere in the app. While you type, a preview line says what the command will do (size,
fill, liquidation). After Enter the result is printed: fill price, size, liquidation price and its 24-hour odds,
fees, or the reason it was refused. The last six commands stay listed; `↑` recalls the last one. `Esc` closes it.

Market names are case-insensitive. Aliases: `xbt`, `bitcoin` → BTC; `ether` → ETH; `xau` → GOLD; `xag` → SILVER;
`wti`, `cl` → OIL; `1000pepe` → PEPE; a `-perp` or `usdt` suffix is ignored. `buy` / `l` mean long, `sell` / `s`
mean short.

## Orders

| Command | Does |
|---|---|
| `long btc 20x 1000` | Market long, 1,000 aUSD margin at 20x (20,000 size) |
| `short eth 10x 500 @2450` | Limit short resting at 2,450 (`limit 2450` and `at 2450` work too) |
| `long sol 5x 300 stop 105` | Stop long, triggers when the mark reaches 105 |
| `long btc 20x 1000 tp 83000 sl 79000` | Market long with a take profit and a stop loss |
| `short btc 20x 500 reduce` | Reduce-only: can only shrink an open long |
| `long nvda 1000` | No leverage given: 10x, or the market's cap if lower |

## Positions

| Command | Does |
|---|---|
| `close btc` · `close btc 50%` | Close all or part at the mark (stocks: at the pool quote) |
| `margin btc +200` · `margin btc -100` | Add or pull margin; the liquidation price moves |
| `tp btc 83000` · `sl btc 79000` | Set a take profit or stop loss on the open position |
| `cancel eth` · `cancel all` | Cancel resting orders; their hold goes back to free |
| `go hype` | Switch the chart and ticket to a market |

## Pairs and alerts

| Command | Does |
|---|---|
| `pair long nvda short qqq 1000 3x` | Two market orders at once, 1,000 aUSD margin each, tracked as one spread with a combined PnL |
| `close pair` · `close pair 12` | Close both legs of every pair, or of pair #12 |
| `alert btc above 85000` | Alert when the mark crosses up through 85,000 |
| `alert nvda 200` | Direction taken from where the mark is now |
| `alerts clear` | Remove every alert |

Alerts show a toast and, if you allowed notifications, a browser notification.

## Errors

The parser says what's missing rather than guessing: `How much margin? e.g. long btc 20x 1000`,
`That order needs a price.`, `No nope market.`, `BTC allows 1x to 40x.`. The engine refuses what a venue would:
not enough free aUSD, a limit on the wrong side of the mark, a stop past the liquidation price, a stock order that
would move its pool more than 1.5%.
