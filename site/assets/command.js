// The command line: one line of plain words in, one action out.
//   long btc 20x 1000            market long, 1,000 aUSD margin at 20x
//   short eth 10x 500 @2450      limit short resting at 2,450
//   long sol 5x 300 stop 105     stop long triggering at 105 on the mark
//   long btc 20x 1000 tp 82000 sl 79500
//   close btc | close btc 50%    margin btc +200 | margin btc -100
//   tp btc 82000 | sl btc 79000  cancel eth | cancel all | go sol
//   alert btc above 82000 | alert nvda 200 (direction taken from the mark) | alerts clear
//   pair long nvda short qqq 1000 3x   two legs, 1,000 aUSD margin each | close pair | close pair 12
import { MARKETS } from './engine.js';

const ALIAS = { BITCOIN: 'BTC', XBT: 'BTC', ETHER: 'ETH', XAU: 'GOLD', XAG: 'SILVER', WTI: 'OIL', CL: 'OIL', '1000PEPE': 'PEPE' };
const num = w => { const v = parseFloat(String(w).replace(/[,_$@]/g, '')); return Number.isFinite(v) ? v : NaN; };

function market(w) {
  if (!w) throw new Error('Which market? Try btc, eth, sol, gold, oil…');
  const u = w.toUpperCase().replace(/-?PERP$|USDT?$/, '');
  const sym = ALIAS[u] || u;
  if (!MARKETS.some(m => m.sym === sym)) throw new Error(`No ${w} market. Markets: ${MARKETS.map(m => m.sym.toLowerCase()).join(' ')}`);
  return sym;
}

export function parse(line) {
  const w = line.trim().toLowerCase().replace(/^\//, '').split(/\s+/);
  const op = { buy: 'long', sell: 'short', l: 'long', s: 'short' }[w[0]] || w[0];
  if (op === 'go' || op === 'chart') return { op: 'go', sym: market(w[1]) };
  if (op === 'alerts' && w[1] === 'clear') return { op: 'alerts-clear' };
  if (op === 'alert') {
    const sym = market(w[1]);
    let dir = null, i = 2;
    if (w[2] === 'above' || w[2] === '>' ) { dir = 'above'; i = 3; } else if (w[2] === 'below' || w[2] === '<') { dir = 'below'; i = 3; }
    const price = num(w[i]);
    if (!(price > 0)) throw new Error('alert takes a price, like alert btc above 82000.');
    return { op: 'alert', sym, dir, price };
  }
  if (op === 'pair') {
    const side = x => ({ long: 'long', buy: 'long', short: 'short', sell: 'short' })[x];
    const a = side(w[1]), b = side(w[3]);
    if (!a || !b || a === b) throw new Error('pair takes one long and one short, like pair long nvda short qqq 1000 3x.');
    let margin = null, lev = null;
    for (const t of w.slice(5)) { if (/^\d+(\.\d+)?x$/.test(t)) lev = num(t); else if (Number.isFinite(num(t)) && margin === null) margin = num(t); }
    if (!(margin > 0)) throw new Error('How much margin per leg? e.g. pair long nvda short qqq 1000 3x');
    const legs = [{ side: a, sym: market(w[2]) }, { side: b, sym: market(w[4]) }];
    if (legs[0].sym === legs[1].sym) throw new Error('A pair needs two different markets.');
    return { op: 'pair', legs, margin, lev };
  }
  if (op === 'cancel') return { op: 'cancel', sym: w[1] === 'all' || !w[1] ? 'ALL' : market(w[1]) };
  if (op === 'close' && w[1] === 'pair') return { op: 'close-pair', id: w[2] ? num(w[2].replace('#', '')) : null };
  if (op === 'close') {
    const share = w[2] ? num(w[2]) / 100 : 1;
    if (!(share > 0 && share <= 1)) throw new Error('Close takes a share, like close btc 50%.');
    return { op: 'close', sym: market(w[1]), share };
  }
  if (op === 'margin') {
    const amount = num(w[2]);
    if (!Number.isFinite(amount) || !amount) throw new Error('Margin takes an amount, like margin btc +200.');
    return { op: 'margin', sym: market(w[1]), amount };
  }
  if (op === 'tp' || op === 'sl') {
    const price = num(w[2]);
    if (!(price > 0)) throw new Error(`${op} takes a price, like ${op} btc 82000.`);
    return { op, sym: market(w[1]), price };
  }
  if (op === 'long' || op === 'short') {
    const c = { op: 'order', side: op, sym: market(w[1]), type: 'market', lev: null, margin: null, price: null, tp: null, sl: null, reduce: false };
    for (let i = 2; i < w.length; i++) {
      const t = w[i];
      if (/^\d+(\.\d+)?x$/.test(t)) c.lev = num(t);
      else if (t.startsWith('@')) { c.type = 'limit'; c.price = num(t.slice(1) || w[++i]); }
      else if (t === 'limit' || t === 'at') { c.type = 'limit'; c.price = num(w[++i]); }
      else if (t === 'stop') { c.type = 'stop'; c.price = num(w[++i]); }
      else if (t === 'tp') c.tp = num(w[++i]);
      else if (t === 'sl') c.sl = num(w[++i]);
      else if (t === 'reduce') c.reduce = true;
      else if (Number.isFinite(num(t)) && c.margin === null) c.margin = num(t);
      else throw new Error(`Didn't understand "${t}".`);
    }
    if (!(c.margin > 0)) throw new Error('How much margin? e.g. long btc 20x 1000');
    if (c.type !== 'market' && !(c.price > 0)) throw new Error('That order needs a price.');
    return c;
  }
  throw new Error(`Unknown command "${w[0]}". Start with long, short, pair, close, margin, tp, sl, alert, cancel or go.`);
}
