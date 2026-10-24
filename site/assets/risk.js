// Liquidation odds: the chance the mark touches a price within a time window, from the market's own realised
// volatility. Hourly log returns over the last three days give sigma per hour; for a driftless random walk the
// probability of touching a level a log-distance d away within T hours is 2 * (1 - Phi(d / (sigma * sqrt(T)))).
// It is a statistic, not a forecast: fat tails make real touches more likely than this says.
import * as feed from './feed.js';

const vol = {};       // sym -> { sigma, n, at }
const pending = {};

function erf(x) {
  // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const phi = z => 0.5 * (1 + erf(z / Math.SQRT2));

export function sigma(sym) {
  const v = vol[sym];
  if ((!v || Date.now() - v.at > 15 * 60e3) && !pending[sym]) {
    pending[sym] = feed.klines(sym, '1h', 73).then(rows => {
      const r = [];
      for (let i = 1; i < rows.length; i++) if (rows[i - 1].close > 0 && rows[i].close > 0) r.push(Math.log(rows[i].close / rows[i - 1].close));
      if (r.length < 12) return;
      const m = r.reduce((a, x) => a + x, 0) / r.length;
      const sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1));
      vol[sym] = { sigma: sd, n: r.length, at: Date.now() };
    }).catch(() => {}).finally(() => { delete pending[sym]; });
  }
  return v ? v.sigma : null;
}

export function touchOdds(sym, mark, level, hours = 24) {
  const s = sigma(sym);
  if (!s || !(mark > 0) || !(level > 0)) return null;
  const d = Math.abs(Math.log(level / mark));
  return Math.min(1, 2 * (1 - phi(d / (s * Math.sqrt(hours)))));
}

export const pct = p => (p == null ? 'reading' : p < 0.001 ? '<0.1%' : p > 0.995 ? '>99%' : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`);
