// The Aven receipt: a trade printed on a strip of paper, 1080x1350, black and white.
import { fmt, fmtPrice, signed, ago } from './engine.js';

const LOGO = [new Path2D('M113 0 214 180H167L86 44Z'), new Path2D('M0 180 42 104H104L60 180Z')];

export function drawReceipt(c, r, run = 1) {
  const g = c.getContext('2d'), W = c.width, H = c.height;
  g.fontStretch = 'ultra-expanded';
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);

  // halftone backdrop
  g.fillStyle = '#fff';
  for (let y = 0; y < H; y += 14) for (let x = 0; x < W; x += 14) {
    const v = (0.5 + 0.5 * Math.sin(x * 0.01 + y * 0.013)) * Math.max(0, 1 - Math.hypot(x - W * 0.5, y - H * 0.5) / (W * 0.62));
    const sz = v * 6;
    if (sz > 0.8) { g.globalAlpha = 0.28; g.fillRect(x - sz / 2, y - sz / 2, sz, sz); }
  }
  g.globalAlpha = 1;

  // the paper strip, with torn zig-zag edges top and bottom
  const px = 150, pw = W - 300, top = 90, bot = H - 90, tooth = 18;
  g.save();
  g.translate(W / 2, H / 2); g.rotate(-0.018); g.translate(-W / 2, -H / 2);
  g.beginPath();
  g.moveTo(px, top);
  for (let x = px; x < px + pw; x += tooth) { g.lineTo(x + tooth / 2, top - 10); g.lineTo(x + tooth, top); }
  g.lineTo(px + pw, bot);
  for (let x = px + pw; x > px; x -= tooth) { g.lineTo(x - tooth / 2, bot + 10); g.lineTo(x - tooth, bot); }
  g.closePath();
  g.shadowColor = 'rgba(255,255,255,.15)'; g.shadowBlur = 40;
  g.fillStyle = '#f4f4f2'; g.fill();
  g.shadowBlur = 0;

  const L = px + 56, R = px + pw - 56, ink = '#0a0a0a';
  let y = top + 70;
  g.fillStyle = ink;
  g.save(); g.translate(W / 2 - 46, y - 40); g.scale(0.42, 0.42); LOGO.forEach(p => g.fill(p)); g.restore();
  y += 104;
  g.textAlign = 'center';
  g.font = '900 54px Archivo'; g.fillText('AVEN', W / 2, y);
  y += 34;
  g.font = '500 20px "IBM Plex Mono"'; g.fillText(`PAPER PERPETUALS · RUN ${run}`, W / 2, y);
  y += 26;
  g.fillText(new Date(r.closed || Date.now()).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).toUpperCase(), W / 2, y);

  const dash = () => { y += 30; g.save(); g.setLineDash([8, 7]); g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.restore(); y += 18; };
  const row = (a, b, bold = false) => {
    y += 40;
    g.textAlign = 'left'; g.font = `${bold ? 700 : 500} 26px "IBM Plex Mono"`; g.fillText(a, L, y);
    g.textAlign = 'right'; g.fillText(b, R, y);
  };
  dash();
  y += 50;
  g.textAlign = 'center'; g.font = '900 64px Archivo';
  g.fillText(`${r.sym}-PERP`, W / 2, y);
  y += 54;
  g.font = '700 28px "IBM Plex Mono"';
  const tag = `${r.side.toUpperCase()} ${r.lev}X${r.live ? ' · OPEN' : ' · ' + String(r.reason || 'closed').toUpperCase()}`;
  const tw = g.measureText(tag).width + 36;
  g.fillRect(W / 2 - tw / 2, y - 34, tw, 48);
  g.fillStyle = '#f4f4f2'; g.fillText(tag, W / 2, y); g.fillStyle = ink;
  dash();
  row('ENTRY', fmtPrice(r.entry));
  row(r.live ? 'MARK' : 'EXIT', fmtPrice(r.exit));
  row('MARGIN', `${fmt(r.margin)} aUSD`);
  row('HELD', ago((r.closed || Date.now()) - r.opened));
  row('PRICE PNL', Math.abs(r.pnl) < 0.005 ? 'FLAT' : `${signed(r.pnl)}`);
  row('FEES', r.fees ? `−${fmt(r.fees)}` : 'NONE');
  row('FUNDING', Math.abs(r.funding) < 0.005 ? 'NONE' : `${signed(-r.funding)}`);
  dash();
  const pct = (r.net / r.margin) * 100;
  y += 96;
  g.textAlign = 'center'; g.font = '900 120px Archivo';
  g.fillText(Math.abs(pct) < 0.05 ? 'EVEN' : `${signed(pct, 1)}%`, W / 2, y);
  y += 46;
  g.font = '600 28px "IBM Plex Mono"'; g.fillText(Math.abs(r.net) < 0.005 ? 'NET EVEN' : `NET ${signed(r.net)} aUSD`, W / 2, y);
  dash();
  // barcode from the trade id
  y += 16;
  let bx = L + 40, seed = (r.id || 7) * 2654435761 % 4294967296;
  while (bx < R - 40) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const w = 2 + (seed % 5);
    if ((seed >> 3) & 1) g.fillRect(bx, y, w, 70);
    bx += w + 2;
  }
  y += 104;
  g.font = '500 19px "IBM Plex Mono"';
  g.fillText('SIMULATED TRADE ON LIVE HYPERLIQUID PRICES', W / 2, y);
  y += 28;
  g.fillText('aUSD HAS NO VALUE · NOTHING ON THE LINE', W / 2, y);
  g.restore();
}
