// Stress test: what the worst real hour of the last 90 days (about 41 for Robinhood Chain stocks, which is as far as
// their hourly candles go) would do to each open position if it started now. Longs get the market's deepest
// open-to-low hour, shorts its highest open-to-high hour, applied to the current mark.
import * as E from './engine.js';
import * as feed from './feed.js';

const worst = {};   // sym -> { down, downAt, up, upAt, days, at }

async function load(sym) {
  const w = worst[sym];
  if (w && Date.now() - w.at < 30 * 60e3) return w;
  const rows = await feed.klines(sym, '1h', feed.isRh(sym) ? 1000 : 2160);
  let down = 0, downAt = 0, up = 0, upAt = 0;
  for (const b of rows) {
    const d = b.low / b.open - 1, u = b.high / b.open - 1;
    if (d < down) { down = d; downAt = b.time * 1000; }
    if (u > up) { up = u; upAt = b.time * 1000; }
  }
  return (worst[sym] = { down, downAt, up, upAt, days: rows.length ? Math.round((Date.now() - rows[0].time * 1000) / 86400e3) : 0, at: Date.now() });
}

const when = t => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export async function stressHtml(s) {
  const list = Object.entries(s.pos);
  if (!list.length) return '<div class="stress"><span class="lbl">Open a position to stress it against the worst hour of the last 90 days.</span></div>';
  const out = [];
  for (const [sym, p] of list) {
    let w;
    // GeckoTerminal (stock history) rate-limits bursts, so one failed read is retried after a short wait
    try { w = await load(sym).catch(() => new Promise(r => setTimeout(r, 2500)).then(() => load(sym))); } catch { out.push(`<div class="srow"><b>${sym}</b><span class="lbl">Could not read its history right now.</span></div>`); continue; }
    const mark = feed.marks[sym]; if (!mark) continue;
    const move = p.side === 'long' ? w.down : w.up, at = p.side === 'long' ? w.downAt : w.upAt;
    const price = mark * (1 + move);
    const hit = p.side === 'long' ? price <= p.liq : price >= p.liq;
    const delta = hit ? -(p.margin + E.upnl(p, mark)) : E.upnl(p, price) - E.upnl(p, mark);
    out.push(`<div class="srow ${hit ? 'dead' : ''}"><b>${sym}</b><span class="tag ${p.side}">${p.side}</span>
      <span>worst ${p.side === 'long' ? 'drop' : 'spike'} in ${w.days} days: <b>${E.signed(move * 100)}%</b> <span class="lbl">${when(at)}</span></span>
      <span>${hit ? '<b>liquidated</b>' : `survives · ${E.signed(delta)} aUSD`}</span></div>`);
  }
  return `<div class="stress"><span class="lbl">Stress test · the worst real hour for each market, applied to your position now</span>${out.join('')}</div>`;
}
