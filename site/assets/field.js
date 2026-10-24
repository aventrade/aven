// The Aven field: a halftone terrain drawn as square dots on a 2D canvas, a dotted "A" monolith the camera flies
// through, and thin technical frames floating over it. Everything is a pure function of (time, scroll), so the
// promo reel can render it frame by frame; the page just feeds it requestAnimationFrame time and scroll progress.

const A_PARTS = [
  [[113, 0], [214, 180], [167, 180], [86, 44]],
  [[0, 180], [42, 104], [104, 104], [60, 180]],
];
const A_Z = 230, A_SCALE = 0.42, A_DEPTH = 6;

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// logo units -> world: centred on x = 0, standing on the ground, facing the camera
const toWorld = (lx, ly) => [(lx - 107) * A_SCALE, (180 - ly) * A_SCALE];

const A_DOTS = [];
for (let ly = 0; ly <= 180; ly += 2.4)
  for (let lx = 0; lx <= 220; lx += 2.4)
    if (A_PARTS.some(p => inside(p, lx, ly))) A_DOTS.push([...toWorld(lx, ly), ly / 180]);
const A_EDGES = A_PARTS.map(p => p.map(([x, y]) => toWorld(x, y)));

const FRAMES = [
  { x: -34, y: 14, z: 70, w: 18, h: 24, label: 'BTC / aUSD' },
  { x: 28, y: 22, z: 120, w: 22, h: 14, label: 'MARK' },
  { x: -46, y: 30, z: 170, w: 26, h: 18, label: 'LIQ. LINE' },
  { x: 38, y: 10, z: 200, w: 14, h: 20, label: 'ETH / aUSD' },
  { x: -18, y: 46, z: 300, w: 30, h: 20, label: 'FUNDING 0.00%' },
  { x: 30, y: 38, z: 340, w: 20, h: 26, label: 'PAPER ONLY' },
];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// camera keyframes along scroll progress p (0..1): position, pitch (radians, positive looks down)
const KEYS = [
  { p: 0.0, x: 0, y: 7, z: -10, pitch: 0.05 },
  { p: 0.3, x: 0, y: 9, z: 150, pitch: 0.02 },
  { p: 0.48, x: 0, y: 12, z: 250, pitch: 0.08 },
  { p: 0.72, x: 6, y: 40, z: 300, pitch: 0.5 },
  { p: 1.0, x: 0, y: 105, z: 330, pitch: 1.4 },
];

function camera(p) {
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smooth(a.p, b.p, p);
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), pitch: lerp(a.pitch, b.pitch, t) };
}

export function createField(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, F = 0, dpr = 1;
  let series = null; // normalised 0..1 closes; becomes a ridge running alongside the valley
  let labels = {};
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  // shockwaves: each real market liquidation drops a ring into the terrain ahead of the camera
  const pulses = [], pending = [];
  let now = 0, camZ = 0;

  function resize() {
    dpr = Math.min(opts.dpr || window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || canvas.width; H = canvas.clientHeight || canvas.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    F = Math.max(W, H * 1.2) * 0.62;
  }

  function height(x, z, t) {
    const ax = Math.abs(x);
    const walls = smooth(5, 46, ax);
    let h = Math.sin(x * 0.09 + z * 0.031 + t * 0.35) * 2.2
      + Math.sin(z * 0.052 - t * 0.22 + x * 0.025) * 3.1
      + Math.sin(x * 0.23) * Math.sin(z * 0.19 + t * 0.15) * 1.2;
    h = h * (0.25 + walls * 1.5) + walls * 9;
    if (series) {
      const i = ((z * 0.45) % series.length + series.length) % series.length;
      const v = series[Math.floor(i)];
      const g = Math.exp(-((ax - 30) ** 2) / 26);
      h += v * 18 * g;
    }
    for (const q of pulses) {
      const dx = x - q.x, dz = z - q.z;
      if (dx > q.r + 8 || dx < -q.r - 8 || dz > q.r + 8 || dz < -q.r - 8) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      h += q.amp * Math.exp(-((d - q.r) ** 2) / 7);
    }
    return h;
  }

  function draw(t, p) {
    mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;
    const cam = camera(p);
    now = t; camZ = cam.z;
    while (pending.length) {
      const q = pending.shift();
      pulses.push({ ...q, t0: t, x: (q.side === 'long' ? -1 : 1) * (12 + Math.random() * 40), z: cam.z + 50 + Math.random() * 70 });
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      const q = pulses[i], age = t - q.t0;
      q.r = age * 16; q.amp = q.size * Math.exp(-age * 0.9);
      if (age > 4.5 || t < q.t0) pulses.splice(i, 1);
    }
    cam.x += Math.sin(t * 0.21) * 0.8 + mouse.x * 2.2;
    cam.y += Math.sin(t * 0.17) * 0.4 - mouse.y * 1.2;
    cam.z += t * 0.0;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const cx0 = W / 2, cy0 = H * (0.5 + 0.1 * Math.cos(cam.pitch * 1.1));

    // world -> screen; returns null when behind the camera
    const proj = (x, y, z) => {
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      const vz = dz * cp - dy * sp;
      if (vz < 0.6) return null;
      const vy = dy * cp + dz * sp;
      return [cx0 + (dx * F) / vz, cy0 - (vy * F) / vz, vz];
    };

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // terrain: square halftone dots, size from slope lighting, alpha from distance
    const fogFar = 150 + cam.y * 1.1;
    const z0 = Math.max(0, Math.floor((cam.z - 10) / 2.2)), z1 = Math.min(260, Math.ceil((cam.z + fogFar) / 2.2));
    ctx.fillStyle = '#fff';
    for (let r = z1; r >= z0; r--) {
      const z = r * 2.2;
      for (let c = -64; c <= 64; c++) {
        const x = c * 1.45;
        const y = height(x, z, t);
        const q = proj(x, y, z);
        if (!q || q[0] < -10 || q[0] > W + 10 || q[1] < -10 || q[1] > H + 10) continue;
        const nx = height(x + 0.7, z, t) - y, nz = height(x, z + 0.7, t) - y;
        const light = Math.max(0, Math.min(1, 0.55 - nx * 0.55 + nz * 0.35));
        const fog = (1 - smooth(fogFar * 0.35, fogFar, q[2])) * (1 - smooth(62, 92, Math.abs(x))) * smooth(0, 30, z) * (1 - smooth(500, 570, z));
        if (fog <= 0.02) continue;
        const s = Math.min(5, (0.18 + light * 0.55) * F / q[2]);
        if (s < 0.35) continue;
        ctx.globalAlpha = fog * (0.35 + light * 0.65);
        ctx.fillRect(q[0] - s / 2, q[1] - s / 2, s, s);
      }
    }

    // the A monolith: front and back faces of dots, a light band sweeping up through it, solid edges
    const sweep = (t * 0.18) % 1.4 - 0.2;
    for (const face of [A_Z + A_DEPTH, A_Z]) {
      for (const [x, y, v] of A_DOTS) {
        const q = proj(x, y, face);
        if (!q || q[0] < -10 || q[0] > W + 10 || q[1] < -10 || q[1] > H + 10) continue;
        const band = Math.exp(-(((1 - v) - sweep) ** 2) / 0.006);
        const tone = 0.35 + 0.45 * (1 - v) + band * 0.6;
        const s = Math.min(7, (0.5 + 0.9 * tone) * F / q[2] * 0.55);
        const fog = 1 - smooth(200, 360, q[2]);
        ctx.globalAlpha = Math.min(1, fog * tone) * (face === A_Z ? 0.35 : 1);
        ctx.fillRect(q[0] - s / 2, q[1] - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    for (const poly of A_EDGES) {
      for (const face of [A_Z, A_Z + A_DEPTH]) {
        ctx.beginPath();
        let ok = true;
        poly.forEach(([x, y], i) => {
          const q = proj(x, y, face);
          if (!q) { ok = false; return; }
          i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
        });
        if (ok) { ctx.closePath(); ctx.stroke(); }
      }
      for (const [x, y] of poly) {
        const a = proj(x, y, A_Z), b = proj(x, y, A_Z + A_DEPTH);
        if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      }
    }

    // floating frames with crosshair ticks and a mono label
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    // frames and their labels are desktop furniture; on a phone they only crowd the text
    for (const f of W >= 760 ? FRAMES : []) {
      const bob = Math.sin(t * 0.5 + f.z) * 0.8;
      const pts = [[f.x, f.y + bob], [f.x + f.w, f.y + bob], [f.x + f.w, f.y + f.h + bob], [f.x, f.y + f.h + bob]].map(([x, y]) => proj(x, y, f.z));
      if (pts.some(q => !q)) continue;
      const fog = 1 - smooth(60, 200, pts[0][2]);
      if (fog <= 0.02) continue;
      ctx.globalAlpha = fog * 0.55;
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      ctx.closePath(); ctx.stroke();
      const mid = proj(f.x + f.w / 2, f.y + f.h / 2 + bob, f.z);
      const k = Math.min(14, 120 / mid[2] * 6);
      ctx.beginPath();
      ctx.moveTo(mid[0] - k, mid[1]); ctx.lineTo(mid[0] + k, mid[1]);
      ctx.moveTo(mid[0], mid[1] - k); ctx.lineTo(mid[0], mid[1] + k);
      ctx.stroke();
      ctx.globalAlpha = fog * 0.85;
      ctx.fillText(labels[f.label] || f.label, pts[3][0] + 4, pts[3][1] - 6);
    }
    // pulse labels
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    for (const q of pulses) {
      const age = t - q.t0;
      const a = proj(q.x, height(q.x, q.z, t) + 6 + age * 3, q.z);
      if (!a || !q.label || W < 760) continue;
      ctx.globalAlpha = Math.max(0, 1 - age / 3.2);
      ctx.fillStyle = '#fff';
      ctx.fillRect(a[0] - 3, a[1] - 3, 6, 6);
      ctx.fillText(q.label, a[0] + 8, a[1] + 4);
    }
    ctx.globalAlpha = 1;
  }

  let raf = 0, start = performance.now(), scroll = 0, smoothScroll = 0;
  function loop(now) {
    smoothScroll += (scroll - smoothScroll) * 0.08;
    draw((now - start) / 1000, smoothScroll);
    raf = requestAnimationFrame(loop);
  }

  resize();
  if (!opts.manual) {
    addEventListener('resize', resize);
    addEventListener('pointermove', e => { mouse.tx = e.clientX / innerWidth - 0.5; mouse.ty = e.clientY / innerHeight - 0.5; });
    raf = requestAnimationFrame(loop);
  }

  return {
    draw, resize,
    setScroll(p) { scroll = Math.min(1, Math.max(0, p)); },
    setSeries(closes) {
      if (!closes || closes.length < 4) return;
      const lo = Math.min(...closes), hi = Math.max(...closes);
      series = closes.map(c => (c - lo) / (hi - lo || 1));
    },
    setLabel(key, text) { labels[key] = text; },
    // size 0..1 from the liquidation's dollar value; side decides which wall of the valley it lands on
    pulse({ usd, side, label }) {
      if (pulses.length + pending.length > 14) return;
      pending.push({ side, label, size: 2 + Math.min(9, Math.log10(Math.max(1, usd)) * 1.6 - 4) });
    },
    stop() { cancelAnimationFrame(raf); },
  };
}
