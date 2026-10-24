// Keeps the paper account honest. Live: every mark tick runs liquidations, stops, targets and resting orders, and
// funding is paid at each real (hourly) funding timestamp. Away: when the page opens again, the 1-minute candles and
// the real funding history since the last visit are replayed in order, so a position that would have been
// liquidated at 3 a.m. was liquidated at 3 a.m.

import * as E from './engine.js';
import * as feed from './feed.js';

// live settlement waits until the away replay has run, so it can't move s.seen past the gap first
let ready = false;
export const markReady = () => { ready = true; };

export function live(s) {
  if (!ready) return [];
  const fired = [];
  const syms = new Set([...Object.keys(s.pos), ...s.orders.map(o => o.sym)]);
  const now = Date.now();
  for (const sym of syms) {
    if (s.behind?.[sym]) continue;   // still owed a replay; settling it live first would run events out of order
    const mk = feed.marks[sym], lp = feed.last[sym] || mk;
    if (!(mk > 0)) continue;
    const p = s.pos[sym], f = feed.funding[sym];
    if (p && f && p.nextFunding && now >= p.nextFunding) {
      const pay = E.settleFunding(s, sym, p.fundingRate ?? f.rate, mk, p.nextFunding);
      if (pay) fired.push({ kind: 'funding', sym, pay });
    }
    if (s.pos[sym] && f) { s.pos[sym].nextFunding = f.next; s.pos[sym].fundingRate = f.rate; }
    fired.push(...E.step(s, sym, { markLo: mk, markHi: mk, lastLo: lp, lastHi: lp, t: now }));
  }
  s.seen = now;
  return fired;
}

// A market whose candles can't be fetched (a rate-limited source, a dropped connection) is not skipped: it is kept in
// s.behind with the time it is owed from, left out of live settlement, and replayed on the next call.
export async function away(s) {
  const to = Date.now();
  s.behind ||= {};
  const syms = [...new Set([...Object.keys(s.pos), ...s.orders.map(o => o.sym), ...Object.keys(s.behind)])];
  const fromOf = sym => s.behind[sym] || s.seen || to;
  const gap = to - Math.min(to, ...syms.map(fromOf), s.seen || to);
  if (gap < 90e3 && !Object.keys(s.behind).length) { s.seen = to; ready = true; return { gap, fired: [], funding: 0, failed: [] }; }
  const fired = [], failed = [];
  let paid = 0;
  for (const sym of syms) {
    const from = fromOf(sym);
    if (to - from < 90e3) { delete s.behind[sym]; continue; }
    // 1m candles cover 25h in one request; longer gaps step in 5m (5 days) or 1h
    const g = to - from;
    const iv = g <= 1500 * 60e3 ? '1m' : g <= 1500 * 300e3 ? '5m' : '1h';
    const span = { '1m': 60e3, '5m': 300e3, '1h': 3600e3 }[iv];
    const start = Math.max(from, to - 1500 * span);
    let mk, lk, fh;
    try {
      [mk, lk, fh] = await Promise.all([
        feed.rangeKlines(sym, start, to, iv),
        Promise.resolve(null),
        s.pos[sym] ? feed.fundingHistory(sym, from) : Promise.resolve([]),
      ]);
    } catch { s.behind[sym] = from; failed.push(sym); continue; }
    delete s.behind[sym];
    const lastBy = new Map((lk || mk).map(k => [k.time, k]));
    let fi = 0;
    for (const k of mk) {
      const t = k.time * 1000;
      if (t + span <= from) continue;
      while (fi < fh.length && fh[fi].t <= t + span) {
        const f = fh[fi++];
        if (s.pos[sym] && f.t > from) { const pay = E.settleFunding(s, sym, f.rate, f.mark || k.close, f.t); paid += pay; }
      }
      const l = lastBy.get(k.time) || k;
      for (const ev of E.step(s, sym, { markLo: k.low, markHi: k.high, lastLo: l.low, lastHi: l.high, t: t + span / 2 })) fired.push({ ...ev, t: t + span / 2 });
      if (!s.pos[sym] && !s.orders.some(o => o.sym === sym)) break;
    }
  }
  s.seen = to;
  ready = true;
  return { gap, fired, funding: paid, failed };
}
