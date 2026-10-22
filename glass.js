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
function nearestGlass(c, user) {
  let best = GLASS_PALETTE[0], bd = 1e9; for (const p of GLASS_PALETTE) { const d = cdist(c, [p[1], p[2], p[3]]); if (d < bd) { bd = d; best = p; } }
  if (user && user.length) { let ub = null, ud = 1e9; for (const u of user) { const d = cdist(c, [u[1], u[2], u[3]]); if (d < ud) { ud = d; ub = u; } } if (ub && ud <= bd * 1.6 + 45) return { name: ub[0], rgb: [ub[1], ub[2], ub[3]], user: true }; }
  return { name: best[0], rgb: [best[1], best[2], best[3]] };
}
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
function regionStats(R, n, W, H, E) {
  const area = new Float64Array(n), sx = new Float64Array(n), sy = new Float64Array(n), adj = Array.from({ length: n }, () => new Map()), adjE = Array.from({ length: n }, () => new Map()), border = new Uint8Array(n);
  const addE = (a, b, e) => { if (!E) return; adjE[a].set(b, (adjE[a].get(b) || 0) + e); adjE[b].set(a, (adjE[b].get(a) || 0) + e); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, r = R[i]; area[r]++; sx[r] += x; sy[r] += y; if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border[r] = 1;
    if (x < W - 1 && R[i + 1] !== r) { const o = R[i + 1]; adj[r].set(o, (adj[r].get(o) || 0) + 1); adj[o].set(r, (adj[o].get(r) || 0) + 1); addE(r, o, E ? Math.max(E[i], E[i + 1]) : 0); }
    if (y < H - 1 && R[i + W] !== r) { const o = R[i + W]; adj[r].set(o, (adj[r].get(o) || 0) + 1); adj[o].set(r, (adj[o].get(r) || 0) + 1); addE(r, o, E ? Math.max(E[i], E[i + W]) : 0); } }
  return { area, adj, adjE, border, cx: [...sx].map((v, i) => v / area[i]), cy: [...sy].map((v, i) => v / area[i]) };
}
/* relabel R by mapping old region ids → labels then recompute components */
function rebuild(R, W, H, colOf, fixedOf, groupOf, subjOf, advOf) {
  const c = components(R, W, H); return { R: c.R, n: c.n, col: c.from.map(o => colOf[o]), fixed: c.from.map(o => fixedOf[o]), group: c.from.map(o => groupOf[o]), subj: c.from.map(o => subjOf ? subjOf[o] : 0), adv: c.from.map(o => advOf ? advOf[o] || 0 : 0) };
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
  for (let i = 0; i < W * H; i++) if (!st.fixed[R[i]] && !(st.adv && st.adv[R[i]]) && reach[i] > r + 0.75) { thin[i] = 1; count++; }
  // peel thin pixels into neighbouring (non-thin, different, non-frame) pieces
  for (let round = 0; round < 60 && count; round++) {
    const changes = [];
    for (let i = 0; i < W * H; i++) { if (!thin[i]) continue; const x = i % W, y = (i - x) / W, own = R[i], votes = new Map();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (thin[j] || R[j] === own || st.fixed[R[j]] || (st.adv && st.adv[R[j]])) continue; votes.set(R[j], (votes.get(R[j]) || 0) + (dx && dy ? 1 : 2)); }
      if (votes.size) { let b = -1, bv = 0; for (const [k, v] of votes) if (v > bv) { bv = v; b = k; } changes.push([i, b]); } }
    if (!changes.length) break;
    for (const [i, b] of changes) { R[i] = b; thin[i] = 0; count--; }
  }
}
function mergeSmall(st, W, H, minA, ppi) {
  for (let round = 0; round < 10; round++) {
    const s = regionStats(st.R, st.n, W, H, st.E), target = new Int32Array(st.n).map((_, i) => i), consumed = new Uint8Array(st.n); let merged = 0;
    const order = [...Array(st.n).keys()].filter(i => !st.fixed[i] && !(st.adv && st.adv[i]) && s.area[i] < minA).sort((a, b) => s.area[a] - s.area[b]);
    for (const i of order) {
      if (consumed[i]) continue; let best = -1, bs = -Infinity, maxB = 0;
      for (const [o, b] of s.adj[i]) if (!st.fixed[o]) maxB = Math.max(maxB, b);
      for (const [o, b] of s.adj[i]) { if (st.fixed[o] || (st.adv && st.adv[o]) || consumed[o] && target[o] === i) continue; if (b < maxB * 0.3) continue; const sameGroup = st.group[i] >= 0 && st.group[i] === st.group[o], em = st.E ? (s.adjE[i].get(o) || 0) / b : 0, cross = st.subj && st.subj[i] !== st.subj[o]; const sc = b / (maxB || 1) - cdist(st.col[i], st.col[o]) / 400 - (sameGroup ? 5 : 0) - em * 2.5 - (cross ? 4 : 0); if (sc > bs) { bs = sc; best = o; } }
      if (best < 0) continue; let t = best; while (target[t] !== t) t = target[t]; if (t === i) continue;
      target[i] = t; consumed[i] = 1; s.area[t] += s.area[i]; merged++;
    }
    if (!merged) break;
    const fin = i => { let t = i; while (target[t] !== t) t = target[t]; return t; };
    for (let p = 0; p < W * H; p++) st.R[p] = fin(st.R[p]);
    Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv));
  }
}
/* split a region by k-means on pixel coordinates (straight Voronoi cuts) */
function splitRegion(st, W, H, rid, parts, nextGroup) {
  const px = []; for (let i = 0; i < W * H; i++) if (st.R[i] === rid) px.push(i);
  const P = new Float32Array(px.length * 3); px.forEach((p, j) => { P[j * 3] = p % W; P[j * 3 + 1] = Math.floor(p / W); P[j * 3 + 2] = 0; });
  const C = kmeans(P, parts, 12, 3); const base = st.n; st.group[rid] = nextGroup;
  px.forEach((p, j) => { const c = nearestC(C, P[j * 3], P[j * 3 + 1], 0); if (c > 0) st.R[p] = base + c - 1; });
  for (let c = 1; c < C.length; c++) { st.col.push(st.col[rid]); st.fixed.push(0); st.group.push(nextGroup); if (st.subj) st.subj.push(st.subj[rid]); if (st.adv) st.adv.push(0); }
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

function vectorize(R, n, W, H, { smooth = 3, eps = 1, chains = null } = {}) {
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
  const sides = (v, w) => { if (vy(v) === vy(w)) { const x = Math.min(vx(v), vx(w)), y = vy(v); return [lab(x, y - 1), lab(x, y)]; } const y = Math.min(vy(v), vy(w)), x = vx(v); return [lab(x - 1, y), lab(x, y)]; };
  const simplify = chain => { if (chains) chains.push({ v: chain, s: sides(chain[0], chain[1]) }); const pts = chain.map(v => pos.get(v)), k = new Uint8Array(pts.length); k[0] = k[pts.length - 1] = 1; if (chain[0] === chain[chain.length - 1] && pts.length > 3) { const mid = Math.floor(pts.length / 2); k[mid] = 1; dp(pts, eps, k, 0, mid); dp(pts, eps, k, mid, pts.length - 1); } else dp(pts, eps, k, 0, pts.length - 1); chain.forEach((v, i) => { if (k[i]) keep.add(v); }); };
  for (const j of J) for (const w of nb.get(j)) if (!done.has(ek(j, w))) simplify(walk(j, w));
  for (const v of [...nb.keys()].sort((a, b) => a - b)) { if (J.has(v)) continue; for (const w of nb.get(v)) if (!done.has(ek(v, w))) { keep.add(v); J.add(v); simplify(walk(v, w)); J.delete(v); } }
  if (chains) for (const c of chains) c.pts = c.v.filter((v, i) => keep.has(v) || i === 0 || i === c.v.length - 1).map(v => ({ p: pos.get(v).map(q => Math.round(q * 100) / 100), hard: J.has(v) || onB(v) }));
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
/* open chain (junction → junction) rendered exactly like the same stretch of a piece outline */
function chainSegs(pts) {
  const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (n < 2) return [];
  const closed = n > 3 && pts[0].p[0] === pts[n - 1].p[0] && pts[0].p[1] === pts[n - 1].p[1];
  if (closed && !pts.slice(0, -1).some(q => q.hard)) return ringSegs(pts.slice(0, -1)).filter(s => s[0] !== 'Z').concat([['Z']]);
  const segs = [['M', ...pts[0].p]]; let atMid = false;
  for (let i = 1; i < n; i++) { const v = pts[i], prev = pts[i - 1], nx = pts[i + 1];
    if (v.hard || i === n - 1) { segs.push(['L', ...v.p]); atMid = false; }
    else { if (!atMid) segs.push(['L', ...mid(prev.p, v.p)]); segs.push(['Q', ...v.p, ...mid(v.p, nx.p)]); atMid = true; } }
  return segs;
}
const segsToD = segs => segs.map(s => s[0] + (s.length > 1 ? s.slice(1).map(v => +v.toFixed(2)).join(' ') : '')).join('');

/* ---------- structure-preserving segmentation (pattern v2) ---------- */
function gLab(r, g, b) {
  const f0 = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }, R = f0(r), G = f0(g), B = f0(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047, Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B, Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116, fx = f(X), fy = f(Y), fz = f(Z); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function toLab(F, n) { const L = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const c = gLab(F[i * 3], F[i * 3 + 1], F[i * 3 + 2]); L[i * 3] = c[0]; L[i * 3 + 1] = c[1]; L[i * 3 + 2] = c[2]; } return L; }
/* edge-preserving smoothing: iterated 5×5 bilateral filter in Lab */
function bilateral(A, W, H, iters = 2, sr = 10, rad = 2) {
  const ss = rad * 0.8, wsp = []; for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) wsp.push(Math.exp(-(i * i + j * j) / (2 * ss * ss)));
  let a = A; const k2 = 1 / (2 * sr * sr);
  for (let it = 0; it < iters; it++) { const o = new Float32Array(a.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = (y * W + x) * 3, l0 = a[p], a0 = a[p + 1], b0 = a[p + 2]; let s0 = 0, s1 = 0, s2 = 0, ws = 0, q = 0;
      for (let j = -rad; j <= rad; j++) { const yy = y + j; if (yy < 0 || yy >= H) { q += 2 * rad + 1; continue; } for (let i = -rad; i <= rad; i++, q++) { const xx = x + i; if (xx < 0 || xx >= W) continue; const r = (yy * W + xx) * 3, dl = a[r] - l0, da = a[r + 1] - a0, db = a[r + 2] - b0, w = wsp[q] * Math.exp(-(dl * dl + da * da + db * db) * k2); s0 += w * a[r]; s1 += w * a[r + 1]; s2 += w * a[r + 2]; ws += w; } }
      o[p] = s0 / ws; o[p + 1] = s1 / ws; o[p + 2] = s2 / ws; }
    a = o; }
  return a;
}
/* Sobel colour gradient magnitude in Lab, normalised to 0..1 (1 ≈ a clear edge, ΔE ≳ 12 step) */
function sobelEdges(A, W, H) {
  const E = new Float32Array(W * H), at = (x, y, c) => A[((Math.min(H - 1, Math.max(0, y))) * W + Math.min(W - 1, Math.max(0, x))) * 3 + c];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0; for (let c = 0; c < 3; c++) { const wc = c ? 0.8 : 1;
    const gx = at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c);
    const gy = at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c); m += wc * (gx * gx + gy * gy); } E[y * W + x] = Math.sqrt(m) / 8; }
  const srt = Float32Array.from(E).sort(), p97 = srt[Math.floor(srt.length * 0.97)], norm = Math.max(6, p97);
  for (let i = 0; i < E.length; i++) E[i] = Math.min(1, E[i] / norm); return E;
}
/* Canny-style contours: non-max suppression on the colour gradient + hysteresis, short bits dropped, dilated by 1 px.
   Returns 0/1 per pixel; region boundaries that lie on these contours become protected lead lines. */
function contourMap(A, E, W, H, hi = 0.5, lo = 0.22, minLen = 10, dilate = true) {
  const N = W * H, nms = new Uint8Array(N), L = (x, y) => A[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 3];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x, e = E[p]; if (e < lo) continue;
    const gx = L(x + 1, y) - L(x - 1, y), gy = L(x, y + 1) - L(x, y - 1); let dx = 0, dy = 0; const ang = Math.atan2(gy, gx), q = Math.round(((ang + Math.PI) % Math.PI) / (Math.PI / 4)) % 4;
    if (q === 0) dx = 1; else if (q === 1) { dx = 1; dy = 1; } else if (q === 2) dy = 1; else { dx = -1; dy = 1; }
    if (e >= E[p + dy * W + dx] && e >= E[p - dy * W - dx]) nms[p] = e >= hi ? 2 : 1; }
  const out = new Uint8Array(N), st = [], comp = [];
  for (let p = 0; p < N; p++) { if (nms[p] !== 2 || out[p]) continue; comp.length = 0; st.push(p); out[p] = 1;
    while (st.length) { const c = st.pop(); comp.push(c); const x = c % W, y = (c / W) | 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const q = yy * W + xx; if (nms[q] && !out[q]) { out[q] = 1; st.push(q); } } }
    if (comp.length < minLen) for (const c of comp) out[c] = 0; }
  if (!dilate) return out;
  const d = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; if (out[p] || (x > 0 && out[p - 1]) || (x < W - 1 && out[p + 1]) || (y > 0 && out[p - W]) || (y < H - 1 && out[p + W])) d[p] = 1; }
  return d;
}
function blur1(a, W, H, r) { const t = new Float32Array(a.length), o = new Float32Array(a.length); if (r < 1) return Float32Array.from(a);
  for (let y = 0; y < H; y++) { let s = 0, c = 0; for (let x = 0; x <= Math.min(W - 1, r); x++) { s += a[y * W + x]; c++; } for (let x = 0; x < W; x++) { t[y * W + x] = s / c; const ad = x + r + 1, rm = x - r; if (ad < W) { s += a[y * W + ad]; c++; } if (rm >= 0) { s -= a[y * W + rm]; c--; } } }
  for (let x = 0; x < W; x++) { let s = 0, c = 0; for (let y = 0; y <= Math.min(H - 1, r); y++) { s += t[y * W + x]; c++; } for (let y = 0; y < H; y++) { o[y * W + x] = s / c; const ad = y + r + 1, rm = y - r; if (ad < H) { s += t[ad * W + x]; c++; } if (rm >= 0) { s -= t[rm * W + x]; c--; } } }
  return o; }
const otsu01 = (v, n) => { const h = new Array(256).fill(0); for (let i = 0; i < n; i++) h[Math.max(0, Math.min(255, Math.round(v[i] * 255)))]++; let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i]; let sB = 0, wB = 0, best = -1, t = 128; for (let i = 0; i < 256; i++) { wB += h[i]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += i * h[i]; const mB = sB / wB, mF = (sum - sB) / wF, b = wB * wF * (mB - mF) ** 2; if (b > best) { best = b; t = i; } } return t / 255; };
/* Subject mask: plain-backdrop flood fill when it works, otherwise saliency (border-colour contrast × centre prior + edge density), optional Grok box. */
function subjectMask(F, A, E, W, H, o, notes = []) {
  const N = W * H; let mask = null, how = '';
  // 1) plain backdrop flood (works for product-style photos)
  const bp = []; for (let x = 0; x < W; x++) bp.push(x, (H - 1) * W + x); for (let y = 0; y < H; y++) bp.push(y * W, y * W + W - 1);
  const P = new Float32Array(bp.length * 3); bp.forEach((p, j) => { P[j * 3] = A[p * 3]; P[j * 3 + 1] = A[p * 3 + 1]; P[j * 3 + 2] = A[p * 3 + 2]; });
  const C3 = kmeans(P, 3, 10, 5), C2 = kmeans(P, 2, 10, 5), cnt = [0, 0]; bp.forEach((p, j) => cnt[nearestC(C2, P[j * 3], P[j * 3 + 1], P[j * 3 + 2])]++);
  const dLab = (p, c) => Math.hypot(A[p * 3] - c[0], A[p * 3 + 1] - c[1], A[p * 3 + 2] - c[2]);
  if (Math.max(...cnt) / bp.length > 0.8) {
    const bg = C2[cnt[0] >= cnt[1] ? 0 : 1], dd = bp.map(p => dLab(p, bg)).sort((a, b) => a - b), T = Math.max(8, Math.min(30, dd[Math.floor(dd.length * 0.8)] * 2 + 5));
    const bgm = new Uint8Array(N), st = []; for (const p of bp) if (!bgm[p] && dLab(p, bg) < T && E[p] < 0.6) { bgm[p] = 1; st.push(p); }
    while (st.length) { const p = st.pop(), x = p % W, y = (p - x) / W; for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && !bgm[q] && dLab(q, bg) < T && E[q] < 0.6) { bgm[q] = 1; st.push(q); } }
    const fr = 1 - bgm.reduce((a, b) => a + b, 0) / N; if (fr > 0.03 && fr < 0.9) { mask = bgm.map(v => 1 - v); how = 'backdrop'; }
  }
  // 2) saliency
  if (!mask) {
    const con = new Float32Array(N); for (let p = 0; p < N; p++) con[p] = Math.min(...C3.map(c => dLab(p, c)));
    // global colour rarity (histogram contrast): colours that are rare in the photo stand out
    const stp = Math.max(1, Math.floor(N / 6000)), smp = []; for (let p = 0; p < N; p += stp) smp.push(A[p * 3], A[p * 3 + 1], A[p * 3 + 2]);
    const KC = kmeans(new Float32Array(smp), 12, 12, 9), kw = new Float64Array(KC.length), kl = new Int32Array(N); for (let p = 0; p < N; p++) { kl[p] = nearestC(KC, A[p * 3], A[p * 3 + 1], A[p * 3 + 2]); kw[kl[p]]++; }
    const rar = KC.map((c, i) => KC.reduce((s, d, j) => s + kw[j] / N * Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2]), 0)), rmx = Math.max(...rar) || 1;
    const cs = Float32Array.from(con).sort(), c95 = cs[Math.floor(N * 0.95)] || 1; const ed = blur1(E, W, H, Math.max(2, Math.round(Math.max(W, H) / 14))), es = Float32Array.from(ed).sort(), e95 = es[Math.floor(N * 0.95)] || 1;
    const sal = new Float32Array(N), bx = o.subjectBox;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, dx = x / W - 0.5, dy = y / H - 0.5, cw = Math.exp(-(dx * dx + dy * dy) / (2 * 0.3 * 0.3));
      let s = (0.25 * Math.min(1, con[p] / c95) + 0.25 * rar[kl[p]] / rmx + 0.5 * Math.min(1, ed[p] / e95)) * (0.45 + 0.55 * cw);
      if (bx) { const inb = x / W >= bx[0] && x / W <= bx[2] && y / H >= bx[1] && y / H <= bx[3]; s *= inb ? 1.35 : 0.3; } sal[p] = s; }
    const sb = blur1(sal, W, H, 2); let mx = 0; for (let p = 0; p < N; p++) mx = Math.max(mx, sb[p]); for (let p = 0; p < N; p++) sb[p] /= mx || 1;
    const t = Math.max(0.3, otsu01(sb, N)); mask = new Uint8Array(N); for (let p = 0; p < N; p++) mask[p] = sb[p] > t ? 1 : 0; how = bx ? 'grok' : 'saliency';
    if (bx) { // a given subject box is the seed: salient pixels inside it (or the box centre if none stand out)
      let k = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, inb = x / W >= bx[0] && x / W <= bx[2] && y / H >= bx[1] && y / H <= bx[3]; mask[p] = inb && sb[p] > t * 0.6 ? 1 : 0; k += mask[p]; }
      if (k < N * 0.005) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const fx = (x / W - bx[0]) / (bx[2] - bx[0]) - 0.5, fy = (y / H - bx[1]) / (bx[3] - bx[1]) - 0.5; mask[y * W + x] = fx * fx + fy * fy < 0.09 ? 1 : 0; } }
  }
  // refine (GrabCut-style): iterate foreground/background colour models from the saliency seed, smoothed spatially
  if (how === 'saliency' || how === 'grok') {
    const core = mask.slice();
    for (let it = 0; it < 4; it++) {
      const fg = [], bg = [], st2 = Math.max(1, Math.floor(N / 5000)); for (let p = 0; p < N; p += st2) (mask[p] ? fg : bg).push(A[p * 3], A[p * 3 + 1], A[p * 3 + 2]);
      if (fg.length < 30 || bg.length < 30) break;
      const FG = kmeans(new Float32Array(fg), 6, 10, 3), BG = kmeans(new Float32Array(bg), 6, 10, 4), sc = new Float32Array(N);
      for (let p = 0; p < N; p++) { let df = 1e9, dbg = 1e9; for (const c of FG) df = Math.min(df, (A[p * 3] - c[0]) ** 2 + (A[p * 3 + 1] - c[1]) ** 2 + (A[p * 3 + 2] - c[2]) ** 2); for (const c of BG) dbg = Math.min(dbg, (A[p * 3] - c[0]) ** 2 + (A[p * 3 + 1] - c[1]) ** 2 + (A[p * 3 + 2] - c[2]) ** 2); sc[p] = Math.sqrt(dbg) - Math.sqrt(df); }
      const sb2 = blur1(sc, W, H, 2), nm = new Uint8Array(N); for (let p = 0; p < N; p++) nm[p] = sb2[p] > 0 ? 1 : 0;
      // keep only foreground connected to the salient core
      const c2 = components(nm, W, H), keep = new Uint8Array(c2.n); for (let p = 0; p < N; p++) if (core[p] && nm[p]) keep[c2.R[p]] = 1;
      for (let p = 0; p < N; p++) mask[p] = nm[p] && keep[c2.R[p]] ? 1 : 0;
      if (o.subjectBox) { const b = o.subjectBox, mx = (b[2] - b[0]) * 0.15, my = (b[3] - b[1]) * 0.15; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x / W < b[0] - mx || x / W > b[2] + mx || y / H < b[1] - my || y / H > b[3] + my) mask[y * W + x] = 0; }
    }
  }
  // clean: keep big components, fill holes, smooth the outline
  const cc = components(mask, W, H), area = new Array(cc.n).fill(0), touches = new Array(cc.n).fill(0); for (let p = 0; p < N; p++) { area[cc.R[p]]++; const x = p % W, y = (p - x) / W; if (!x || !y || x === W - 1 || y === H - 1) touches[cc.R[p]] = 1; }
  let big = 0; for (let i = 0; i < cc.n; i++) if (cc.from[i] === 1) big = Math.max(big, area[i]);
  for (let p = 0; p < N; p++) { const r = cc.R[p]; if (cc.from[r] === 1 && area[r] < Math.max(N * 0.01, big * 0.2)) mask[p] = 0; else if (cc.from[r] === 0 && !touches[r] && area[r] < N * 0.08) mask[p] = 1; }
  for (let it = 0; it < 2; it++) { const b = blur1(Float32Array.from(mask), W, H, 2); for (let p = 0; p < N; p++) mask[p] = b[p] > 0.5 ? 1 : 0; }
  const fr = mask.reduce((a, b) => a + b, 0) / N;
  if (o.subjectBox && (fr < 0.003 || fr > 0.92)) { const b = o.subjectBox; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const fx = (x / W - b[0]) / Math.max(1e-3, b[2] - b[0]) - 0.5, fy = (y / H - b[1]) / Math.max(1e-3, b[3] - b[1]) - 0.5; mask[y * W + x] = fx * fx + fy * fy < 0.2 ? 1 : 0; } return { mask, how: 'box', frac: mask.reduce((a, v) => a + v, 0) / N }; }
  if (!o.subjectBox && (fr < 0.02 || fr > 0.92)) { notes.push('No clear subject stood out, so detail is spread evenly. Try “Find subject with Grok”, or a photo with a plainer background.'); return { mask: new Uint8Array(N).fill(1), how: 'none', frac: 1 }; }
  return { mask, how, frac: fr };
}
/* SLIC superpixels that never cross the subject outline */
function slic(A, W, H, S, mask, m = 9, iters = 6) {
  const cs = []; for (let y = S / 2; y < H; y += S) for (let x = S / 2; x < W; x += S) { const p = Math.floor(y) * W + Math.floor(x); cs.push([A[p * 3], A[p * 3 + 1], A[p * 3 + 2], x, y, mask[p]]); }
  // extra seeds for mask pixels that no grid seed of their kind covers (thin subjects)
  const N = W * H, lab = new Int32Array(N).fill(-1), dist = new Float32Array(N), wxy = (m / S) ** 2;
  for (let it = 0; it < iters; it++) { dist.fill(Infinity);
    cs.forEach((c, k) => { const x0 = Math.max(0, Math.floor(c[3] - S)), x1 = Math.min(W - 1, Math.ceil(c[3] + S)), y0 = Math.max(0, Math.floor(c[4] - S)), y1 = Math.min(H - 1, Math.ceil(c[4] + S));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const p = y * W + x; if (mask[p] !== c[5]) continue; const dl = A[p * 3] - c[0], da = A[p * 3 + 1] - c[1], db = A[p * 3 + 2] - c[2], dx = x - c[3], dy = y - c[4], d = dl * dl + da * da + db * db + wxy * (dx * dx + dy * dy); if (d < dist[p]) { dist[p] = d; lab[p] = k; } } });
    const acc = cs.map(() => [0, 0, 0, 0, 0, 0]); for (let p = 0; p < N; p++) { const k = lab[p]; if (k < 0) continue; const a = acc[k]; a[0] += A[p * 3]; a[1] += A[p * 3 + 1]; a[2] += A[p * 3 + 2]; a[3] += p % W; a[4] += (p / W) | 0; a[5]++; }
    acc.forEach((a, k) => { if (a[5]) { const c = cs[k]; c[0] = a[0] / a[5]; c[1] = a[1] / a[5]; c[2] = a[2] / a[5]; c[3] = a[3] / a[5]; c[4] = a[4] / a[5]; } });
    if (it === 0) { // seed any unreached pixels (e.g. a subject thinner than the grid)
      for (let p = 0; p < N; p += 1) if (lab[p] < 0) { const x = p % W, y = (p / W) | 0; cs.push([A[p * 3], A[p * 3 + 1], A[p * 3 + 2], x, y, mask[p]]); lab[p] = cs.length - 1; for (let j = -S; j <= S; j++) for (let i = -S; i <= S; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { const q = yy * W + xx; if (lab[q] < 0 && mask[q] === mask[p]) lab[q] = cs.length - 1; } } } }
  }
  for (let p = 0; p < N; p++) if (lab[p] < 0) lab[p] = p > 0 ? lab[p - 1] : 0;
  // make labels connected (and keep the mask split)
  const key = new Int32Array(N); for (let p = 0; p < N; p++) key[p] = lab[p] * 2 + mask[p]; return components(key, W, H);
}
/* Hierarchical region merging by boundary strength: always merge across the weakest boundary first (mean colour-edge strength
   along the shared border + colour difference), so the strongest contours — silhouette, eyes, petals, windows — survive longest.
   Stops when subject and background reach their piece budgets; the silhouette is never crossed except to absorb a crumb. */
function ragMerge(R0, n0, A, E, mask, W, H, prm) {
  const N = W * H; let R = R0, n = n0, phase = 1;
  for (let pass = 0; pass < 800; pass++) {
    const area = new Float64Array(n), s = new Float64Array(n * 3), sm = new Float64Array(n), feat = new Float64Array(n), edges = new Map();
    for (let p = 0; p < N; p++) { const r = R[p]; area[r]++; s[r * 3] += A[p * 3]; s[r * 3 + 1] += A[p * 3 + 1]; s[r * 3 + 2] += A[p * 3 + 2]; sm[r] += mask[p]; if (prm.featMap) feat[r] += prm.featMap[p]; }
    const addE = (a, b, e) => { if (a === b) return; const k = a < b ? a * 1048576 + b : b * 1048576 + a; const v = edges.get(k); if (v) { v[0]++; v[1] += e; } else edges.set(k, [1, e]); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; if (x < W - 1) addE(R[p], R[p + 1], Math.max(E[p], E[p + 1])); if (y < H - 1) addE(R[p], R[p + W], Math.max(E[p], E[p + W])); }
    const subj = i => sm[i] / area[i] > 0.5, isF = i => feat[i] / area[i] > 0.5; let ns = 0, nb = 0, as = 0, ab = 0;
    for (let i = 0; i < n; i++) if (subj(i)) { ns++; as += area[i]; } else { nb++; ab += area[i]; }
    const budS = Math.max(1, Math.round(as / prm.subjT)), budB = Math.max(1, Math.round(ab / prm.bgT)), overS = ns > budS, overB = nb > budB;
    const cand = [];
    for (const [k, [len, es]] of edges) {
      const a = Math.floor(k / 1048576), b = k % 1048576, sa = subj(a), sb = subj(b), mn = Math.min(area[a], area[b]), em = es / len;
      const dl = s[a * 3] / area[a] - s[b * 3] / area[b], da = s[a * 3 + 1] / area[a] - s[b * 3 + 1] / area[b], db = s[a * 3 + 2] / area[a] - s[b * 3 + 2] / area[b], dE = Math.sqrt(dl * dl + da * da + db * db);
      // boundary strength: short borders between big regions are weak evidence; tiny crumbs always go
      let cost = em * 3 + dE / 30 + (isF(a) || isF(b) ? em * 2 : 0);
      if (phase === 1) {
        if (sa !== sb) { if (!prm.keepSil || mn < prm.crumb) cost += 4; else continue; }
        else if (mn >= prm.crumb) {
          const over = sa ? overS : overB, capped = ns + nb > prm.hardCap;
          if (!over && em > prm.weakT) continue;                 // under budget: only erase weak boundaries
          if (over && !capped && em > prm.strongT && sa) continue; // keep strong subject contours past the budget (up to the hard cap)
        }
        const size = area[a] + area[b]; if (mn >= prm.crumb && size > (sa ? prm.subjMax : prm.bgMax)) continue;
        cost = cost * Math.min(1.5, Math.sqrt(mn / (sa ? prm.subjT : prm.bgT))) + 0.05 * size / (sa ? prm.subjT : prm.bgT) - (mn < prm.crumb ? 5 : 0);
      } else { if (mn >= prm.absMin) continue;
        if (prm.advMin && mn >= prm.advMin) { const sm0 = area[a] < area[b] ? a : b; if ((subj(sm0) || prm.geo || isF(sm0)) && ((dE >= prm.advDE * (isF(sm0) ? 0.6 : 1) && em > 0.25) || em >= 0.6)) continue; }
        cost += (sa !== sb ? 2 : 0) - 0.3 * Math.log(1 + prm.absMin / mn); }
      cand.push([cost, a, b]);
    }
    if (!cand.length) { if (phase === 1) { phase = 2; continue; } break; }
    cand.sort((x, y) => x[0] - y[0]); const par = new Int32Array(n).map((_, i) => i), used = new Uint8Array(n); let merged = 0;
    const lim = Math.max(1, Math.ceil(Math.min(cand.length * 0.08, Math.max(ns - budS, 0) * 0.3 + Math.max(nb - budB, 0) * 0.3 + 4)));
    for (const [, a, b] of cand) { if (used[a] || used[b]) continue; used[a] = used[b] = 1; par[b] = a; if (++merged >= lim) break; }
    const nR = new Int32Array(N); for (let p = 0; p < N; p++) nR[p] = par[R[p]]; const c = components(nR, W, H); R = c.R; n = c.n;
  }
  return { R, n };
}
/* Buildings: share of strong edges that run horizontal/vertical (natural photos ≈ 0.27, façades ≥ 0.5) */
function axisEdgeFrac(A, E, W, H) {
  let ax = 0, all = 0; const L = (x, y) => A[(y * W + x) * 3];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; if (E[p] < 0.35) continue; const gx = L(x + 1, y) - L(x - 1, y), gy = L(x, y + 1) - L(x, y - 1); if (Math.abs(gx) + Math.abs(gy) < 4) continue; all++; let a = Math.abs(Math.atan2(gy, gx) * 180 / Math.PI) % 90; if (a > 45) a = 90 - a; if (a < 10) ax++; }
  return all > W * H * 0.02 ? ax / all : 0;
}
/* Rectilinear over-segmentation (recursive XY-cut along horizontal/vertical edge lines). Weak cuts are merged away later, so
   what survives are rectangles and rectangle unions: windows, doors, panels, roof bands. */
function xyCut(A, W, H, minSide, cap, covT = 0.3) {
  const N = W * H, gv = new Float32Array(N), gh = new Float32Array(N), d3 = (p, q) => Math.hypot(A[p * 3] - A[q * 3], A[p * 3 + 1] - A[q * 3 + 1], A[p * 3 + 2] - A[q * 3 + 2]);
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) gv[y * W + x] = d3(y * W + x, y * W + x - 1);
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) gh[y * W + x] = d3(y * W + x, (y - 1) * W + x);
  const srt = Float32Array.from(gv).sort(), Te = Math.max(5, srt[Math.floor(N * 0.85)]);
  const cps = new Int32Array((W + 1) * (H + 1)), rps = new Int32Array((W + 1) * (H + 1)); // column prefix of vertical edges, row prefix of horizontal edges
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) cps[x * (H + 1) + y + 1] = cps[x * (H + 1) + y] + (gv[y * W + x] > Te || (x > 0 && gv[y * W + x - 1] > Te * 1.3) || (x < W - 1 && gv[y * W + x + 1] > Te * 1.3) ? 1 : 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rps[y * (W + 1) + x + 1] = rps[y * (W + 1) + x] + (gh[y * W + x] > Te || (y > 0 && gh[(y - 1) * W + x] > Te * 1.3) || (y < H - 1 && gh[(y + 1) * W + x] > Te * 1.3) ? 1 : 0);
  const best = r => { const [x0, y0, x1, y1] = r; let b = null;
    for (let x = x0 + minSide; x <= x1 - minSide; x++) { const c = (cps[x * (H + 1) + y1] - cps[x * (H + 1) + y0]) / (y1 - y0); if (!b || c > b.s) b = { s: c, v: 1, at: x }; }
    for (let y = y0 + minSide; y <= y1 - minSide; y++) { const c = (rps[y * (W + 1) + x1] - rps[y * (W + 1) + x0]) / (x1 - x0); if (!b || c > b.s) b = { s: c, v: 0, at: y }; }
    return b && b.s >= covT ? b : null; };
  const done = [], q = [[0, 0, W, H]].map(r => ({ r, b: best(r) }));
  while (q.length && done.length + q.length < cap) { q.sort((a, b) => (b.b ? b.b.s : -1) - (a.b ? a.b.s : -1)); const it = q.shift(); if (!it.b) { done.push(it.r); continue; }
    const [x0, y0, x1, y1] = it.r, k = it.b.at, kids = it.b.v ? [[x0, y0, k, y1], [k, y0, x1, y1]] : [[x0, y0, x1, k], [x0, k, x1, y1]]; for (const r of kids) q.push({ r, b: best(r) }); }
  const rects = done.concat(q.map(i => i.r)), L = new Int32Array(N); rects.forEach(([x0, y0, x1, y1], i) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) L[y * W + x] = i; });
  return components(L, W, H);
}
/* Painted detail lines: strong interior contours (eyes, nose, ear and fur edges, window bars…) that did not become lead lines.
   Optional — painted with glass paint / trace paint, or soldered as foil overlay; never cut. Returns open polylines in grid px. */
function detailLines(thin, allow, D, st, G, iw, ih, ppi, budgetPx, straight = false) {
  const N = iw * ih, on = new Uint8Array(N), W = G.gridW;
  for (let y = 1; y < ih - 1; y++) for (let x = 1; x < iw - 1; x++) { const p = y * iw + x; if (!thin[p] || !allow[p]) continue; const g = (y + G.f) * W + x + G.f; if (D[g] <= 2.5 || st.fixed[st.R[g]]) continue; on[p] = 1; }
  const seen = new Uint8Array(N), lines = [], nb = p => { const x = p % iw, y = (p / iw) | 0, o = []; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { if (!i && !j) continue; const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= iw || yy >= ih) continue; const q = yy * iw + xx; if (on[q] && !seen[q]) o.push(q); } return o; };
  const deg = p => { const x = p % iw, y = (p / iw) | 0; let c = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if ((i || j) && on[(y + j) * iw + x + i]) c++; return c; };
  const walk = s => { const pts = [s]; seen[s] = 1; let c = s; for (;;) { const n = nb(c); if (!n.length) break; const cx = c % iw, cy = (c / iw) | 0; n.sort((a, b) => (Math.abs(a % iw - cx) + Math.abs(((a / iw) | 0) - cy)) - (Math.abs(b % iw - cx) + Math.abs(((b / iw) | 0) - cy))); c = n[0]; seen[c] = 1; pts.push(c); } return pts; };
  const starts = []; for (let p = 0; p < N; p++) if (on[p] && deg(p) === 1) starts.push(p); for (let p = 0; p < N; p++) if (on[p]) starts.push(p);
  for (const s of starts) { if (seen[s]) continue; const a = walk(s); if (a.length < Math.max(6, ppi * 0.3)) continue;
    let pts = a.map(p => [p % iw + G.f + 0.5, ((p / iw) | 0) + G.f + 0.5]); pts = pts.map((p, i) => { const q = pts.slice(Math.max(0, i - 2), i + 3); return [q.reduce((s, v) => s + v[0], 0) / q.length, q.reduce((s, v) => s + v[1], 0) / q.length]; });
    const k = new Uint8Array(pts.length); k[0] = k[pts.length - 1] = 1; dp(pts, straight ? 1.6 : 0.7, k, 0, pts.length - 1); const kp = pts.filter((_, i) => k[i]);
    if (straight) { // buildings: keep only straight horizontal/vertical runs (bars, frames, mullions), snapped to the axis
      for (let i = 1; i < kp.length; i++) { const [x1, y1] = kp[i - 1], [x2, y2] = kp[i], L = Math.hypot(x2 - x1, y2 - y1); if (L < ppi * 0.5) continue; const ang = Math.abs(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI) % 90; if (Math.min(ang, 90 - ang) > 10) continue;
        const hz = Math.abs(x2 - x1) > Math.abs(y2 - y1), m = hz ? (y1 + y2) / 2 : (x1 + x2) / 2; lines.push({ pts: (hz ? [[x1, m], [x2, m]] : [[m, y1], [m, y2]]).map(p => p.map(v => Math.round(v * 10) / 10)), len: L }); }
      continue; }
    lines.push({ pts: kp.map(p => p.map(v => Math.round(v * 10) / 10)), len: a.length }); }
  lines.sort((a, b) => b.len - a.len); const out = []; let used = 0; for (const l of lines) { if (used + l.len > budgetPx) continue; used += l.len; out.push(l.pts); }
  return out;
}
/* Tap on the subject → a subject box: colour flood from the tap (stops at strong edges), padded so attached parts (a head, a stem) are included. */
async function glassTapBox(src, fx, fy) {
  const im = typeof src === 'string' ? await loadImg(src) : src, w0 = im.naturalWidth || im.width, h0 = im.naturalHeight || im.height, s = Math.min(1, 220 / Math.max(w0, h0)), W = Math.round(w0 * s), H = Math.round(h0 * s);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data, N = W * H, F = new Float32Array(N * 3); for (let i = 0; i < N; i++) { F[i * 3] = d[i * 4]; F[i * 3 + 1] = d[i * 4 + 1]; F[i * 3 + 2] = d[i * 4 + 2]; }
  const A = bilateral(toLab(F, N), W, H, 2, 12, 2), E = sobelEdges(A, W, H), sx = Math.min(W - 1, Math.round(fx * W)), sy = Math.min(H - 1, Math.round(fy * H));
  const seed = [0, 0, 0]; let k = 0; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const x = sx + i, y = sy + j; if (x < 0 || y < 0 || x >= W || y >= H) continue; const p = y * W + x; seed[0] += A[p * 3]; seed[1] += A[p * 3 + 1]; seed[2] += A[p * 3 + 2]; k++; } seed.forEach((v, i) => seed[i] = v / k);
  let m = null;
  for (const T of [10, 14, 19, 25]) { m = new Uint8Array(N); const st = [sy * W + sx]; m[st[0]] = 1; let n = 1;
    while (st.length) { const p = st.pop(), x = p % W, y = (p - x) / W; for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && !m[q] && E[q] < 0.7 && Math.hypot(A[q * 3] - seed[0], A[q * 3 + 1] - seed[1], A[q * 3 + 2] - seed[2]) < T) { m[q] = 1; n++; st.push(q); } }
    if (n > N * 0.004) break; }
  let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0; for (let p = 0; p < N; p++) if (m[p]) { const x = p % W, y = (p / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); n++; }
  if (n > N * 0.5) { x0 = sx - W * 0.15; x1 = sx + W * 0.15; y0 = sy - H * 0.15; y1 = sy + H * 0.15; } // flood leaked into the background: fall back to a box around the tap
  const bw = Math.max(x1 - x0, W * 0.06), bh = Math.max(y1 - y0, H * 0.06), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, px = bw * 0.6, py = bh * 0.85;
  return [Math.max(0, (cx - bw / 2 - px) / W), Math.max(0, (cy - bh / 2 - py) / H), Math.min(1, (cx + bw / 2 + px) / W), Math.min(1, (cy + bh / 2 + py) / H)].map(v => Math.round(v * 1000) / 1000);
}
/* ---------- main build ---------- */
function glassDefaults() { return { colors: 6, simplicity: 4, detail: 7, zoom: true, style: 'auto', smallFeat: 'pieces', paint: true, widthIn: 12, unit: 'in', focus: true, frame: true, frameIn: 1, line: 'foil116', frameGlass: '' }; }
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
  // photo → Lab, edge-preserving smoothing, colour edges
  const n0 = iw * ih; let F = new Float32Array(n0 * 3); for (let i = 0; i < n0; i++) { const a = img.data[i * 4 + 3] / 255; F[i * 3] = img.data[i * 4] * a + 255 * (1 - a); F[i * 3 + 1] = img.data[i * 4 + 1] * a + 255 * (1 - a); F[i * 3 + 2] = img.data[i * 4 + 2] * a + 255 * (1 - a); }
  const A = bilateral(toLab(F, n0), iw, ih, 2, 8 + rules.blur * 2, 2), E = sobelEdges(A, iw, ih);
  const minA = rules.minAreaIn * ppi * ppi, minW = rules.minWidthIn * ppi, det = Math.max(1, Math.min(10, +o.detail || 6)), sim = Math.max(1, Math.min(10, +o.simplicity || 5));
  // subject (with optional Grok box, given in photo coords → panel coords via the crop)
  const cr = img.crop || [0, 0, 1, 1], toIn = b => [(b[0] - cr[0]) / cr[2], (b[1] - cr[1]) / cr[3], (b[2] - cr[0]) / cr[2], (b[3] - cr[1]) / cr[3]].map(v => Math.max(0, Math.min(1, v)));
  const sm = o.focus ? subjectMask(F, A, E, iw, ih, { subjectBox: o.subjectBox ? toIn(o.subjectBox) : null }, notes) : { mask: new Uint8Array(n0).fill(1), how: 'off', frac: 1 };
  let mask = sm.mask, featMap = null;
  if (o.features && o.features.length) { featMap = new Uint8Array(n0); for (const f of o.features) { const bx = toIn(f.box); for (let y = Math.floor(bx[1] * ih); y < Math.ceil(bx[3] * ih); y++) for (let x = Math.floor(bx[0] * iw); x < Math.ceil(bx[2] * iw); x++) featMap[y * iw + x] = 1; } }
  // superpixels → merge across weak edges (detail on subject, big simple pieces behind)
  const subjT = minA * (1 + (10 - det) * 0.15), featT = minA, bgT = minA * (2.5 + sim * 0.5);
  const S0 = Math.max(4, Math.min(9, Math.round(Math.sqrt(minA) * 0.3)));
  const Cm = contourMap(A, E, iw, ih), Ec = new Float32Array(n0); for (let p = 0; p < n0; p++) Ec[p] = Cm[p] ? 1 : E[p] * 0.25;
  const axf = axisEdgeFrac(A, E, iw, ih), geo = o.style === 'geometric' || (o.style !== 'organic' && axf >= 0.5);
  if (geo && o.style !== 'geometric') notes.push('Straight-line style chosen automatically (lots of horizontal/vertical edges, e.g. a building) — windows and doors become rectangles. Switch Style to Organic for curves.');
  if (geo && sm.how !== 'backdrop') { sm.mask.fill(1); sm.how = 'off'; sm.frac = 1; }
  const advMinIn = Math.max(0.35, rules.minAreaIn * 0.18), advMin = o.smallFeat === 'pieces' ? advMinIn * ppi * ppi : 0, advDE = 22;
  const sp = geo ? xyCut(A, iw, ih, Math.max(3, Math.round(Math.sqrt(minA) * 0.35)), Math.round(n0 / (S0 * S0 * 2)), 0.5) : slic(A, iw, ih, S0, mask, 6);
  const rm = ragMerge(sp.R, sp.n, A, Ec, mask, iw, ih, { subjT, featT, bgT, crumb: minA * 0.25, absMin: minA * 0.6, weakT: 0.15, strongT: 0.45 - det * 0.015, hardCap: Math.round(n0 / (minA * 1.5)), subjMax: subjT * 4, bgMax: rules.maxAreaIn * ppi * ppi, keepSil: sm.how !== 'none' && sm.how !== 'off', featMap, advMin, advDE, geo });
  const RN = rm.n, rs3 = new Float64Array(RN * 3), ra = new Float64Array(RN), rsub = new Float64Array(RN);
  for (let p = 0; p < n0; p++) { const r = rm.R[p]; ra[r]++; rs3[r * 3] += F[p * 3]; rs3[r * 3 + 1] += F[p * 3 + 1]; rs3[r * 3 + 2] += F[p * 3 + 2]; rsub[r] += mask[p]; }
  const colors = [...Array(RN).keys()].map(r => [rs3[r * 3] / ra[r], rs3[r * 3 + 1] / ra[r], rs3[r * 3 + 2] / ra[r]]), subjOfLab = [...Array(RN).keys()].map(r => rsub[r] / ra[r] > 0.5 ? 1 : 0);
  // key small features (eyes, nose, windows, door): small but high-contrast regions on the subject are kept as "advanced" pieces
  const advOfLab = new Uint8Array(RN);
  if (advMin) { const rl = new Float64Array(RN * 3), fa = new Float64Array(RN); for (let p = 0; p < n0; p++) { const r = rm.R[p]; rl[r * 3] += A[p * 3]; rl[r * 3 + 1] += A[p * 3 + 1]; rl[r * 3 + 2] += A[p * 3 + 2]; if (featMap) fa[r] += featMap[p]; }
    const bc = new Float64Array(RN), bt = new Float64Array(RN), mnd = new Float64Array(RN).fill(1e9), labOf = r => [rl[r * 3] / ra[r], rl[r * 3 + 1] / ra[r], rl[r * 3 + 2] / ra[r]];
    const pair = (a, b) => { if (a === b) return; const la = labOf(a), lb = labOf(b), d = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]); if (d < mnd[a]) mnd[a] = d; if (d < mnd[b]) mnd[b] = d; };
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const p = y * iw + x, r = rm.R[p]; let edge = false; if (x < iw - 1 && r !== rm.R[p + 1]) { pair(r, rm.R[p + 1]); edge = true; } if (y < ih - 1 && r !== rm.R[p + iw]) { pair(r, rm.R[p + iw]); edge = true; } if (!edge && ((x > 0 && rm.R[p - 1] !== r) || (y > 0 && rm.R[p - iw] !== r))) edge = true; if (edge) { bt[r]++; bc[r] += Cm[p]; } }
    const cand = []; for (let r = 0; r < RN; r++) { const isF = featMap && fa[r] / ra[r] > 0.5; if (ra[r] >= advMin && ra[r] < minA && (subjOfLab[r] || geo || isF) && (mnd[r] >= advDE * (isF ? 0.6 : 1) * 0.8 || bc[r] / Math.max(1, bt[r]) >= 0.6)) cand.push([(mnd[r] + 40 * bc[r] / Math.max(1, bt[r])) * (isF ? 2 : 1), r]); }
    cand.sort((a, b) => b[0] - a[0]).slice(0, 18).forEach(([, r]) => advOfLab[r] = 1); }
  const FRAME = RN; let L = new Int32Array(W * H);
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) L[(y + G.f) * W + x + G.f] = rm.R[y * iw + x];
  const Eg = new Float32Array(W * H); for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) Eg[(y + G.f) * W + x + G.f] = E[y * iw + x];
  // frame: 4 straight strips (top/bottom full width, sides between)
  const frameLab = [FRAME, FRAME + 1, FRAME + 2, FRAME + 3];
  if (G.f) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (y < G.f) L[i] = frameLab[0]; else if (y >= H - G.f) L[i] = frameLab[1]; else if (x < G.f) L[i] = frameLab[2]; else if (x >= W - G.f) L[i] = frameLab[3]; } }
  // frame glass: darkest cluster by default
  const dark = colors.slice(0, RN).reduce((a, c) => (c[0] + c[1] + c[2] < a[0] + a[1] + a[2] ? c : a), [255, 255, 255]);
  const frameRGB = o.frameGlass ? (GLASS_PALETTE.find(p => p[0] === o.frameGlass) || []).slice(1) : nearestGlass(dark).rgb;
  for (const f of frameLab) colors[f] = frameRGB.length ? frameRGB : nearestGlass(dark).rgb;
  const isFrame = lab => lab >= FRAME;
  // pieces
  let cc = components(L, W, H);
  let st = { R: cc.R, n: cc.n, col: cc.from.map(l => colors[l]), fixed: cc.from.map(l => isFrame(l) ? 1 : 0), group: cc.from.map(() => -1), subj: cc.from.map(l => isFrame(l) ? 0 : subjOfLab[l]), adv: cc.from.map(l => isFrame(l) ? 0 : advOfLab[l]), E: Eg }; let groups = 0;
  mergeSmall(st, W, H, minA * 0.35, ppi);                    // drop speckles first
  openPieces(st, W, H, minW); Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv));
  mergeSmall(st, W, H, minA, ppi);
  let rings;
  for (let round = 0; round < 4; round++) {
    // oversize → split; holes → split through the hole
    let changed = false; const s = regionStats(st.R, st.n, W, H);
    for (let i = 0, n0 = st.n; i < n0; i++) if (!st.fixed[i] && s.area[i] > rules.maxAreaIn * ppi * ppi) { splitRegion(st, W, H, i, Math.ceil(s.area[i] / (rules.maxAreaIn * ppi * ppi * 0.7)), groups++); changed = true; }
    if (changed) Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv));
    if (fixCheckers(st.R, W, H)) { Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv)); mergeSmall(st, W, H, minA, ppi); fixCheckers(st.R, W, H); Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv)); }
    const tr = traceRegions(st.R, st.n, W, H); let holes = 0;
    tr.rings.forEach((rs, i) => { if (rs.length < 2 || st.fixed[i]) return; const pts = rs.map(r => r.map(v => [v % tr.VW, Math.floor(v / tr.VW)])), ar = pts.map(p => Math.abs(ringArea(p))), outer = ar.indexOf(Math.max(...ar));
      pts.forEach((hp, j) => { if (j === outer) return; const cx = Math.round(hp.reduce((a, p) => a + p[0], 0) / hp.length), g = groups++, base = st.n; for (let q = 0; q < W * H; q++) if (st.R[q] === i && q % W >= cx) st.R[q] = base; st.col.push(st.col[i]); st.fixed.push(0); st.group.push(g); if (st.subj) st.subj.push(st.subj[i]); if (st.adv) st.adv.push(st.adv[i]); st.group[i] = g; st.n++; holes++; }); });
    if (!holes && !changed) break;
    Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv)); mergeSmall(st, W, H, minA, ppi);
  }
  fixCheckers(st.R, W, H); Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv));
  const chains = []; rings = vectorize(st.R, st.n, W, H, { smooth: geo ? 0 : 3, eps: geo ? 0.75 : rules.eps, chains });
  if (geo) { rings.forEach(rs => rs && rs.forEach(r => r.forEach(q => q.hard = true))); chains.forEach(c => c.pts && c.pts.forEach(q => q.hard = true)); }
  // piece colours: the photo's average under each piece, then grouped into the chosen number of glass colours
  const sa = new Float64Array(st.n * 4); { for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const r = st.R[(y + G.f) * W + x + G.f], q = y * iw + x; if (st.fixed[r]) continue; sa[r * 4] += F[q * 3]; sa[r * 4 + 1] += F[q * 3 + 1]; sa[r * 4 + 2] += F[q * 3 + 2]; sa[r * 4 + 3]++; }
    for (let r = 0; r < st.n; r++) if (sa[r * 4 + 3]) st.col[r] = [sa[r * 4] / sa[r * 4 + 3], sa[r * 4 + 1] / sa[r * 4 + 3], sa[r * 4 + 2] / sa[r * 4 + 3]]; }
  const kc = Math.max(2, Math.min(10, Math.round(o.colors))), qs = [];
  for (let r = 0; r < st.n; r++) if (!st.fixed[r]) { const reps = Math.max(1, Math.min(40, Math.round(sa[r * 4 + 3] / minA * 2))); for (let k = 0; k < reps; k++) qs.push(...st.col[r]); }
  const qC = kmeans(new Float32Array(qs), kc, 20, 13), userCols = (o.userColors || []).map(u => [u.name, ...[1, 3, 5].map(i => parseInt(u.hex.slice(i, i + 2), 16))]);
  const glassOf = r => st.fixed[r] ? { name: o.frameGlass || nearestGlass(dark).name, rgb: st.col[r] } : nearestGlass(qC[nearestC(qC, ...st.col[r])], userCols);
  // piece data
  const D = distT(st.R, W, H), s = regionStats(st.R, st.n, W, H), best = new Int32Array(st.n).fill(-1), bestD = new Float32Array(st.n);
  for (let i = 0; i < W * H; i++) { const r = st.R[i]; if (D[i] > bestD[r]) { bestD[r] = D[i]; best[r] = i; } }
  let pieces = [];
  for (let i = 0; i < st.n; i++) {
    const rs = rings[i]; if (!rs || !rs.length) continue;
    const glass = glassOf(i), outerPts = rs.reduce((a, r) => (r.length > a.length ? r : a), rs[0]).map(q => q.p);
    const areaPx = s.area[i], polyA = Math.abs(ringArea(outerPts)), hA = Math.abs(ringArea(hull(outerPts))) || 1, flags = [];
    const areaIn = areaPx / ppi / ppi, widthIn = bestD[i] * 2 / ppi;
    if (!st.fixed[i]) {
      if (st.adv[i]) flags.push('advanced'); else if (areaIn < rules.minAreaIn * 0.999) flags.push('small');
      if (widthIn < rules.minWidthIn * 0.95) flags.push('narrow');
      if (polyA / hA < 0.62) flags.push('deep-curve');
      if (rs.length > 1) flags.push('hole');
      const sgn = Math.sign(ringArea(outerPts)); let sharp = 0; const R0 = rs[0];
      for (let j = 0; j < R0.length; j++) { if (!R0[j].hard) continue; const a = R0[(j - 1 + R0.length) % R0.length].p, v = R0[j].p, b = R0[(j + 1) % R0.length].p; const ux = a[0] - v[0], uy = a[1] - v[1], wx = b[0] - v[0], wy = b[1] - v[1]; const ang = Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / ((Math.hypot(ux, uy) * Math.hypot(wx, wy)) || 1)))) * 180 / Math.PI; const cross = (v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]); if (Math.sign(cross) === sgn && ang < 32 && Math.hypot(ux, uy) > minW * 0.5) sharp++; }
      if (sharp && !st.adv[i]) flags.push('sharp');
    }
    const lp = best[i] >= 0 ? [best[i] % W + 0.5, Math.floor(best[i] / W) + 0.5] : [s.cx[i], s.cy[i]];
    pieces.push({ id: i, frame: !!st.fixed[i], subj: !!st.subj[i], rgb: glass.rgb, glass: glass.name, user: !!glass.user, src: st.col[i].map(Math.round), segs: rs.map(ringSegs), poly: rs.map(r => r.map(q => q.p)), label: lp.map(v => r2(v)), font: r2(Math.max(4, Math.min(bestD[i] * 1.1, 0.32 * ppi))), areaIn: r2(areaIn), widthIn: r2(widthIn), flags });
  }
  // number top→bottom in 1" bands, left→right
  pieces.sort((a, b) => Math.floor(a.label[1] / ppi) - Math.floor(b.label[1] / ppi) || a.label[0] - b.label[0]); pieces.forEach((p, j) => p.n = j + 1);
  // legend
  const leg = new Map(); for (const p of pieces) { const k = p.glass; const e = leg.get(k) || { glass: k, hex: gHex(p.rgb), count: 0, areaIn: 0, pieces: [] }; e.count++; e.areaIn = r2(e.areaIn + p.areaIn); e.pieces.push(p.n); leg.set(k, e); }
  const legend = [...leg.values()].sort((a, b) => b.areaIn - a.areaIn);
  // difficulty
  const inner = pieces.filter(p => !p.frame), by = f => inner.filter(p => p.flags.includes(f)).map(p => p.n), reasons = [];
  const adv = by('advanced'), small = by('small'), narrow = by('narrow'), deep = by('deep-curve'), sharp = by('sharp'), hole = by('hole');
  const smallest = inner.length ? Math.min(...inner.map(p => p.areaIn)) : 0;
  if (pieces.length > rules.beginnerMax) reasons.push(`${pieces.length} pieces — beginners do best with about ${rules.beginnerMax} or fewer (raise Simplicity or lower Colors).`);
  if (deep.length) reasons.push(`Deep inside curves on piece${deep.length > 1 ? 's' : ''} ${listN(deep)} — cut them in several shallow passes, or simplify.`);
  if (sharp.length) reasons.push(`Sharp points on piece${sharp.length > 1 ? 's' : ''} ${listN(sharp)} — points under ~30° snap easily.`);
  if (narrow.length) reasons.push(`Narrow piece${narrow.length > 1 ? 's' : ''} ${listN(narrow)} (under ${fracIn(rules.minWidthIn)} wide).`);
  if (small.length) reasons.push(`Small piece${small.length > 1 ? 's' : ''} ${listN(small)} (under ${rules.minAreaIn.toFixed(1)} sq in).`);
  if (adv.length) reasons.push(`Advanced piece${adv.length > 1 ? 's' : ''} ${listN(adv)}: small key features (eyes, nose, windows…) kept below the beginner minimum so the picture stays recognizable — cut them last and grind to fit, or set Small features to “Paint”.`);
  if (hole.length) reasons.push(`Piece${hole.length > 1 ? 's' : ''} ${listN(hole)} surround another piece — add a lead line to split ${hole.length > 1 ? 'them' : 'it'}.`);
  const difficulty = reasons.length ? 'Intermediate' : 'Beginner';
  if (!reasons.length) reasons.push(`${pieces.length} pieces, all at least ${rules.minAreaIn.toFixed(1)} sq in and ${fracIn(rules.minWidthIn)} wide, no deep curves or sharp points.`);
  // recognisability proxy: share of the subject's main contours that ended up on a lead line (within 1 px)
  let cOn = 0, cAll = 0; for (let y = 1; y < ih - 1; y++) for (let x = 1; x < iw - 1; x++) { const q = y * iw + x; if (!Cm[q] || !mask[q]) continue; cAll++; const g = (y + G.f) * W + x + G.f, r = st.R[g]; let on = false; for (let j = -2; j <= 2 && !on; j++) for (let i = -2; i <= 2; i++) if (st.R[g + j * W + i] !== r) { on = true; break; } if (on) cOn++; }
  const outlineKept = cAll ? Math.round(cOn / cAll * 100) : 100;
  if (outlineKept < 45 && sm.how !== 'none') notes.push(`Only ${outlineKept}% of the subject’s outlines became lead lines at this size. For more recognisable detail, make the panel larger, lower Simplicity, or raise Detail on subject.`);
  // painted detail: strong interior contours that are not lead lines (subject + must-keep features; whole panel when there is no subject)
  let detail = [], dots = [];
  if (o.paint !== false && o.smallFeat !== 'off') {
    const hasSubj = sm.how !== 'none' && sm.how !== 'off' && !geo, thin = contourMap(A, E, iw, ih, hasSubj ? 0.45 : geo ? 0.5 : 0.62, 0.28, Math.round(ppi * 0.3), false), allow = new Uint8Array(n0);
    if (hasSubj) { const dm = blur1(Float32Array.from(mask), iw, ih, 3); for (let p = 0; p < n0; p++) allow[p] = dm[p] > 0.5 ? 1 : 0; } else allow.fill(1);
    if (featMap) for (let p = 0; p < n0; p++) if (featMap[p]) allow[p] = 1;
    // painted dots: tiny dark features (eyes, pupils, nostrils, a beak tip) below piece size
    const Lb = new Float32Array(n0); for (let p = 0; p < n0; p++) Lb[p] = A[p * 3]; const Lm = blur1(Lb, iw, ih, Math.max(2, Math.round(ppi * 0.25))), dk = new Uint8Array(n0);
    for (let p = 0; p < n0; p++) dk[p] = allow[p] && !geo && Lb[p] < 38 && Lm[p] - Lb[p] > 16 && Math.hypot(A[p * 3 + 1], A[p * 3 + 2]) < 22 ? 1 : 0;
    const dc = components(dk, iw, ih), da = new Float64Array(dc.n), dx = new Float64Array(dc.n), dy = new Float64Array(dc.n), dxx = new Float64Array(dc.n), dyy = new Float64Array(dc.n), dcol = new Float64Array(dc.n * 3), dcon = new Float64Array(dc.n);
    for (let p = 0; p < n0; p++) { const r = dc.R[p]; if (dc.from[r] !== 1) continue; const x = p % iw, y = (p / iw) | 0; da[r]++; dx[r] += x; dy[r] += y; dxx[r] += x * x; dyy[r] += y * y; dcol[r * 3] += F[p * 3]; dcol[r * 3 + 1] += F[p * 3 + 1]; dcol[r * 3 + 2] += F[p * 3 + 2]; dcon[r] += Lm[p] - Lb[p]; }
    const amin = 0.004 * ppi * ppi, amax = 0.12 * ppi * ppi, cands = [];
    for (let r = 0; r < dc.n; r++) { if (dc.from[r] !== 1 || da[r] < amin || da[r] > amax) continue; const cx = dx[r] / da[r], cy = dy[r] / da[r], sx = Math.sqrt(Math.max(0.25, dxx[r] / da[r] - cx * cx)), sy = Math.sqrt(Math.max(0.25, dyy[r] / da[r] - cy * cy)); if (Math.max(sx, sy) / Math.min(sx, sy) > 3.5) continue;
      cands.push({ c: dcon[r] / da[r] * Math.sqrt(da[r]), d: { cx: r2(cx + G.f), cy: r2(cy + G.f), rx: r2(Math.max(1.2, sx * 1.8)), ry: r2(Math.max(1.2, sy * 1.8)), hex: gHex([0, 1, 2].map(k => Math.min(60, dcol[r * 3 + k] / da[r]))) } }); }
    dots = cands.sort((a, b) => b.c - a.c).slice(0, 12).map(x => x.d);
    const Dl = distT(st.R, W, H); detail = detailLines(thin, allow, Dl, st, G, iw, ih, ppi, (iw + ih) * (0.6 + det * 0.18) * (hasSubj ? Math.max(0.35, sm.frac) * 1.6 : geo ? 1.2 : 0.7), geo);
  }
  const silhouette = sm.how === 'none' || sm.how === 'off' ? [] : chains.filter(c => c.s[0] >= 0 && c.s[1] >= 0 && !st.fixed[c.s[0]] && !st.fixed[c.s[1]] && !!st.subj[c.s[0]] !== !!st.subj[c.s[1]]).map(c => chainSegs(c.pts)).filter(s => s.length > 1);
  const line = GLASS_LINES[o.line] || GLASS_LINES.foil116;
  return { kind: 'glass', version: 2, f: G.f, crop: img.crop || [0, 0, 1, 1], subject: { how: sm.how, frac: r2(sm.frac), outlineKept }, silhouette, detail, dots, style: geo ? 'geometric' : 'organic', axisFrac: r2(axf), widthIn: G.widthIn, heightIn: r2(G.gridH / G.ppi), ppi: G.ppi, gridW: W, gridH: H, frameIn: o.frame ? o.frameIn : 0, lineIn: line.in, lineLabel: line.label, pieces, legend, notes,
    stats: { outlineKept, advanced: adv.length, detailLines: detail.length, dots: dots.length, pieces: pieces.length, colors: legend.length, difficulty, reasons, smallestIn: r2(smallest), minAreaIn: r2(rules.minAreaIn), minWidthIn: r2(rules.minWidthIn), flagged: { advanced: adv, small, narrow, deep, sharp, hole } }, settings: o };
}
const listN = a => a.length > 6 ? a.slice(0, 6).map(n => '#' + n).join(', ') + ` +${a.length - 6} more` : a.map(n => '#' + n).join(', ');
const fracIn = v => { const s = Math.round(v * 16); return s % 16 === 0 ? s / 16 + '″' : (s % 2 ? s + '/16″' : s % 4 ? s / 2 + '/8″' : s % 8 ? s / 4 + '/4″' : '1/2″'); };

/* source (img/canvas/dataURL) → RGBA at inner design size. With subject focus + zoom, a small subject is framed to fill the panel. */
function glassSubjectCrop(im, w, h, o) {
  const s = Math.min(1, 160 / Math.max(w, h)), cw = Math.max(8, Math.round(w * s)), ch = Math.max(8, Math.round(h * s)), c = document.createElement('canvas'); c.width = cw; c.height = ch;
  if (o.subjectBox) { const b = o.subjectBox, bw = (b[2] - b[0]) * cw, bh = (b[3] - b[1]) * ch, mw = Math.max(bw * 1.7, cw * 0.2), mh = Math.max(bh * 1.7, ch * 0.2), cx = (b[0] + b[2]) / 2 * cw, cy = (b[1] + b[3]) / 2 * ch;
    const X0 = Math.max(0, Math.min(cw - mw, cx - mw / 2)), Y0 = Math.max(0, Math.min(ch - mh, cy - mh / 2)); return [X0 / cw, Y0 / ch, Math.min(1, mw / cw), Math.min(1, mh / ch)]; }
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, cw, ch); const d = g.getImageData(0, 0, cw, ch).data, n = cw * ch, F = new Float32Array(n * 3); for (let i = 0; i < n; i++) { F[i * 3] = d[i * 4]; F[i * 3 + 1] = d[i * 4 + 1]; F[i * 3 + 2] = d[i * 4 + 2]; }
  const A = bilateral(toLab(F, n), cw, ch, 1, 10, 2), E = sobelEdges(A, cw, ch), m = subjectMask(F, A, E, cw, ch, { subjectBox: o.subjectBox || null }, []);
  if (m.how === 'none' || m.frac > (o.subjectBox ? 0.5 : 0.25)) return [0, 0, 1, 1];
  let x0 = cw, y0 = ch, x1 = 0, y1 = 0; for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (m.mask[y * cw + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (o.subjectBox) { const b = o.subjectBox; x0 = Math.min(x0, b[0] * cw); y0 = Math.min(y0, b[1] * ch); x1 = Math.max(x1, b[2] * cw); y1 = Math.max(y1, b[3] * ch); }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, mx = bw * 0.35 + cw * 0.04, my = bh * 0.35 + ch * 0.04;
  let X0 = Math.max(0, x0 - mx), Y0 = Math.max(0, y0 - my), X1 = Math.min(cw, x1 + 1 + mx), Y1 = Math.min(ch, y1 + 1 + my);
  const minW = cw * (o.subjectBox ? 0.2 : 0.28), minH = ch * (o.subjectBox ? 0.2 : 0.28); if (X1 - X0 < minW) { const c0 = (X0 + X1) / 2; X0 = Math.max(0, Math.min(cw - minW, c0 - minW / 2)); X1 = X0 + minW; } if (Y1 - Y0 < minH) { const c0 = (Y0 + Y1) / 2; Y0 = Math.max(0, Math.min(ch - minH, c0 - minH / 2)); Y1 = Y0 + minH; }
  return [X0 / cw, Y0 / ch, (X1 - X0) / cw, (Y1 - Y0) / ch];
}
async function glassImageData(src, o) {
  const im = typeof src === 'string' ? await loadImg(src) : src; const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height; o = { ...glassDefaults(), ...o };
  const zc = o.focus && o.zoom ? glassSubjectCrop(im, w, h, o) : [0, 0, 1, 1], zw = zc[2] * w, zh = zc[3] * h;
  const aspect = o.heightIn ? +o.heightIn / (+o.widthIn || 12) : zh / zw, G = glassGeometry(o, aspect);
  const c = document.createElement('canvas'); c.width = G.innerW; c.height = G.innerH; const g = c.getContext('2d', { willReadFrequently: true });
  // cover-fit the (zoomed) region into the panel's aspect
  const s = Math.max(G.innerW / zw, G.innerH / zh), vw = G.innerW / s, vh = G.innerH / s, vx = zc[0] * w + (zw - vw) / 2, vy = zc[1] * h + (zh - vh) / 2;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, vx, vy, vw, vh, 0, 0, G.innerW, G.innerH);
  const d = g.getImageData(0, 0, c.width, c.height); return { width: d.width, height: d.height, data: d.data, aspect, crop: [vx / w, vy / h, vw / w, vh / h], zoomed: zc[2] < 0.999 || zc[3] < 0.999 };
}

/* ---------- SVG ---------- */
function glassSVG(P, { cut = false, numbers = true, scaleBar = true, fill = 'glass', photo = null, opacity = 1, lines: showLines = true } = {}) {
  const lw = P.lineIn * P.ppi, lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], colOf = p => cut ? [255, 255, 255] : fill === 'photo' && p.src ? p.src : p.rgb;
  const body = P.pieces.map(p => `<path data-piece="${p.n}" d="${p.segs.map(segsToD).join('')}" fill="${gHex(colOf(p))}" fill-rule="evenodd"/>`).join('');
  const lines = P.pieces.map(p => `<path d="${p.segs.map(segsToD).join('')}"/>`).join('');
  const sil = (P.silhouette || []).map(s => segsToD(s)).join(''), det = (P.detail || []).map(l => 'M' + l.map(q => q.join(' ')).join('L')).join(''), dots = (P.dots || []).map(d => `<ellipse cx="${d.cx}" cy="${d.cy}" rx="${d.rx}" ry="${d.ry}" fill="${cut ? 'none' : d.hex}" stroke="${cut ? '#b0b0b0' : 'none'}"/>`).join('');
  const nums = numbers ? P.pieces.map(p => `<text x="${p.label[0]}" y="${p.label[1]}" font-size="${p.font}" fill="${cut || (opacity > 0.5 && lum(colOf(p)) > 140) ? '#000' : '#fff'}"${opacity <= 0.5 && !cut ? ' stroke="#000" stroke-width="0.6" paint-order="stroke"' : ''}>${p.n}</text>`).join('') : '';
  const bar = scaleBar ? `<g class="scale"><rect x="${P.gridW - P.ppi - 4}" y="${P.gridH - 10}" width="${P.ppi}" height="3" fill="#e33"/></g>` : '';
  let under = '';
  if (photo && P.crop) { const f = P.f != null ? P.f : Math.round(P.frameIn * P.ppi), iw = P.gridW - 2 * f, ih = P.gridH - 2 * f, fw = iw / P.crop[2], fh = ih / P.crop[3];
    under = `<defs><clipPath id="gInner"><rect x="${f}" y="${f}" width="${iw}" height="${ih}"/></clipPath></defs><image href="${photo}" x="${+(f - P.crop[0] * fw).toFixed(2)}" y="${+(f - P.crop[1] * fh).toFixed(2)}" width="${+fw.toFixed(2)}" height="${+fh.toFixed(2)}" preserveAspectRatio="none" clip-path="url(#gInner)"/>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${P.widthIn}in" height="${P.heightIn}in" viewBox="0 0 ${P.gridW} ${P.gridH}" data-ppi="${P.ppi}">
<title>Stained glass pattern ${P.widthIn}×${P.heightIn} in, ${P.stats.pieces} pieces</title>
<rect width="${P.gridW}" height="${P.gridH}" fill="#fff"/>${under}
<g id="pieces"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}>${body}</g>
${showLines ? '' : '<!--'}<g id="lead" fill="none" stroke="${cut ? '#9a9a9a' : '#1a1a1a'}" stroke-width="${+lw.toFixed(3)}" stroke-linejoin="round" stroke-linecap="round">${lines}${sil ? `<path id="silhouette" d="${sil}" stroke-width="${+(lw * 1.6).toFixed(3)}"/>` : ''}</g>${showLines ? '' : '-->'}
${showLines && (det || dots) ? `<g id="detail" fill="none" stroke="${cut ? '#b0b0b0' : '#1a1a1a'}" stroke-width="${+(lw * 0.5).toFixed(3)}" stroke-linecap="round" stroke-linejoin="round"${cut ? ' stroke-dasharray="2 2"' : ''}><path d="${det}"/>${dots}</g>` : ''}
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
  if (P.silhouette && P.silhouette.length) { p.lw(lw * 1.6).op('1 J'); for (const s of P.silhouette) { p.path(s); p.op('S'); } p.op('0 J'); }
  if (P.detail && P.detail.length) { p.stroke(cut ? 170 : 26, cut ? 170 : 26, cut ? 170 : 26).lw(lw * 0.5).op('1 J'); if (cut) p.op('[2 2] 0 d'); for (const l of P.detail) { p.path([['M', ...l[0]], ...l.slice(1).map(q => ['L', ...q])]); p.op('S'); } p.op('[] 0 d 0 J'); }
  for (const d of P.dots || []) { const k = 0.5523, { cx, cy, rx, ry } = d; if (!cut) p.fill(...[1, 3, 5].map(i => parseInt(d.hex.slice(i, i + 2), 16))); else p.stroke(170, 170, 170).lw(lw * 0.4);
    p.op(`${f2(cx + rx)} ${f2(cy)} m ${f2(cx + rx)} ${f2(cy + k * ry)} ${f2(cx + k * rx)} ${f2(cy + ry)} ${f2(cx)} ${f2(cy + ry)} c ${f2(cx - k * rx)} ${f2(cy + ry)} ${f2(cx - rx)} ${f2(cy + k * ry)} ${f2(cx - rx)} ${f2(cy)} c ${f2(cx - rx)} ${f2(cy - k * ry)} ${f2(cx - k * rx)} ${f2(cy - ry)} ${f2(cx)} ${f2(cy - ry)} c ${f2(cx + k * rx)} ${f2(cy - ry)} ${f2(cx + rx)} ${f2(cy - k * ry)} ${f2(cx + rx)} ${f2(cy)} c ${cut ? 'S' : 'f'}`); }
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
