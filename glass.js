/* Scan Lab — on-device stained-glass vectorizer for beginners.
   Pipeline: resize → blur → subject focus (border flood) → k-means → majority smoothing → frame →
   connected pieces → remove necks/points/slivers (morphological opening) → merge small pieces → split
   holes & oversize pieces → trace shared boundaries (no gaps) → smooth + simplify → numbered closed paths. */
const GLASS_LINES = {
  foil116: { in: 1 / 16, label: 'Copper foil — 1/16″ lines' },
  foil18: { in: 1 / 8, label: 'Copper foil — 1/8″ lines' },
  came316: { in: 3 / 16, label: 'Lead came — 3/16″' },
  came14: { in: 1 / 4, label: 'Lead came — 1/4″' },
};
const GLASS_PALETTE = [
  ['Clear textured', 232, 236, 238], ['White opal', 246, 244, 236], ['Wispy white', 222, 218, 205], ['Light gray', 170, 174, 178], ['Charcoal', 70, 72, 76], ['Black opal', 22, 22, 24],
  ['Ruby red', 170, 20, 30], ['Cherry red', 210, 40, 40], ['Pink', 236, 150, 170], ['Rose', 190, 90, 120], ['Orange', 240, 120, 30], ['Amber', 205, 135, 40],
  ['Light amber', 230, 190, 110], ['Gold / yellow', 245, 205, 40], ['Pale yellow', 245, 235, 150], ['Brown', 115, 70, 35], ['Tan', 196, 160, 120], ['Olive', 120, 125, 50],
  ['Spring green', 120, 190, 80], ['Emerald green', 20, 130, 70], ['Dark green', 20, 75, 40], ['Teal', 30, 140, 140], ['Aqua', 120, 200, 210], ['Sky blue', 130, 180, 230],
  ['Medium blue', 50, 100, 190], ['Cobalt blue', 25, 45, 150], ['Navy', 20, 30, 80], ['Lavender', 175, 150, 210], ['Purple', 100, 50, 140], ['Flesh / peach', 240, 200, 170],
];
const gHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const cdist = (a, b) => { const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db); };
function nearestGlass(c) { let best = GLASS_PALETTE[0], bd = 1e9; for (const p of GLASS_PALETTE) { const d = cdist(c, [p[1], p[2], p[3]]); if (d < bd) { bd = d; best = p; } } return { name: best[0], rgb: [best[1], best[2], best[3]] }; }
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* k-means++ (deterministic). pts: Float32Array rgb triples; returns {centers, assign(rgb)} */
function kmeans(pts, k, iters = 14, seed = 7) {
  const n = pts.length / 3, rnd = mulberry(seed); k = Math.max(1, Math.min(k, n));
  const C = []; C.push([pts[0], pts[1], pts[2]].map((v, i) => pts[Math.floor(rnd() * n) * 3 + i]));
  const d2 = new Float64Array(n).fill(Infinity);
  while (C.length < k) {
    const c = C[C.length - 1]; let sum = 0;
    for (let i = 0; i < n; i++) { const dr = pts[i * 3] - c[0], dg = pts[i * 3 + 1] - c[1], db = pts[i * 3 + 2] - c[2]; const d = dr * dr + dg * dg + db * db; if (d < d2[i]) d2[i] = d; sum += d2[i]; }
    if (sum === 0) break; let r = rnd() * sum, j = 0; for (; j < n - 1; j++) { r -= d2[j]; if (r <= 0) break; }
    C.push([pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]]);
  }
  const lab = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { let b = 0, bd = Infinity; for (let c = 0; c < C.length; c++) { const dr = pts[i * 3] - C[c][0], dg = pts[i * 3 + 1] - C[c][1], db = pts[i * 3 + 2] - C[c][2]; const d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; b = c; } } lab[i] = b; const a = acc[b]; a[0] += pts[i * 3]; a[1] += pts[i * 3 + 1]; a[2] += pts[i * 3 + 2]; a[3]++; }
    let moved = 0; acc.forEach((a, c) => { if (a[3]) { const nc = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; moved += Math.abs(nc[0] - C[c][0]) + Math.abs(nc[1] - C[c][1]) + Math.abs(nc[2] - C[c][2]); C[c] = nc; } });
    if (moved < 0.5) break;
  }
  return C;
}
const nearestC = (C, r, g, b) => { let best = 0, bd = Infinity; for (let c = 0; c < C.length; c++) { const dr = r - C[c][0], dg = g - C[c][1], db = b - C[c][2]; const d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = c; } } return best; };

function boxBlur(src, W, H, r) {
  if (r < 1) return src; const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < H; y++) for (let ch = 0; ch < 3; ch++) { let s = 0, c = 0; for (let x = -r; x <= r; x++) if (x >= 0 && x < W) { s += src[(y * W + x) * 3 + ch]; c++; } for (let x = 0; x < W; x++) { tmp[(y * W + x) * 3 + ch] = s / c; const a = x - r, b = x + r + 1; if (a >= 0) { s -= src[(y * W + a) * 3 + ch]; c--; } if (b < W) { s += src[(y * W + b) * 3 + ch]; c++; } } }
  for (let x = 0; x < W; x++) for (let ch = 0; ch < 3; ch++) { let s = 0, c = 0; for (let y = -r; y <= r; y++) if (y >= 0 && y < H) { s += tmp[(y * W + x) * 3 + ch]; c++; } for (let y = 0; y < H; y++) { out[(y * W + x) * 3 + ch] = s / c; const a = y - r, b = y + r + 1; if (a >= 0) { s -= tmp[(a * W + x) * 3 + ch]; c--; } if (b < H) { s += tmp[(b * W + x) * 3 + ch]; c++; } } }
  return out;
}
/* connected components (4-conn) of equal labels; returns {R, n} with new ids 0..n-1 and map newId→oldLabel */
function components(L, W, H) {
  const R = new Int32Array(W * H).fill(-1), from = []; let n = 0; const st = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) { if (R[i] >= 0) continue; const lab = L[i]; let sp = 0; st[sp++] = i; R[i] = n;
    while (sp) { const p = st[--sp], x = p % W, y = (p - x) / W; const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]; for (const q of nb) if (q >= 0 && R[q] < 0 && L[q] === lab) { R[q] = n; st[sp++] = q; } }
    from.push(lab); n++; }
  return { R, n, from };
}
/* chamfer (3-4) distance to nearest pixel of a different region or the outside; returns px units */
function distT(R, W, H) {
  const D = new Float32Array(W * H), INF = 1e9;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, r = R[i]; const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 || R[i - 1] !== r || R[i + 1] !== r || R[i - W] !== r || R[i + W] !== r; D[i] = edge ? 1 : INF; }
  const pass = (x, y, dx, dy, w) => { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) return INF; const j = ny * W + nx; return R[j] === R[y * W + x] ? D[j] + w : INF; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; D[i] = Math.min(D[i], pass(x, y, -1, 0, 1), pass(x, y, 0, -1, 1), pass(x, y, -1, -1, 1.4142), pass(x, y, 1, -1, 1.4142)); }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; D[i] = Math.min(D[i], pass(x, y, 1, 0, 1), pass(x, y, 0, 1, 1), pass(x, y, 1, 1, 1.4142), pass(x, y, -1, 1, 1.4142)); }
  return D;
}
function regionStats(R, n, W, H) {
  const area = new Float64Array(n), sx = new Float64Array(n), sy = new Float64Array(n), adj = Array.from({ length: n }, () => new Map()), border = new Uint8Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, r = R[i]; area[r]++; sx[r] += x; sy[r] += y; if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border[r] = 1;
    if (x < W - 1 && R[i + 1] !== r) { const o = R[i + 1]; adj[r].set(o, (adj[r].get(o) || 0) + 1); adj[o].set(r, (adj[o].get(r) || 0) + 1); }
    if (y < H - 1 && R[i + W] !== r) { const o = R[i + W]; adj[r].set(o, (adj[r].get(o) || 0) + 1); adj[o].set(r, (adj[o].get(r) || 0) + 1); } }
  return { area, adj, border, cx: [...sx].map((v, i) => v / area[i]), cy: [...sy].map((v, i) => v / area[i]) };
}
/* relabel R by mapping old region ids → labels then recompute components */
function rebuild(R, W, H, colOf, fixedOf, groupOf) {
  const c = components(R, W, H); return { R: c.R, n: c.n, col: c.from.map(o => colOf[o]), fixed: c.from.map(o => fixedOf[o]), group: c.from.map(o => groupOf[o]) };
}

/* Remove narrow necks, sharp points and slivers thinner than minW px (opening by a disc). */
function openPieces(st, W, H, minW) {
  const { R } = st, r = minW / 2, D = distT(R, W, H), INF = 1e9;
  const reach = new Float32Array(W * H).fill(INF);
  for (let i = 0; i < W * H; i++) if (D[i] >= r) reach[i] = 0;
  const step = (x, y, dx, dy, w) => { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) return INF; const j = ny * W + nx; return R[j] === R[y * W + x] ? reach[j] + w : INF; };
  for (let k = 0; k < 2; k++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; reach[i] = Math.min(reach[i], step(x, y, -1, 0, 1), step(x, y, 0, -1, 1), step(x, y, -1, -1, 1.4142), step(x, y, 1, -1, 1.4142)); }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; reach[i] = Math.min(reach[i], step(x, y, 1, 0, 1), step(x, y, 0, 1, 1), step(x, y, 1, 1, 1.4142), step(x, y, -1, 1, 1.4142)); }
  }
  const thin = new Uint8Array(W * H); let count = 0;
  for (let i = 0; i < W * H; i++) if (!st.fixed[R[i]] && reach[i] > r + 0.75) { thin[i] = 1; count++; }
  // peel thin pixels into neighbouring (non-thin, different, non-frame) pieces
  for (let round = 0; round < 60 && count; round++) {
    const changes = [];
    for (let i = 0; i < W * H; i++) { if (!thin[i]) continue; const x = i % W, y = (i - x) / W, own = R[i], votes = new Map();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (thin[j] || R[j] === own || st.fixed[R[j]]) continue; votes.set(R[j], (votes.get(R[j]) || 0) + (dx && dy ? 1 : 2)); }
      if (votes.size) { let b = -1, bv = 0; for (const [k, v] of votes) if (v > bv) { bv = v; b = k; } changes.push([i, b]); } }
    if (!changes.length) break;
    for (const [i, b] of changes) { R[i] = b; thin[i] = 0; count--; }
  }
}
function mergeSmall(st, W, H, minA, ppi) {
  for (let round = 0; round < 10; round++) {
    const s = regionStats(st.R, st.n, W, H), target = new Int32Array(st.n).map((_, i) => i), consumed = new Uint8Array(st.n); let merged = 0;
    const order = [...Array(st.n).keys()].filter(i => !st.fixed[i] && s.area[i] < minA).sort((a, b) => s.area[a] - s.area[b]);
    for (const i of order) {
      if (consumed[i]) continue; let best = -1, bs = -Infinity, maxB = 0;
      for (const [o, b] of s.adj[i]) if (!st.fixed[o]) maxB = Math.max(maxB, b);
      for (const [o, b] of s.adj[i]) { if (st.fixed[o] || consumed[o] && target[o] === i) continue; if (b < maxB * 0.3) continue; const sameGroup = st.group[i] >= 0 && st.group[i] === st.group[o]; const sc = b / (maxB || 1) - cdist(st.col[i], st.col[o]) / 400 - (sameGroup ? 5 : 0); if (sc > bs) { bs = sc; best = o; } }
      if (best < 0) continue; let t = best; while (target[t] !== t) t = target[t]; if (t === i) continue;
      target[i] = t; consumed[i] = 1; s.area[t] += s.area[i]; merged++;
    }
    if (!merged) break;
    const fin = i => { let t = i; while (target[t] !== t) t = target[t]; return t; };
    for (let p = 0; p < W * H; p++) st.R[p] = fin(st.R[p]);
    Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group));
  }
}
/* split a region by k-means on pixel coordinates (straight Voronoi cuts) */
function splitRegion(st, W, H, rid, parts, nextGroup) {
  const px = []; for (let i = 0; i < W * H; i++) if (st.R[i] === rid) px.push(i);
  const P = new Float32Array(px.length * 3); px.forEach((p, j) => { P[j * 3] = p % W; P[j * 3 + 1] = Math.floor(p / W); P[j * 3 + 2] = 0; });
  const C = kmeans(P, parts, 12, 3); const base = st.n; st.group[rid] = nextGroup;
  px.forEach((p, j) => { const c = nearestC(C, P[j * 3], P[j * 3 + 1], 0); if (c > 0) st.R[p] = base + c - 1; });
  for (let c = 1; c < C.length; c++) { st.col.push(st.col[rid]); st.fixed.push(0); st.group.push(nextGroup); }
  st.n = base + C.length - 1;
}
function fixCheckers(R, W, H) {
  let changed = 0;
  for (let pass = 0; pass < 6; pass++) { let c = 0;
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) { const i = y * W + x, a = R[i], b = R[i + 1], cc = R[i + W], d = R[i + W + 1];
      if (a === d && b === cc && a !== b) { R[i + 1] = a; c++; } else if (a === d && a !== b && a !== cc) { R[i + 1] = a; c++; } else if (b === cc && b !== a && b !== d) { R[i] = b; c++; } }
    changed += c; if (!c) break; }
  return changed;
}

/* ---------- tracing ---------- */
function traceRegions(R, n, W, H) {
  const VW = W + 1, lab = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : R[y * W + x];
  const nexts = Array.from({ length: n }, () => new Map());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const r = R[y * W + x], m = nexts[r];
    if (lab(x, y - 1) !== r) m.set(y * VW + x, y * VW + x + 1);
    if (lab(x + 1, y) !== r) m.set(y * VW + x + 1, (y + 1) * VW + x + 1);
    if (lab(x, y + 1) !== r) m.set((y + 1) * VW + x + 1, (y + 1) * VW + x);
    if (lab(x - 1, y) !== r) m.set((y + 1) * VW + x, y * VW + x); }
  const rings = nexts.map(m => { const seen = new Set(), out = []; for (const s of m.keys()) { if (seen.has(s)) continue; const ring = []; let v = s, guard = 0; while (!seen.has(v) && guard++ < 1e6) { seen.add(v); ring.push(v); v = m.get(v); if (v === undefined) break; } if (ring.length > 2) out.push(ring); } return out; });
  return { rings, VW };
}
const ringArea = pts => { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function hull(pts) { const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p; const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); } for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); } return lo.slice(0, -1).concat(up.slice(0, -1)); }
function dp(pts, eps, keep, a, b) { let md = 0, mi = -1; const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1; for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L; if (d > md) { md = d; mi = i; } } if (md > eps && mi > 0) { keep[mi] = 1; dp(pts, eps, keep, a, mi); dp(pts, eps, keep, mi, b); } }

function vectorize(R, n, W, H, { smooth = 3, eps = 1 } = {}) {
  const { rings, VW } = traceRegions(R, n, W, H), lab = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : R[y * W + x];
  const vx = v => v % VW, vy = v => Math.floor(v / VW);
  const isJ = v => { const x = vx(v), y = vy(v); const s = new Set([lab(x - 1, y - 1), lab(x, y - 1), lab(x - 1, y), lab(x, y)]); return s.size >= 3; };
  const onB = v => { const x = vx(v), y = vy(v); return x === 0 || y === 0 || x === W || y === H; };
  const nb = new Map(); const addN = (a, b) => { if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
  rings.forEach(rs => rs.forEach(ring => ring.forEach((v, i) => { const w = ring[(i + 1) % ring.length]; addN(v, w); addN(w, v); })));
  const J = new Set(); for (const v of nb.keys()) { const x = vx(v), y = vy(v); if (isJ(v) || ((x === 0 || x === W) && (y === 0 || y === H))) J.add(v); }
  const pos = new Map(); for (const v of nb.keys()) pos.set(v, [vx(v), vy(v)]);
  for (let it = 0; it < smooth; it++) { const np = new Map(); for (const [v, p] of pos) { if (J.has(v)) { np.set(v, p); continue; } const ns = [...nb.get(v)]; if (ns.length !== 2) { np.set(v, p); continue; } const a = pos.get(ns[0]), b = pos.get(ns[1]); let x = 0.5 * p[0] + 0.25 * (a[0] + b[0]), y = 0.5 * p[1] + 0.25 * (a[1] + b[1]); const ox = vx(v), oy = vy(v); if (ox === 0 || ox === W) x = ox; if (oy === 0 || oy === H) y = oy; np.set(v, [x, y]); } for (const [v, p] of np) pos.set(v, p); }
  // chains between junctions → Douglas-Peucker keep set (shared, so neighbours stay gap-free)
  const keep = new Set(J), done = new Set(), ek = (a, b) => a < b ? a + ',' + b : b + ',' + a;
  const walk = (start, first) => { const chain = [start, first]; done.add(ek(start, first)); let prev = start, cur = first, g = 0; while (!J.has(cur) && g++ < 1e6) { const nx = [...nb.get(cur)].find(w => w !== prev && !done.has(ek(cur, w))) ?? [...nb.get(cur)].find(w => w !== prev); if (nx === undefined) break; done.add(ek(cur, nx)); chain.push(nx); prev = cur; cur = nx; if (cur === start) break; } return chain; };
  const simplify = chain => { const pts = chain.map(v => pos.get(v)), k = new Uint8Array(pts.length); k[0] = k[pts.length - 1] = 1; if (chain[0] === chain[chain.length - 1] && pts.length > 3) { const mid = Math.floor(pts.length / 2); k[mid] = 1; dp(pts, eps, k, 0, mid); dp(pts, eps, k, mid, pts.length - 1); } else dp(pts, eps, k, 0, pts.length - 1); chain.forEach((v, i) => { if (k[i]) keep.add(v); }); };
  for (const j of J) for (const w of nb.get(j)) if (!done.has(ek(j, w))) simplify(walk(j, w));
  for (const v of [...nb.keys()].sort((a, b) => a - b)) { if (J.has(v)) continue; for (const w of nb.get(v)) if (!done.has(ek(v, w))) { keep.add(v); J.add(v); simplify(walk(v, w)); J.delete(v); } }
  return rings.map(rs => rs.map(ring => { const k = ring.filter(v => keep.has(v)); return k.map(v => ({ p: pos.get(v).map(c => Math.round(c * 100) / 100), hard: J.has(v) || onB(v) })); }).filter(r => r.length >= 3));
}
/* closed ring → segments with quadratic smoothing through midpoints; junction/border points stay sharp */
function ringSegs(ring) {
  const n = ring.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], segs = []; let s = ring.findIndex(q => q.hard);
  if (s < 0) { const m0 = mid(ring[n - 1].p, ring[0].p); segs.push(['M', ...m0]); for (let i = 0; i < n; i++) { const v = ring[i].p, nx = ring[(i + 1) % n].p; segs.push(['Q', ...v, ...mid(v, nx)]); } segs.push(['Z']); return segs; }
  const R = ring.slice(s).concat(ring.slice(0, s)); segs.push(['M', ...R[0].p]); let atMid = false;
  for (let i = 1; i <= n; i++) { const v = R[i % n], prev = R[i - 1], nx = R[(i + 1) % n];
    if (v.hard) { segs.push(['L', ...v.p]); atMid = false; }
    else { if (!atMid) segs.push(['L', ...mid(prev.p, v.p)]); segs.push(['Q', ...v.p, ...mid(v.p, nx.p)]); atMid = true; } }
  segs.push(['Z']); return segs;
}
const segsToD = segs => segs.map(s => s[0] + (s.length > 1 ? s.slice(1).map(v => +v.toFixed(2)).join(' ') : '')).join('');

/* ---------- main build ---------- */
function glassDefaults() { return { colors: 5, simplicity: 5, widthIn: 12, unit: 'in', focus: true, frame: true, frameIn: 1, line: 'foil116', frameGlass: '' }; }
function glassGeometry(o, aspect) { // aspect = h/w of image
  const fw = o.frame ? o.frameIn : 0, widthIn = Math.max(2, +o.widthIn || 12), heightIn = Math.max(2, o.heightIn ? +o.heightIn : r2(widthIn * aspect));
  const long = Math.max(widthIn, heightIn), ppi = Math.max(160 / long, Math.min(24, 420 / long));
  const gridW = Math.round(widthIn * ppi), gridH = Math.round(heightIn * ppi), f = Math.round(fw * ppi);
  return { widthIn, heightIn, ppi: gridW / widthIn, gridW, gridH, f, innerW: gridW - 2 * f, innerH: gridH - 2 * f };
}
const r2 = n => Math.round(n * 100) / 100;
function glassRules(o) { const s = Math.max(1, Math.min(10, +o.simplicity || 5)); return { minAreaIn: 0.6 + s * 0.35, minWidthIn: 0.3 + s * 0.02, maxAreaIn: 48, blur: 1 + Math.floor(s / 3), majority: 1 + Math.floor(s / 3), eps: 0.6 + s * 0.12, beginnerMax: 35 }; }

/* img: {width,height,data(RGBA)} already sized innerW x innerH */
function glassBuild(img, o) {
  o = { ...glassDefaults(), ...o }; const G = glassGeometry(o, img.aspect || img.height / img.width), rules = glassRules(o);
  if (G.innerW !== img.width || G.innerH !== img.height) throw new Error(`image is ${img.width}×${img.height}, expected ${G.innerW}×${G.innerH}`);
  const W = G.gridW, H = G.gridH, iw = img.width, ih = img.height, ppi = G.ppi, notes = [];
  // float rgb of inner image, blurred
  let F = new Float32Array(iw * ih * 3); for (let i = 0; i < iw * ih; i++) { const a = img.data[i * 4 + 3] / 255; F[i * 3] = img.data[i * 4] * a + 255 * (1 - a); F[i * 3 + 1] = img.data[i * 4 + 1] * a + 255 * (1 - a); F[i * 3 + 2] = img.data[i * 4 + 2] * a + 255 * (1 - a); }
  F = boxBlur(boxBlur(F, iw, ih, rules.blur), iw, ih, Math.max(1, rules.blur - 1));
  // subject focus: flood from the border through background-like colour
  let bgMask = null, bgCol = null;
  if (o.focus) {
    const bp = []; for (let x = 0; x < iw; x++) bp.push(x, (ih - 1) * iw + x); for (let y = 0; y < ih; y++) bp.push(y * iw, y * iw + iw - 1);
    const P = new Float32Array(bp.length * 3); bp.forEach((p, j) => { P[j * 3] = F[p * 3]; P[j * 3 + 1] = F[p * 3 + 1]; P[j * 3 + 2] = F[p * 3 + 2]; });
    const C = kmeans(P, 2, 10, 5), cnt = [0, 0]; bp.forEach((p, j) => cnt[nearestC(C, P[j * 3], P[j * 3 + 1], P[j * 3 + 2])]++);
    bgCol = C[cnt[0] >= cnt[1] ? 0 : 1];
    if (Math.max(...cnt) / bp.length > 0.55) {
      const dd = bp.map((p, j) => cdist([P[j * 3], P[j * 3 + 1], P[j * 3 + 2]], bgCol)).sort((a, b) => a - b), T = Math.max(45, Math.min(160, dd[Math.floor(dd.length * 0.6)] * 2.2 + 30));
      bgMask = new Uint8Array(iw * ih); const st = []; for (const p of bp) if (cdist([F[p * 3], F[p * 3 + 1], F[p * 3 + 2]], bgCol) < T && !bgMask[p]) { bgMask[p] = 1; st.push(p); }
      while (st.length) { const p = st.pop(), x = p % iw, y = (p - x) / iw; for (const q of [x > 0 ? p - 1 : -1, x < iw - 1 ? p + 1 : -1, y > 0 ? p - iw : -1, y < ih - 1 ? p + iw : -1]) if (q >= 0 && !bgMask[q] && cdist([F[q * 3], F[q * 3 + 1], F[q * 3 + 2]], bgCol) < T) { bgMask[q] = 1; st.push(q); } }
      const frac = bgMask.reduce((a, b) => a + b, 0) / (iw * ih);
      if (frac < 0.04 || frac > 0.93) { bgMask = null; notes.push('Couldn’t separate a clear subject from the background, so the whole photo was used.'); }
    } else notes.push('The background is busy, so the whole photo was used. A plain backdrop gives a cleaner subject.');
  }
  // k-means on subject pixels (sampled)
  const k = Math.max(2, Math.min(10, Math.round(o.colors))), idx = []; for (let i = 0; i < iw * ih; i++) if (!bgMask || !bgMask[i]) idx.push(i);
  const stepS = Math.max(1, Math.floor(idx.length / 7000)), S = []; for (let j = 0; j < idx.length; j += stepS) { const p = idx[j]; S.push(F[p * 3], F[p * 3 + 1], F[p * 3 + 2]); }
  const centers = kmeans(new Float32Array(S), bgMask ? Math.max(2, k - 1) : k, 16, 11);
  const BG = centers.length, FRAME = centers.length + 1, colors = centers.map(c => c.slice()); colors[BG] = bgCol ? bgCol.slice() : [235, 235, 235];
  let L = new Int32Array(W * H);
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const p = y * iw + x; L[(y + G.f) * W + x + G.f] = bgMask && bgMask[p] ? BG : nearestC(centers, F[p * 3], F[p * 3 + 1], F[p * 3 + 2]); }
  // majority smoothing inside the design
  for (let it = 0; it < rules.majority; it++) { const N = L.slice(); for (let y = G.f + 1; y < G.f + ih - 1; y++) for (let x = G.f + 1; x < G.f + iw - 1; x++) { const cnt = new Map(); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = L[(y + dy) * W + x + dx]; cnt.set(v, (cnt.get(v) || 0) + 1); } let b = L[y * W + x], bv = 0; for (const [v, c] of cnt) if (c > bv) { bv = c; b = v; } if (bv >= 5) N[y * W + x] = b; } L = N; }
  // frame: 4 straight strips (top/bottom full width, sides between)
  const frameLab = [FRAME, FRAME + 1, FRAME + 2, FRAME + 3];
  if (G.f) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (y < G.f) L[i] = frameLab[0]; else if (y >= H - G.f) L[i] = frameLab[1]; else if (x < G.f) L[i] = frameLab[2]; else if (x >= W - G.f) L[i] = frameLab[3]; } }
  // frame glass: darkest cluster by default
  const dark = colors.slice(0, BG).reduce((a, c) => (c[0] + c[1] + c[2] < a[0] + a[1] + a[2] ? c : a), [255, 255, 255]);
  const frameRGB = o.frameGlass ? (GLASS_PALETTE.find(p => p[0] === o.frameGlass) || []).slice(1) : nearestGlass(dark).rgb;
  for (const f of frameLab) colors[f] = frameRGB.length ? frameRGB : nearestGlass(dark).rgb;
  const isFrame = lab => lab >= FRAME;
  // pieces
  let cc = components(L, W, H);
  let st = { R: cc.R, n: cc.n, col: cc.from.map(l => colors[l]), fixed: cc.from.map(l => isFrame(l) ? 1 : 0), group: cc.from.map(() => -1) };
  const minA = rules.minAreaIn * ppi * ppi, minW = rules.minWidthIn * ppi; let groups = 0;
  mergeSmall(st, W, H, minA * 0.35, ppi);                    // drop speckles first
  openPieces(st, W, H, minW); Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group));
  mergeSmall(st, W, H, minA, ppi);
  let rings;
  for (let round = 0; round < 4; round++) {
    // oversize → split; holes → split through the hole
    let changed = false; const s = regionStats(st.R, st.n, W, H);
    for (let i = 0, n0 = st.n; i < n0; i++) if (!st.fixed[i] && s.area[i] > rules.maxAreaIn * ppi * ppi) { splitRegion(st, W, H, i, Math.ceil(s.area[i] / (rules.maxAreaIn * ppi * ppi * 0.7)), groups++); changed = true; }
    if (changed) Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group));
    if (fixCheckers(st.R, W, H)) { Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group)); mergeSmall(st, W, H, minA, ppi); fixCheckers(st.R, W, H); Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group)); }
    const tr = traceRegions(st.R, st.n, W, H); let holes = 0;
    tr.rings.forEach((rs, i) => { if (rs.length < 2 || st.fixed[i]) return; const pts = rs.map(r => r.map(v => [v % tr.VW, Math.floor(v / tr.VW)])), ar = pts.map(p => Math.abs(ringArea(p))), outer = ar.indexOf(Math.max(...ar));
      pts.forEach((hp, j) => { if (j === outer) return; const cx = Math.round(hp.reduce((a, p) => a + p[0], 0) / hp.length), g = groups++, base = st.n; for (let q = 0; q < W * H; q++) if (st.R[q] === i && q % W >= cx) st.R[q] = base; st.col.push(st.col[i]); st.fixed.push(0); st.group.push(g); st.group[i] = g; st.n++; holes++; }); });
    if (!holes && !changed) break;
    Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group)); mergeSmall(st, W, H, minA, ppi);
  }
  fixCheckers(st.R, W, H); Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group));
  rings = vectorize(st.R, st.n, W, H, { smooth: 3, eps: rules.eps });
  // piece data
  const D = distT(st.R, W, H), s = regionStats(st.R, st.n, W, H), best = new Int32Array(st.n).fill(-1), bestD = new Float32Array(st.n);
  for (let i = 0; i < W * H; i++) { const r = st.R[i]; if (D[i] > bestD[r]) { bestD[r] = D[i]; best[r] = i; } }
  let pieces = [];
  for (let i = 0; i < st.n; i++) {
    const rs = rings[i]; if (!rs || !rs.length) continue;
    const glass = nearestGlass(st.col[i]), outerPts = rs.reduce((a, r) => (r.length > a.length ? r : a), rs[0]).map(q => q.p);
    const areaPx = s.area[i], polyA = Math.abs(ringArea(outerPts)), hA = Math.abs(ringArea(hull(outerPts))) || 1, flags = [];
    const areaIn = areaPx / ppi / ppi, widthIn = bestD[i] * 2 / ppi;
    if (!st.fixed[i]) {
      if (areaIn < rules.minAreaIn * 0.999) flags.push('small');
      if (widthIn < rules.minWidthIn * 0.95) flags.push('narrow');
      if (polyA / hA < 0.62) flags.push('deep-curve');
      if (rs.length > 1) flags.push('hole');
      const sgn = Math.sign(ringArea(outerPts)); let sharp = 0; const R0 = rs[0];
      for (let j = 0; j < R0.length; j++) { if (!R0[j].hard) continue; const a = R0[(j - 1 + R0.length) % R0.length].p, v = R0[j].p, b = R0[(j + 1) % R0.length].p; const ux = a[0] - v[0], uy = a[1] - v[1], wx = b[0] - v[0], wy = b[1] - v[1]; const ang = Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / ((Math.hypot(ux, uy) * Math.hypot(wx, wy)) || 1)))) * 180 / Math.PI; const cross = (v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]); if (Math.sign(cross) === sgn && ang < 32 && Math.hypot(ux, uy) > minW * 0.5) sharp++; }
      if (sharp) flags.push('sharp');
    }
    const lp = best[i] >= 0 ? [best[i] % W + 0.5, Math.floor(best[i] / W) + 0.5] : [s.cx[i], s.cy[i]];
    pieces.push({ id: i, frame: !!st.fixed[i], rgb: glass.rgb, glass: glass.name, src: st.col[i].map(Math.round), segs: rs.map(ringSegs), poly: rs.map(r => r.map(q => q.p)), label: lp.map(v => r2(v)), font: r2(Math.max(4, Math.min(bestD[i] * 1.1, 0.32 * ppi))), areaIn: r2(areaIn), widthIn: r2(widthIn), flags });
  }
  // number top→bottom in 1" bands, left→right
  pieces.sort((a, b) => Math.floor(a.label[1] / ppi) - Math.floor(b.label[1] / ppi) || a.label[0] - b.label[0]); pieces.forEach((p, j) => p.n = j + 1);
  // legend
  const leg = new Map(); for (const p of pieces) { const k = p.glass; const e = leg.get(k) || { glass: k, hex: gHex(p.rgb), count: 0, areaIn: 0, pieces: [] }; e.count++; e.areaIn = r2(e.areaIn + p.areaIn); e.pieces.push(p.n); leg.set(k, e); }
  const legend = [...leg.values()].sort((a, b) => b.areaIn - a.areaIn);
  // difficulty
  const inner = pieces.filter(p => !p.frame), by = f => inner.filter(p => p.flags.includes(f)).map(p => p.n), reasons = [];
  const small = by('small'), narrow = by('narrow'), deep = by('deep-curve'), sharp = by('sharp'), hole = by('hole');
  const smallest = inner.length ? Math.min(...inner.map(p => p.areaIn)) : 0;
  if (pieces.length > rules.beginnerMax) reasons.push(`${pieces.length} pieces — beginners do best with about ${rules.beginnerMax} or fewer (raise Simplicity or lower Colors).`);
  if (deep.length) reasons.push(`Deep inside curves on piece${deep.length > 1 ? 's' : ''} ${listN(deep)} — cut them in several shallow passes, or simplify.`);
  if (sharp.length) reasons.push(`Sharp points on piece${sharp.length > 1 ? 's' : ''} ${listN(sharp)} — points under ~30° snap easily.`);
  if (narrow.length) reasons.push(`Narrow piece${narrow.length > 1 ? 's' : ''} ${listN(narrow)} (under ${fracIn(rules.minWidthIn)} wide).`);
  if (small.length) reasons.push(`Small piece${small.length > 1 ? 's' : ''} ${listN(small)} (under ${rules.minAreaIn.toFixed(1)} sq in).`);
  if (hole.length) reasons.push(`Piece${hole.length > 1 ? 's' : ''} ${listN(hole)} surround another piece — add a lead line to split ${hole.length > 1 ? 'them' : 'it'}.`);
  const difficulty = reasons.length ? 'Intermediate' : 'Beginner';
  if (!reasons.length) reasons.push(`${pieces.length} pieces, all at least ${rules.minAreaIn.toFixed(1)} sq in and ${fracIn(rules.minWidthIn)} wide, no deep curves or sharp points.`);
  const line = GLASS_LINES[o.line] || GLASS_LINES.foil116;
  return { kind: 'glass', version: 1, widthIn: G.widthIn, heightIn: r2(G.gridH / G.ppi), ppi: G.ppi, gridW: W, gridH: H, frameIn: o.frame ? o.frameIn : 0, lineIn: line.in, lineLabel: line.label, pieces, legend, notes,
    stats: { pieces: pieces.length, colors: legend.length, difficulty, reasons, smallestIn: r2(smallest), minAreaIn: r2(rules.minAreaIn), minWidthIn: r2(rules.minWidthIn), flagged: { small, narrow, deep, sharp, hole } }, settings: o };
}
const listN = a => a.length > 6 ? a.slice(0, 6).map(n => '#' + n).join(', ') + ` +${a.length - 6} more` : a.map(n => '#' + n).join(', ');
const fracIn = v => { const s = Math.round(v * 16); return s % 16 === 0 ? s / 16 + '″' : (s % 2 ? s + '/16″' : s % 4 ? s / 2 + '/8″' : s % 8 ? s / 4 + '/4″' : '1/2″'); };

/* source (img/canvas/dataURL) → RGBA at inner design size */
async function glassImageData(src, o) {
  const im = typeof src === 'string' ? await loadImg(src) : src; const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
  const aspect = o.heightIn ? +o.heightIn / (+o.widthIn || 12) : h / w, G = glassGeometry({ ...glassDefaults(), ...o }, aspect);
  const c = document.createElement('canvas'); c.width = G.innerW; c.height = G.innerH; const g = c.getContext('2d', { willReadFrequently: true });
  // cover-fit (crop to the panel’s aspect)
  const s = Math.max(G.innerW / w, G.innerH / h), dw = w * s, dh = h * s; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, (G.innerW - dw) / 2, (G.innerH - dh) / 2, dw, dh);
  const d = g.getImageData(0, 0, c.width, c.height); return { width: d.width, height: d.height, data: d.data, aspect };
}

/* ---------- SVG ---------- */
function glassSVG(P, { cut = false, numbers = true, scaleBar = true } = {}) {
  const lw = P.lineIn * P.ppi, lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const body = P.pieces.map(p => `<path data-piece="${p.n}" d="${p.segs.map(segsToD).join('')}" fill="${cut ? '#ffffff' : gHex(p.rgb)}" fill-rule="evenodd"/>`).join('');
  const lines = P.pieces.map(p => `<path d="${p.segs.map(segsToD).join('')}"/>`).join('');
  const nums = numbers ? P.pieces.map(p => `<text x="${p.label[0]}" y="${p.label[1]}" font-size="${p.font}" fill="${cut || lum(p.rgb) > 140 ? '#000' : '#fff'}">${p.n}</text>`).join('') : '';
  const bar = scaleBar ? `<g class="scale"><rect x="${P.gridW - P.ppi - 4}" y="${P.gridH - 10}" width="${P.ppi}" height="3" fill="#e33"/></g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${P.widthIn}in" height="${P.heightIn}in" viewBox="0 0 ${P.gridW} ${P.gridH}" data-ppi="${P.ppi}">
<title>Stained glass pattern ${P.widthIn}×${P.heightIn} in, ${P.stats.pieces} pieces</title>
<rect width="${P.gridW}" height="${P.gridH}" fill="#fff"/>
<g id="pieces">${body}</g>
<g id="lead" fill="none" stroke="${cut ? '#9a9a9a' : '#1a1a1a'}" stroke-width="${+lw.toFixed(3)}" stroke-linejoin="round">${lines}</g>
${cut ? `<g id="cut" fill="none" stroke="#000" stroke-width="${+(0.012 * P.ppi).toFixed(3)}">${lines}</g>` : ''}
<g id="numbers" font-family="Helvetica, Arial, sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central">${nums}</g>
</svg>`;
}

/* ---------- PDF (real scale, tiled on Letter with alignment marks) ---------- */
function glassPDF(P, { cut = false, guide = null, title = 'Stained glass pattern' } = {}) {
  const doc = new PDFDoc(), M = 36, PW = 612, PH = 792, pw = (PW - 2 * M) / 72, ph = (PH - 2 * M) / 72, ov = 0.5;
  const fits = P.widthIn <= pw && P.heightIn <= ph;
  const cols = fits ? 1 : Math.ceil((P.widthIn - ov) / (pw - ov)), rows = fits ? 1 : Math.ceil((P.heightIn - ov) / (ph - ov)), sx = pw - ov, sy = ph - ov;
  const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], lw = P.lineIn * P.ppi;
  // cover page
  const c = doc.page(); let y = M;
  c.text(M, y, 18, title + (cut ? ' — cut lines' : ''), true); y += 26;
  c.text(M, y, 11, `Finished size ${P.widthIn} × ${P.heightIn} in (${(P.widthIn * 2.54).toFixed(1)} × ${(P.heightIn * 2.54).toFixed(1)} cm) · ${P.stats.pieces} pieces · ${P.lineLabel}${P.frameIn ? ` · ${P.frameIn}″ frame` : ''}`); y += 16;
  c.text(M, y, 12, `Difficulty: ${P.stats.difficulty}`, true); y += 16;
  for (const r of P.stats.reasons) y = c.para(M + 8, y, 520, 9.5, '• ' + r);
  y += 6;
  // preview fit into box
  const boxW = 250, boxH = 300, s = Math.min(boxW / P.gridW, boxH / P.gridH);
  c.op(`q ${f2(s)} 0 0 ${f2(-s)} ${M} ${f2(PH - y)} cm`); drawPieces(c, P, cut, lw); c.op('Q');
  // legend at right
  let ly = y; c.text(M + 270, ly, 11, cut ? 'Pieces' : 'Glass colors', true); ly += 15;
  for (const e of P.legend) { const rgb = [parseInt(e.hex.slice(1, 3), 16), parseInt(e.hex.slice(3, 5), 16), parseInt(e.hex.slice(5, 7), 16)]; c.fill(...rgb).stroke(80, 80, 80).lw(0.5).rect(M + 270, PH - ly - 12, 14, 12, 'B'); c.text(M + 290, ly, 9.5, `${e.glass} — ${e.count} pc, ${e.areaIn.toFixed(1)} sq in`); ly = c.para(M + 290, ly + 12, 230, 7.5, 'Pieces ' + e.pieces.join(', '), false, [90, 90, 90]) + 2; if (ly > 700) break; }
  y = Math.max(y + s * P.gridH + 14, ly + 8);
  if (!fits) { c.text(M, y, 10, `Printed at real size on ${rows * cols} Letter pages (${rows} rows × ${cols} columns). Pages overlap by 1/2″: line up the ⊕ marks and tape.`, true); y += 16; }
  c.text(M, y, 10, 'Print at 100% / “Actual size” (not “Fit”). Check the 1-inch bar on each page with a ruler.'); y += 16;
  const g = guide || glassGuideLocal(P);
  if (y < 640) { c.text(M, y, 11, 'Beginner build guide', true); y += 15; for (const line of [...g.tools.map(t => 'Tool: ' + t), ...g.steps.map((t, i) => (i + 1) + '. ' + t), ...g.tips.map(t => 'Tip: ' + t)]) { if (y > 740) break; y = c.para(M, y, 540, 8.5, line); } }
  footer(c, 'Overview', 1);
  // tiles
  let pg = 2;
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const p = doc.page(), x0 = q * sx, y0 = r * sy, sc = 72 / P.ppi;
    p.op('q').op(`${M} ${M} ${PW - 2 * M} ${PH - 2 * M} re W n`);
    p.op(`${f2(sc)} 0 0 ${f2(-sc)} ${f2(M - x0 * 72)} ${f2(PH - M + y0 * 72)} cm`); drawPieces(p, P, cut, lw);
    // numbers in page coords
    p.op('Q').op('q').op(`${M} ${M} ${PW - 2 * M} ${PH - 2 * M} re W n`);
    for (const pc of P.pieces) { const px = M + (pc.label[0] / P.ppi - x0) * 72, py = PH - M - (pc.label[1] / P.ppi - y0) * 72, fs = Math.max(6, pc.font * sc); if (px < M - 20 || px > PW - M + 20 || py < M - 20 || py > PH - M + 20) continue; const t = String(pc.n), w = t.length * fs * 0.55; p.textAt(px - w / 2, py - fs * 0.35, fs, t, true, cut || lum(pc.rgb) > 140 ? [0, 0, 0] : [255, 255, 255]); }
    // alignment marks in the overlaps (visible on both neighbouring pages)
    p.stroke(220, 0, 0).lw(0.6);
    const mark = (X, Y) => { const px = M + (X - x0) * 72, py = PH - M - (Y - y0) * 72; if (px < M - 1 || px > PW - M + 1 || py < M - 1 || py > PH - M + 1) return; p.line(px - 9, py, px + 9, py).line(px, py - 9, px, py + 9).op(`${f2(px + 5)} ${f2(py)} m ${f2(px)} ${f2(py + 5)} ${f2(px - 5)} ${f2(py)} ${f2(px)} ${f2(py - 5)} c ${f2(px + 5)} ${f2(py)} l S`); };
    for (let k = 1; k < cols; k++) for (const Y of [0.25, P.heightIn / 2, P.heightIn - 0.25]) mark(k * sx + ov / 2, Y);
    for (let k = 1; k < rows; k++) for (const X of [0.25, P.widthIn / 2, P.widthIn - 0.25]) mark(X, k * sy + ov / 2);
    for (let a = 1; a < cols; a++) for (let b = 1; b < rows; b++) mark(a * sx + ov / 2, b * sy + ov / 2);
    p.op('Q');
    footer(p, rows * cols > 1 ? `Row ${r + 1} of ${rows}, column ${q + 1} of ${cols}` : 'Full size', pg++);
  }
  function footer(p, label, n) {
    p.text(M, 14, 8.5, `Scan Lab · ${title}${cut ? ' — cut lines' : ''} · ${label} · page ${n} of ${1 + rows * cols}`, false, [90, 90, 90]);
    p.stroke(0, 0, 0).lw(1).line(PW - M - 72, 18, PW - M, 18).line(PW - M - 72, 14, PW - M - 72, 22).line(PW - M, 14, PW - M, 22); p.text(PW - M - 72, PH - 30, 7, '1 inch — check with a ruler', false, [90, 90, 90]);
  }
  doc.meta = { pages: 1 + rows * cols, rows, cols, scale: 72 / P.ppi };
  return doc;
}
function drawPieces(p, P, cut, lw) {
  for (const pc of P.pieces) { const c = cut ? [255, 255, 255] : pc.rgb; p.fill(...c); p.path(pc.segs.flat()); p.op('f*'); }
  p.stroke(cut ? 150 : 26, cut ? 150 : 26, cut ? 150 : 26).lw(lw).op('1 j');
  for (const pc of P.pieces) { p.path(pc.segs.flat()); p.op('S'); }
  if (cut) { p.stroke(0, 0, 0).lw(0.012 * P.ppi); for (const pc of P.pieces) { p.path(pc.segs.flat()); p.op('S'); } }
}
function glassGuideLocal(P) {
  const came = P.lineIn > 0.15;
  return {
    tools: ['Glass cutter (oil-fed pistol grip is easiest)', 'Running pliers and grozing pliers', 'Glass grinder (or a carborundum stone)', came ? 'Lead came (3/16″ H or U), lead knife/nippers, horseshoe nails, cement' : 'Copper foil tape (7/32″ fits 1/16″ lines) and a burnisher', '60/40 solder, 80–100 W soldering iron, flux and brush', 'Safety glasses, gloves for handling, a bench brush (never sweep glass by hand)', 'Two printed copies of the pattern (one to cut up, one to build on)'],
    steps: ['Print the cut-line sheet at 100% and check the 1-inch bar.', came ? 'Cut the paper pieces apart on the line center (lead came sits in that space).' : 'Cut paper pieces with foil pattern shears (they remove the 1/16″ foil gap).', 'Glue or trace each paper piece onto its glass color from the legend; mind the grain/texture direction.', 'Cut the largest, simplest pieces first, then smaller ones; score once, then run the score with running pliers.', 'Cut inside curves in several shallow scores, removing a little at a time.', 'Grind each piece to the line and check it against the full-size pattern as you go.', came ? 'Build from one corner with a border came, tapping pieces in place with nails, then solder the joints on both sides.' : 'Foil each piece centered, burnish, tack-solder, then run a smooth bead on both sides.', 'Add the frame' + (P.frameIn ? ' pieces' : ' (zinc or U-came)') + ', clean off flux, then apply patina/finishing wax if you like.'],
    tips: ['Score with steady, medium pressure — one pass only; re-scoring dulls the wheel.', 'Number the back of every glass piece with a marker to match the pattern.', 'Keep the pattern pieces under the glass while grinding so shapes stay true.', 'Ventilate when soldering and wash hands afterwards (lead).'],
  };
}
