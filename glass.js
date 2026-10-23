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
  ['Clear textured', 232, 236, 238], ['White opal', 246, 244, 236], ['Wispy white', 222, 218, 205], ['Light gray', 170, 174, 178], ['Medium gray', 122, 124, 126], ['Warm gray', 150, 144, 130], ['Charcoal', 70, 72, 76], ['Black opal', 22, 22, 24],
  ['Ruby red', 170, 20, 30], ['Cherry red', 210, 40, 40], ['Pink', 236, 150, 170], ['Rose', 190, 90, 120], ['Orange', 240, 120, 30], ['Amber', 205, 135, 40],
  ['Light amber', 230, 190, 110], ['Gold / yellow', 245, 205, 40], ['Pale yellow', 245, 235, 150], ['Brown', 115, 70, 35], ['Terracotta', 165, 85, 55], ['Tan', 196, 160, 120], ['Olive', 120, 125, 50],
  ['Spring green', 120, 190, 80], ['Emerald green', 20, 130, 70], ['Dark green', 20, 75, 40], ['Teal', 30, 140, 140], ['Aqua', 120, 200, 210], ['Sky blue', 130, 180, 230],
  ['Medium blue', 50, 100, 190], ['Cobalt blue', 25, 45, 150], ['Navy', 20, 30, 80], ['Lavender', 175, 150, 210], ['Purple', 100, 50, 140], ['Flesh / peach', 240, 200, 170],
];
const gHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const cdist = (a, b) => { const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db); };
function glassTraceEnv(o) { return { palette: GLASS_PALETTE, line: GLASS_LINES[o.line] || GLASS_LINES.foil116, frameGlass: o.frameGlass || '', user: (o.userColors || []).filter(u => /^#[0-9a-f]{6}$/i.test(u.hex)).map(u => [u.name, ...[1, 3, 5].map(i => parseInt(u.hex.slice(i, i + 2), 16))]) }; }
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
/* chamfer distance to the nearest set pixel of a 0/1 map (image edges are not boundaries) */
function chamferT(M, W, H) { const D = new Float32Array(W * H); for (let i = 0; i < W * H; i++) D[i] = M[i] ? 0 : 1e9;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!D[i]) continue; let d = D[i]; if (x > 0) d = Math.min(d, D[i - 1] + 1); if (y > 0) { d = Math.min(d, D[i - W] + 1); if (x > 0) d = Math.min(d, D[i - W - 1] + 1.4142); if (x < W - 1) d = Math.min(d, D[i - W + 1] + 1.4142); } D[i] = d; }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (!D[i]) continue; let d = D[i]; if (x < W - 1) d = Math.min(d, D[i + 1] + 1); if (y < H - 1) { d = Math.min(d, D[i + W] + 1); if (x < W - 1) d = Math.min(d, D[i + W + 1] + 1.4142); if (x > 0) d = Math.min(d, D[i + W - 1] + 1.4142); } D[i] = d; }
  return D; }
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
function openPieces(st, W, H, minW, byColor = false) {
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
      if (votes.size) { let b = -1, bv = 0; for (const [k, v0] of votes) { const v = byColor ? v0 / (1 + cdist(st.col[own], st.col[k]) / 20) : v0; if (v > bv) { bv = v; b = k; } } changes.push([i, b]); } }
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

function vectorize(R, n, W, H, { smooth = 3, eps = 1, chains = null, pins = null } = {}) {
  const { rings, VW } = traceRegions(R, n, W, H), lab = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : R[y * W + x];
  const vx = v => v % VW, vy = v => Math.floor(v / VW);
  const isJ = v => { const x = vx(v), y = vy(v); const s = new Set([lab(x - 1, y - 1), lab(x, y - 1), lab(x - 1, y), lab(x, y)]); return s.size >= 3; };
  const onB = v => { const x = vx(v), y = vy(v); return x === 0 || y === 0 || x === W || y === H; };
  const nb = new Map(); const addN = (a, b) => { if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
  rings.forEach(rs => rs.forEach(ring => ring.forEach((v, i) => { const w = ring[(i + 1) % ring.length]; addN(v, w); addN(w, v); })));
  const J = new Set(); for (const v of nb.keys()) { const x = vx(v), y = vy(v); if (isJ(v) || ((x === 0 || x === W) && (y === 0 || y === H))) J.add(v); }
  if (pins) for (const [px, py] of pins) { let bv = -1, bd = 2.5; for (const v of nb.keys()) { const dd = Math.hypot(vx(v) - px, vy(v) - py); if (dd < bd) { bd = dd; bv = v; } } if (bv >= 0) J.add(bv); } // corners that must stay pointed (ear tips, nose)
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
const BOXMASK_CACHE = new Map();
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
  // 2) a subject box (tap / Grok / auto): GrabCut-style colour models seeded by the box; the box is a hint, the mask may grow past it
  if (!mask && o.subjectBox) { const key = [W, H, o.subjectBox.map(v => v.toFixed(4)).join(','), o.cacheKey || ''].join('|'); let c = BOXMASK_CACHE.get(key); if (!c || c.length !== N) { c = boxGrabMask(A, W, H, o.subjectBox, E); BOXMASK_CACHE.set(key, c); if (BOXMASK_CACHE.size > 6) BOXMASK_CACHE.delete(BOXMASK_CACHE.keys().next().value); } mask = c.slice(); how = 'grok'; }
  // 3) saliency
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
  if (how === 'saliency') {
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
/* Box-seeded foreground (tap / Grok / auto box), GrabCut-lite: weighted colour mixtures for subject vs background, a mild
   "inside the box" prior, and edge-aware diffusion of the score (stands in for the graph cut) so the outline follows colour
   edges. Box core = sure subject, outside the region of interest (box grown by 60%) = sure background. */
function boxGrabMask1(A, W, H, bx, E, hullT, closeK, local) {
  let last = null; const N = W * H, x0 = bx[0] * W, y0 = bx[1] * H, x1 = bx[2] * W, y1 = bx[3] * H, bw = Math.max(2, x1 - x0), bh = Math.max(2, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const R0 = [Math.max(0, x0 - bw * 0.25), Math.max(0, y0 - bh * 0.25), Math.min(W, x1 + bw * 0.25), Math.min(H, y1 + bh * 0.25)], roiA = (R0[2] - R0[0]) * (R0[3] - R0[1]);
  const hard = new Int8Array(N), prior = new Float32Array(N), inB = new Uint8Array(N); let mask = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, fx = (x - cx) / bw, fy = (y - cy) / bh, inb = x >= x0 && x < x1 && y >= y0 && y < y1;
    if (fx * fx + fy * fy < 0.14 * 0.14) hard[p] = 1; else if (x < R0[0] || x >= R0[2] || y < R0[1] || y >= R0[3]) hard[p] = -1;
    prior[p] = inb ? 0.03 : -0.1; mask[p] = inb ? 1 : 0; inB[p] = inb ? 1 : 0; }
  // edge weights (right, down) from colour difference
  const wr = new Float32Array(N), wd = new Float32Array(N), dd = (p, q) => (A[p * 3] - A[q * 3]) ** 2 + (A[p * 3 + 1] - A[q * 3 + 1]) ** 2 + (A[p * 3 + 2] - A[q * 3 + 2]) ** 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; if (x < W - 1) wr[p] = Math.exp(-dd(p, p + 1) / (2 * 5 * 5)); if (y < H - 1) wd[p] = Math.exp(-dd(p, p + W) / (2 * 5 * 5)); }
  const gmm = (S, kmax = 7) => { const k = Math.min(S.length / 3 / 20 | 0, kmax); if (k < 1) return null; const C = kmeans(new Float32Array(S), k, 8, 5), w = new Float64Array(C.length); for (let i = 0; i < S.length; i += 3) w[nearestC(C, S[i], S[i + 1], S[i + 2])]++; const t = w.reduce((a, b) => a + b, 0); return C.map((c, i) => [c, w[i] / t]).filter(c => c[1] > 0.01); };
  const ll = (p, M) => { let s = 1e-9; for (const [c, w] of M) s += w * Math.exp(-((A[p * 3] - c[0]) ** 2 + (A[p * 3 + 1] - c[1]) ** 2 + (A[p * 3 + 2] - c[2]) ** 2) / (2 * 9 * 9)); return Math.log(s); };
  for (let it = 0; it < 3; it++) {
    const fg = [], bg = [], stp = Math.max(1, Math.floor(N / 6000)); for (let p = 0; p < N; p += stp) { if (mask[p] && inB[p]) fg.push(A[p * 3], A[p * 3 + 1], A[p * 3 + 2]); else if (!mask[p]) bg.push(A[p * 3], A[p * 3 + 1], A[p * 3 + 2]); }
    const MF = gmm(fg), MB = gmm(bg); if (!MF || !MB) break;
    // local background models: what the background looks like near each pixel (a dark wing beside a pale post is not background
    // just because the ground at the bottom of the photo is dark too)
    const GC = 6, cw = W / GC, chh = H / GC, cellOf = p => Math.min(GC - 1, Math.floor((p % W) / cw)) + GC * Math.min(GC - 1, Math.floor(((p / W) | 0) / chh)), cellS = Array.from({ length: GC * GC }, () => []);
    const stp2 = Math.max(1, Math.floor(N / 8000)); if (local) for (let p = 0; p < N; p += stp2) if (!mask[p]) cellS[cellOf(p)].push(A[p * 3], A[p * 3 + 1], A[p * 3 + 2]);
    const MBl = []; if (local) for (let cy2 = 0; cy2 < GC; cy2++) for (let cx2 = 0; cx2 < GC; cx2++) { let S = []; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const a = cx2 + i, b = cy2 + j; if (a >= 0 && b >= 0 && a < GC && b < GC) { const cs = cellS[b * GC + a], st3 = Math.max(1, Math.floor(cs.length / 3 / 70)); for (let q = 0; q < cs.length; q += 3 * st3) S.push(cs[q], cs[q + 1], cs[q + 2]); } } MBl.push(S.length >= 90 ? gmm(S, 4) || MB : MB); }
    const memo = new Map(), qk = p => ((Math.round(A[p * 3] / 3) * 90 + Math.round((A[p * 3 + 1] + 128) / 3)) * 90 + Math.round((A[p * 3 + 2] + 128) / 3)) * (local ? GC * GC : 1) + (local ? cellOf(p) : 0);
    const u = new Float32Array(N), x = new Float32Array(N); for (let p = 0; p < N; p++) { if (hard[p]) { u[p] = hard[p] * 2; x[p] = u[p]; continue; } const k = qk(p); let d = memo.get(k); if (d === undefined) { d = Math.max(-1.5, Math.min(1.5, (ll(p, MF) - (local ? Math.max(ll(p, MBl[cellOf(p)]), ll(p, MB) - 1.5) : ll(p, MB))) / 2)); memo.set(k, d); } u[p] = d + prior[p]; x[p] = u[p]; }
    const lam = 0.12; for (let k = 0; k < 120; k++) { const dir = k & 1; for (let yy = 0; yy < H; yy++) { const y = dir ? H - 1 - yy : yy; for (let xx = 0; xx < W; xx++) { const xq = dir ? W - 1 - xx : xx, p = y * W + xq; if (hard[p]) continue;
          let sw = lam, sv = lam * u[p]; if (xq > 0) { sw += wr[p - 1]; sv += wr[p - 1] * x[p - 1]; } if (xq < W - 1) { sw += wr[p]; sv += wr[p] * x[p + 1]; } if (y > 0) { sw += wd[p - W]; sv += wd[p - W] * x[p - W]; } if (y < H - 1) { sw += wd[p]; sv += wd[p] * x[p + W]; } x[p] = sv / sw; } } }
    const nm = new Uint8Array(N); for (let p = 0; p < N; p++) nm[p] = x[p] > 0 ? 1 : 0;
    const c2 = components(nm, W, H), kp = new Uint8Array(c2.n); for (let p = 0; p < N; p++) if (hard[p] === 1) kp[c2.R[p]] = 1;
    mask = new Uint8Array(N); for (let p = 0; p < N; p++) mask[p] = nm[p] && kp[c2.R[p]] ? 1 : 0; last = [MF, MB];
  }
  const m1 = mask.slice(), fr = m => { let a = 0; for (let p = 0; p < N; p++) a += m[p]; return a / roiA; };
  // stage 2: watershed on the colour gradient between confident markers settles what colour alone cannot (shadowed belly vs dark background)
  if (last && E) { const lab = new Int8Array(N), er = blur1(Float32Array.from(mask), W, H, 2), dmin = (p, M) => Math.min(...M.map(([c]) => Math.hypot(A[p * 3] - c[0], A[p * 3 + 1] - c[1], A[p * 3 + 2] - c[2])));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; if (hard[p] === 1 || er[p] > 0.97) lab[p] = 1; else if (hard[p] === -1 || x < 2 || y < 2 || x >= W - 2 || y >= H - 2) lab[p] = 2; else if (!mask[p] && dmin(p, last[1]) < 7 && dmin(p, last[0]) > 22) lab[p] = 2; }
    const Q = Array.from({ length: 256 }, () => []), lev = p => Math.min(255, Math.round(E[p] * 255)), NB = [-1, 1, -W, W], ok = (q, o, x) => q >= 0 && q < N && !(o === -1 && x === 0) && !(o === 1 && x === W - 1);
    for (let p = 0; p < N; p++) if (lab[p]) { const x = p % W; for (const o of NB) { const q = p + o; if (ok(q, o, x) && !lab[q]) Q[lev(q)].push(q * 4 + lab[p]); } }
    for (let l = 0; l < 256; l++) { const b = Q[l]; while (b.length) { const v = b.pop(), q = v >> 2, L = v & 3; if (lab[q]) continue; lab[q] = L; const x = q % W; for (const o of NB) { const r = q + o; if (ok(r, o, x) && !lab[r]) Q[Math.max(l, lev(r))].push(r * 4 + L); } } }
    for (let p = 0; p < N; p++) mask[p] = lab[p] === 1 ? 1 : 0; }
  if (fr(mask) > 0.8) mask.set(m1);
  // stage 3: close concave gaps the edges could not (radius ~ subject size), never adding clearly-background colours
  if (last && closeK) { let ar = 0; for (let p = 0; p < N; p++) ar += mask[p]; const r = closeK * Math.sqrt(ar), dOut = chamferT(mask, W, H), dil = new Uint8Array(N); for (let p = 0; p < N; p++) dil[p] = dOut[p] <= r ? 1 : 0;
    const inv = dil.map(v => 1 - v), dIn = chamferT(inv, W, H), dmin = (p, M) => Math.min(...M.map(([c]) => Math.hypot(A[p * 3] - c[0], A[p * 3 + 1] - c[1], A[p * 3 + 2] - c[2])));
    for (let p = 0; p < N; p++) if (!mask[p] && dIn[p] > r && hard[p] !== -1 && !(dmin(p, last[1]) < 6 && dmin(p, last[0]) > 30)) mask[p] = 1; }
  // shape prior: bodies are blob-like, so fill the convex hull of what was found except pixels that clearly look like background
  if (last && hullT) { const pts = []; for (let y = 0; y < H; y++) { let a = -1, b = -1; for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (a < 0) a = x; b = x; } if (a >= 0) { pts.push([a, y], [b + 1, y]); } }
    const keep0 = mask.slice(), hp = hull(pts); if (hp.length >= 3) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; if (mask[p] || hard[p] === -1) continue; let ins = true; for (let i = 0; i < hp.length && ins; i++) { const [ax, ay] = hp[i], [bx2, by2] = hp[(i + 1) % hp.length]; if ((bx2 - ax) * (y - ay) - (by2 - ay) * (x - ax) < 0) ins = false; } if (ins && ll(p, last[0]) - ll(p, last[1]) > -hullT) mask[p] = 1; } }
  if (last && hullT && fr(mask) > 0.85) return fr(m1) <= 0.85 ? m1 : mask;
  return mask;
}
/* The box is only a hint, and colour alone is ambiguous for shadowed parts. Try a few readings — the box as given, grown, shifted
   down (bodies, tails and legs usually hang below the colourful patch a tap or a detector finds) × global or local background
   colour models — at half resolution, keep the one whose outline sits on real edges and does not run along the search limit (a leak),
   then redo that one at full resolution. */
function boxGrabMask(A, W, H, bx, E = null, hullT = 3, closeK = 0.4) {
  if (!E) return boxGrabMask1(A, W, H, bx, E, hullT, closeK, false);
  const W2 = W >> 1, H2 = H >> 1, A2 = new Float32Array(W2 * H2 * 3), E2 = new Float32Array(W2 * H2);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const q = y * W2 + x; for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const p = (y * 2 + j) * W + x * 2 + i; for (let k = 0; k < 3; k++) A2[q * 3 + k] += A[p * 3 + k] / 4; E2[q] = Math.max(E2[q], E[p]); } }
  const bw = bx[2] - bx[0], bh = bx[3] - bx[1], cl = v => Math.max(0, Math.min(1, v)), jit = [bx, [bx[0] - bw * 0.15, bx[1] - bh * 0.15, bx[2] + bw * 0.15, bx[3] + bh * 0.15], [bx[0], bx[1] + bh * 0.12, bx[2], bx[3] + bh * 0.12], [bx[0] - bw * 0.15, bx[1] - bh * 0.03, bx[2] + bw * 0.15, bx[3] + bh * 0.27]].map(b => b.map(cl));
  const score = (m, b, Wm, Hm, Em) => { const x0 = b[0] * Wm, y0 = b[1] * Hm, x1 = b[2] * Wm, y1 = b[3] * Hm, w = x1 - x0, h = y1 - y0, R0 = [Math.max(0, x0 - w * 0.25), Math.max(0, y0 - h * 0.25), Math.min(Wm, x1 + w * 0.25), Math.min(Hm, y1 + h * 0.25)]; let n = 0, e = 0, t = 0;
    for (let y = 1; y < Hm - 1; y++) for (let x = 1; x < Wm - 1; x++) { const p = y * Wm + x; if (!m[p] || (m[p - 1] && m[p + 1] && m[p - Wm] && m[p + Wm])) continue; n++; e += Em[p]; if ((x - R0[0] < 2 && R0[0] > 1) || (R0[2] - x < 3 && R0[2] < Wm - 1) || (y - R0[1] < 2 && R0[1] > 1) || (R0[3] - y < 3 && R0[3] < Hm - 1)) t++; }
    let a = 0; for (let y = Math.floor(R0[1]); y < R0[3]; y++) for (let x = Math.floor(R0[0]); x < R0[2]; x++) a += m[y * Wm + x]; const fa = a / Math.max(1, (R0[2] - R0[0]) * (R0[3] - R0[1]));
    return n ? e / n - 1.2 * t / n - 2 * Math.max(0, fa - 0.65) : -9; };
  const cands = []; for (const b of jit) for (const local of [false, true]) { const m = boxGrabMask1(A2, W2, H2, b, E2, hullT, closeK, local); cands.push({ v: score(m, b, W2, H2, E2), b, local, m }); }
  // consensus: the hypotheses vote (a leak or a lost body is a minority), so a re-encoded photo gives the same subject
  cands.sort((a, b) => b.v - a.v); const voters = cands.filter(c => c.v >= cands[0].v - 0.35), m2 = new Float32Array(W2 * H2);
  for (const c of voters) for (let q = 0; q < W2 * H2; q++) m2[q] += c.m[q] / voters.length;
  const up = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) up[y * W + x] = m2[Math.min(H2 - 1, y >> 1) * W2 + Math.min(W2 - 1, x >> 1)];
  const ub = blur1(up, W, H, 2), out = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) out[p] = ub[p] > 0.5 ? 1 : 0;
  // poles/branches: parts outside the box (+12%) that run on to the search limit are background, tails and feet that stop short stay
  const bw0 = (bx[2] - bx[0]) * W, bh0 = (bx[3] - bx[1]) * H, ix0 = bx[0] * W - bw0 * 0.12, ix1 = bx[2] * W + bw0 * 0.12, iy0 = bx[1] * H - bh0 * 0.12, iy1 = bx[3] * H + bh0 * 0.12;
  const rx0 = Math.max(0, bx[0] * W - bw0 * 0.25), rx1 = Math.min(W - 1, bx[2] * W + bw0 * 0.25), ry0 = Math.max(0, bx[1] * H - bh0 * 0.25), ry1 = Math.min(H - 1, bx[3] * H + bh0 * 0.25);
  const outside = (x, y) => (x < ix0 || x > ix1 || y < iy0) && y < iy1, seen = new Uint8Array(W * H);
  for (let p0 = 0; p0 < W * H; p0++) { const x0 = p0 % W, y0 = (p0 / W) | 0; if (!out[p0] || seen[p0] || !outside(x0, y0)) continue;
    const st = [p0], comp = []; seen[p0] = 1; let lim = false;
    while (st.length) { const p = st.pop(), x = p % W, y = (p / W) | 0; comp.push(p); if ((x <= rx0 + 1 && rx0 > 1) || (x >= rx1 - 1 && rx1 < W - 2) || (y <= ry0 + 1 && ry0 > 1)) lim = true;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && out[q] && !seen[q] && outside(q % W, (q / W) | 0)) { seen[q] = 1; st.push(q); } }
    if (lim) for (const p of comp) out[p] = 0; }
  return out;
}
/* Facade layout for buildings (straight-line style): finds the sky above a stepped roofline, the ground strip, cornice lines and the
   openings (windows, doors, bricked arches) as rectangles snapped to one straight-line grid; the wall between them becomes a few big
   rectangles, so plaster stains and graffiti never turn into pieces. Bars, planks and brick courses inside an opening come back as
   came lines (overlay lead). Returns null when it does not look like a facade, so the generic path runs instead. */
function facadeLayout(A, F, iw, ih, ppi) {
  const N = iw * ih, L = new Float32Array(N); for (let p = 0; p < N; p++) L[p] = A[p * 3];
  const Lb = blur1(L, iw, ih, 1), Gx = new Float32Array(N), Gy = new Float32Array(N), ca = new Float32Array(N), cb2 = new Float32Array(N); for (let p = 0; p < N; p++) { ca[p] = A[p * 3 + 1]; cb2[p] = A[p * 3 + 2]; }
  const Ca = blur1(ca, iw, ih, 2), Cb = blur1(cb2, iw, ih, 2), Ch = [null, Ca, Cb]; // JPEG stores colour at half resolution in blocks: smooth it before taking edges
  for (let y = 1; y < ih - 1; y++) for (let x = 1; x < iw - 1; x++) { const p = y * iw + x; let gx = Math.abs(Lb[p + 1] - Lb[p - 1]), gy = Math.abs(Lb[p + iw] - Lb[p - iw]);
    for (let k = 1; k < 3; k++) { gx = Math.max(gx, Math.abs(Ch[k][p + 1] - Ch[k][p - 1]) * 0.8); gy = Math.max(gy, Math.abs(Ch[k][p + iw] - Ch[k][p - iw]) * 0.8); } Gx[p] = gx; Gy[p] = gy; }
  const pct = (a, q) => { const s = Float32Array.from(a).sort(); return s[Math.floor(s.length * q)]; }, tV = Math.max(5, pct(Gx, 0.8)), tH = Math.max(5, pct(Gy, 0.8));
  // oriented edge maps with ±1 px tolerance across the line, and running sums along it
  const bV = new Uint8Array(N), bH = new Uint8Array(N);
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const p = y * iw + x; for (let d = -1; d <= 1; d++) { if (x + d >= 0 && x + d < iw && Gx[p + d] > tV && Gx[p + d] >= Gy[p + d] * 0.7) bV[p] = 1; if (y + d >= 0 && y + d < ih && Gy[p + d * iw] > tH && Gy[p + d * iw] >= Gx[p + d * iw] * 0.7) bH[p] = 1; } }
  const cV = new Float32Array((ih + 1) * iw), cH = new Float32Array((iw + 1) * ih);
  for (let x = 0; x < iw; x++) for (let y = 0; y < ih; y++) cV[(y + 1) * iw + x] = cV[y * iw + x] + bV[y * iw + x];
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) cH[y * (iw + 1) + x + 1] = cH[y * (iw + 1) + x] + bH[y * iw + x];
  const vs = (x, y0, y1) => (cV[y1 * iw + x] - cV[y0 * iw + x]) / Math.max(1, y1 - y0), hs = (y, x0, x1) => (cH[y * (iw + 1) + x1] - cH[y * (iw + 1) + x0]) / Math.max(1, x1 - x0);
  // colour integral image for inside/outside contrast
  const I = new Float64Array((iw + 1) * (ih + 1) * 3); for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) for (let k = 0; k < 3; k++) { const q = ((y + 1) * (iw + 1) + x + 1) * 3 + k; I[q] = A[(y * iw + x) * 3 + k] + I[q - 3] + I[q - (iw + 1) * 3] - I[q - (iw + 2) * 3]; }
  const box = (x0, y0, x1, y1) => { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(iw, x1); y1 = Math.min(ih, y1); const n = Math.max(1, (x1 - x0) * (y1 - y0)), o = [0, 0, 0]; for (let k = 0; k < 3; k++) o[k] = (I[(y1 * (iw + 1) + x1) * 3 + k] - I[(y0 * (iw + 1) + x1) * 3 + k] - I[(y1 * (iw + 1) + x0) * 3 + k] + I[(y0 * (iw + 1) + x0) * 3 + k]) / n; return [o, n]; };
  // candidate line positions: columns / rows holding a long oriented run
  const runsV = x => { let best = 0, cur = 0, gap = 0; for (let y = 0; y < ih; y++) { if (bV[y * iw + x]) { cur += gap + 1; gap = 0; } else if (cur && gap < 2) gap++; else { cur = 0; gap = 0; } if (cur > best) best = cur; } return best; };
  const runsH = y => { let best = 0, cur = 0, gap = 0; for (let x = 0; x < iw; x++) { if (bH[y * iw + x]) { cur += gap + 1; gap = 0; } else if (cur && gap < 2) gap++; else { cur = 0; gap = 0; } if (cur > best) best = cur; } return best; };
  const nms = (vals, minV) => { const out = []; for (let i = 0; i < vals.length; i++) if (vals[i] >= minV && vals.slice(Math.max(0, i - 2), i + 3).every((v, j) => v <= vals[i] || (v === vals[i] && Math.max(0, i - 2) + j >= i))) out.push(i); return out; };
  const X = nms([...Array(iw).keys()].map(runsV), ih * 0.08), Y = nms([...Array(ih).keys()].map(runsH), iw * 0.06);
  if (X.length < 4 || Y.length < 3) return null;
  const probe = (x0, x1, y0, y1) => { const w = x1 - x0, h = y1 - y0, sw = Math.max(2, Math.round(Math.min(w, h) * 0.12)), dc = (a, b) => Math.hypot(a[0][0] - b[0][0], a[0][1] - b[0][1], a[0][2] - b[0][2]); return { sl: vs(x0, y0, y1), sr: vs(x1, y0, y1), st: hs(y0, x0, x1), sb: hs(y1, x0, x1), cl: dc(box(x0, y0, x0 + sw, y1), box(x0 - sw, y0, x0, y1)), cr: dc(box(x1 - sw, y0, x1, y1), box(x1, y0, x1 + sw, y1)), ct: dc(box(x0, y0, x1, y0 + sw), box(x0, y0 - sw, x1, y0)), cb: dc(box(x0, y1 - sw, x1, y1), box(x0, y1, x1, y1 + sw)) }; };
  // sky: flood from the top through pixels like the top rows
  const top = [0, 0, 0]; for (let x = 0; x < iw; x++) for (let k = 0; k < 3; k++) top[k] += A[(iw + x) * 3 + k] / iw;
  const sky = new Uint8Array(N), stk = []; for (let x = 0; x < iw; x++) { const p = x; if (Math.hypot(A[p * 3] - top[0], A[p * 3 + 1] - top[1], A[p * 3 + 2] - top[2]) < 16) { sky[p] = 1; stk.push(p); } }
  while (stk.length) { const p = stk.pop(), x = p % iw, y = (p / iw) | 0; for (const q of [x > 0 ? p - 1 : -1, x < iw - 1 ? p + 1 : -1, y < ih - 1 ? p + iw : -1, y > 0 ? p - iw : -1]) if (q >= 0 && !sky[q] && Math.hypot(A[q * 3] - top[0], A[q * 3 + 1] - top[1], A[q * 3 + 2] - top[2]) < 14 && Gx[q] < tV * 1.5 && Gy[q] < tH * 1.5) { sky[q] = 1; stk.push(q); } }
  let rl = new Float32Array(iw); for (let x = 0; x < iw; x++) { let y = 0; while (y < ih && sky[y * iw + x]) y++; rl[x] = y; }
  { const m = new Float32Array(iw); for (let x = 0; x < iw; x++) { const w = []; for (let d = -5; d <= 5; d++) w.push(rl[Math.max(0, Math.min(iw - 1, x + d))]); w.sort((a, b) => a - b); m[x] = w[5]; } rl = m; }
  // roofline → straight steps: snap each column to the nearest strong row, then merge runs shorter than 6% of the width
  const snapY = v => { let b = v, bd = 4; for (const y of Y) if (Math.abs(y - v) < bd) { bd = Math.abs(y - v); b = y; } return b; };
  let steps = []; for (let x = 0; x < iw; x++) { const v = rl[x] < 2 ? 0 : snapY(Math.round(rl[x])); if (steps.length && Math.abs(steps[steps.length - 1].y - v) <= 2) steps[steps.length - 1].x1 = x + 1; else steps.push({ x0: x, x1: x + 1, y: v }); }
  for (let it = 0; it < 20 && steps.length > 1; it++) { let mi = -1, mw = iw * 0.06; steps.forEach((s, i) => { if (s.x1 - s.x0 < mw) { mw = s.x1 - s.x0; mi = i; } }); if (mi < 0) break; const s = steps[mi], nb = mi === 0 ? steps[1] : mi === steps.length - 1 ? steps[mi - 1] : Math.abs(steps[mi - 1].y - s.y) < Math.abs(steps[mi + 1].y - s.y) ? steps[mi - 1] : steps[mi + 1]; nb.x0 = Math.min(nb.x0, s.x0); nb.x1 = Math.max(nb.x1, s.x1); steps.splice(mi, 1);
    for (let i = steps.length - 1; i > 0; i--) if (Math.abs(steps[i].y - steps[i - 1].y) <= 2) { steps[i - 1].x1 = steps[i].x1; steps.splice(i, 1); } }
  const roofAt = new Int32Array(iw); for (const s of steps) for (let x = s.x0; x < s.x1; x++) roofAt[x] = s.y; let skyA = 0; for (let x = 0; x < iw; x++) skyA += roofAt[x]; const hasSky = skyA > N * 0.02;
  if (!hasSky) roofAt.fill(0);
  const roofMean = skyA / iw;
  // ground: the strongest wide horizontal line in the bottom quarter
  let ground = ih; { let bv = 0.2; for (const y of Y) if (y > ih * 0.72 && y < ih - 3) { const v = hs(y, 0, iw); if (v > bv) { bv = v; ground = y; } } }
  // openings: rectangles on the candidate grid with edge support on the sides and a colour step to the wall around them
  const cand = [];
  for (let a = 0; a < X.length; a++) for (let b = a + 1; b < X.length; b++) { const x0 = X[a], x1 = X[b], w = x1 - x0; if (w < iw * 0.08 || w > iw * 0.3) continue;
    for (let c = 0; c < Y.length; c++) { const y0 = Y[c]; if (y0 < roofMean * 0.5) continue; for (let d = c + 1; d < Y.length; d++) { const y1 = Y[d], h = y1 - y0; if (h < ih * 0.12 || h > ih * 0.7 || h / w < 0.45 || h / w > 4.5 || y1 > ground + 2) continue;
      if (y0 < roofMean + ih * 0.08) continue; // an opening has wall above it
      const sl = vs(x0, y0, y1), sr = vs(x1, y0, y1), st2 = hs(y0, x0, x1), sb = hs(y1, x0, x1); if (Math.min(sl, sr) < 0.5 || st2 < 0.6) continue;
      const sw = Math.max(2, Math.round(Math.min(w, h) * 0.12)), dc = (a, b) => Math.hypot(a[0][0] - b[0][0], a[0][1] - b[0][1], a[0][2] - b[0][2]);
      const ct = dc(box(x0, y0, x1, y0 + sw), box(x0, y0 - sw, x1, y0)); if (ct < 9) continue; // the lintel: a clear step at the top
      const cl = dc(box(x0, y0, x0 + sw, y1), box(x0 - sw, y0, x0, y1)), cr = dc(box(x1 - sw, y0, x1, y1), box(x1, y0, x1 + sw, y1)), cb = dc(box(x0, y1 - sw, x1, y1), box(x0, y1, x1, y1 + sw)); if (Math.max(cl, cr) < 6) continue;
      const sup = (sl + sr) / 2 * 0.45 + st2 * 0.35 + sb * 0.2, con = (ct + (cl + cr) / 2 + Math.max(cb, 6)) / 3;
      cand.push({ x0, x1, y0, y1, v: sup * Math.min(1, con / 15) * Math.pow(w * h / N, 0.08) }); } } }
  // two stacked things (a window over a door): a strong full-width line inside with a colour step across it
  for (const a of cand) { a.v0 = a.v; for (const y of Y) { if (y < a.y0 + ih * 0.1 || y > a.y1 - ih * 0.1) continue; if (hs(y, a.x0, a.x1) < 0.75) continue; const up = box(a.x0 + 2, Math.max(a.y0, y - 8), a.x1 - 2, y - 1), dn = box(a.x0 + 2, y + 1, a.x1 - 2, Math.min(a.y1, y + 8)); if (Math.hypot(up[0][0] - dn[0][0], up[0][1] - dn[0][1], up[0][2] - dn[0][2]) > 18) { a.v *= 0.6; break; } } }
  cand.sort((p, q) => q.v - p.v);
  // prefer the tight opening: a rectangle that holds a smaller, nearly as good one is a wall bay, not an opening
  const ar = o => (o.x1 - o.x0) * (o.y1 - o.y0), topC = cand.slice(0, 2000); for (const a of topC) a.v1 = a.v;
  for (const a of topC) for (const b of topC) if (b !== a && ar(b) <= ar(a) * 0.6 && b.v1 >= a.v1 * 0.85 && b.x0 >= a.x0 - 2 && b.x1 <= a.x1 + 2 && b.y0 >= a.y0 - 2 && b.y1 <= a.y1 + 2 && !(Math.abs(b.x0 - a.x0) <= 2 && Math.abs(b.x1 - a.x1) <= 2)) { a.v = a.v1 * 0.55; break; }
  cand.sort((p, q) => q.v - p.v); const ops = [];
  for (const r of cand) { if (ops.length >= 8) break; if (r.v < 0.3) break; if (ops.some(o => r.x0 < o.x1 - 1 && r.x1 > o.x0 + 1 && r.y0 < o.y1 - 1 && r.y1 > o.y0 + 1)) continue; ops.push(r); }
  // facades stack openings in columns: under a window, look for a door in the same column by its edges alone (a white door on pale plaster has little colour step)
  for (const o of ops.slice()) { if (ops.length >= 9) break; let best = null; for (const y0 of Y) { if (y0 < o.y1 + 1 || y0 > o.y1 + ih * 0.1) continue; for (const y1 of Y) { if (y1 < y0 + ih * 0.15 || y1 > ground + 2) continue;
      const sl = vs(o.x0, y0, y1), sr = vs(o.x1, y0, y1), st3 = hs(y0, o.x0, o.x1), sb = hs(y1, o.x0, o.x1), v = (sl + sr) / 2 * 0.5 + st3 * 0.25 + sb * 0.25; if (Math.min(sl, sr) < 0.4 || v < 0.6) continue; if (!best || v > best.v) best = { x0: o.x0, x1: o.x1, y0, y1, v }; } }
    if (!best) continue; const inside = q => q.x0 >= best.x0 - 3 && q.x1 <= best.x1 + 3 && q.y0 >= best.y0 - 3 && q.y1 <= best.y1 + 3, hit = ops.filter(q => q !== o && best.x0 < q.x1 - 1 && best.x1 > q.x0 + 1 && best.y0 < q.y1 - 1 && best.y1 > q.y0 + 1);
    if (hit.every(inside)) { for (const q of hit) ops.splice(ops.indexOf(q), 1); ops.push(best); } }
  if (ops.length < 2) return null;
  // one grid: opening edges within 4 px snap together
  const snapAll = (vals, t) => { const s = [...new Set(vals)].sort((a, b) => a - b), groups = []; for (const v of s) { const g = groups[groups.length - 1]; if (g && v - g[g.length - 1] <= t) g.push(v); else groups.push([v]); } const m = new Map(); for (const g of groups) { const c = Math.round(g.reduce((a, v) => a + v, 0) / g.length); for (const v of g) m.set(v, c); } return m; };
  const mx = snapAll(ops.flatMap(o => [o.x0, o.x1]), 4); for (const o of ops) { o.x0 = mx.get(o.x0); o.x1 = mx.get(o.x1); }
  const my = snapAll(ops.flatMap(o => [o.y0, o.y1]).concat(Y.filter(y => hs(y, 0, iw) > 0.35)), 3); for (const o of ops) { o.y0 = my.get(o.y0); o.y1 = my.get(o.y1); }
  // cornice lines: wide horizontals on the wall (not an opening edge), at most two
  const segs = [{ x0: 0, x1: iw }].concat(steps.filter(st3 => st3.x1 - st3.x0 >= iw * 0.2).map(st3 => ({ x0: st3.x0, x1: st3.x1, roof: st3.y }))), corn = [];
  for (const sg of segs) { const cs = []; for (const y of Y) { if (y < (sg.roof != null ? sg.roof : roofMean) + 3 || y > ground - 6) continue; const v = hs(y, sg.x0, sg.x1); if (v < (sg.roof != null ? 0.55 : 0.4)) continue; if (ops.some(o => o.x0 < sg.x1 && o.x1 > sg.x0 && (Math.abs(o.y0 - y) < 4 || Math.abs(o.y1 - y) < 4))) continue; if (cs.some(c => Math.abs(c.y - y) < ih * 0.08) || corn.some(c => Math.abs(c.y - y) < ih * 0.08 && c.x0 <= sg.x0 + 2 && c.x1 >= sg.x1 - 2)) continue; cs.push({ y, v, x0: sg.x0, x1: sg.x1 }); }
    cs.sort((a, b) => b.v - a.v); corn.push(...cs.slice(0, sg.roof != null ? 1 : 3)); }
  // labels: sky, ground, openings, wall cells between the snapped vertical edges and the horizontal lines
  const pil = []; for (const x of X) { if (x < 3 || x > iw - 4) continue; let y0 = 0; for (let k = Math.max(0, x - 2); k <= Math.min(iw - 1, x + 2); k++) y0 = Math.max(y0, roofAt[k]); if (ground - y0 < ih * 0.25) continue; if (vs(x, y0, ground) < 0.45) continue; if (ops.some(o => Math.abs(o.x0 - x) < 5 || Math.abs(o.x1 - x) < 5) || pil.some(q => Math.abs(q - x) < 5)) continue; pil.push(x); }
  const xs = [...new Set(ops.flatMap(o => [o.x0, o.x1]).concat(pil, corn.filter(c => c.x0 > 0 || c.x1 < iw).flatMap(c => [c.x0, c.x1]).filter(x => x > 2 && x < iw - 2)))].sort((a, b) => a - b), R = new Int32Array(N).fill(-1); let n = 0; const keyOf = new Map();
  const SKY = hasSky ? n++ : -1, GROUND = ground < ih ? n++ : -1; ops.forEach(o => o.lab = n++);
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const p = y * iw + x; if (hasSky && y < roofAt[x]) { R[p] = SKY; continue; } if (y >= ground) { R[p] = GROUND; continue; }
    const op = ops.find(o => x >= o.x0 && x < o.x1 && y >= o.y0 && y < o.y1); if (op) { R[p] = op.lab; continue; }
    let bi = 0; while (bi < xs.length && x >= xs[bi]) bi++; const bx0 = bi ? xs[bi - 1] : 0, bx1 = bi < xs.length ? xs[bi] : iw;
    const cuts = corn.filter(c => c.x0 < bx1 && c.x1 > bx0).map(c => c.y).concat(ops.filter(o => o.x0 < bx1 && o.x1 > bx0).flatMap(o => [o.y0, o.y1])); let ri = 0; for (const c of cuts) if (y >= c) ri++;
    const k = bi * 1000 + cuts.filter(c => y >= c).reduce((a, c) => a + c, 0) % 997 + ri * 100000; let lab = keyOf.get(k); if (lab == null) { lab = n++; keyOf.set(k, lab); } R[p] = lab; }
  const kindOld = new Map(); if (hasSky) kindOld.set(SKY, 'sky'); if (GROUND >= 0) kindOld.set(GROUND, 'ground'); ops.forEach(o => kindOld.set(o.lab, 'op'));
  const cc = components(R, iw, ih), kind = cc.from.map(l => kindOld.get(l) || 'wall'), opOf = cc.from.map(l => ops.find(o => o.lab === l) || null);
  // glass per element: the wall in one or two calm tones, every opening clearly different from the wall, sky and ground distinct
  const sum = new Float64Array(cc.n * 4); for (let p = 0; p < N; p++) { const r = cc.R[p]; sum[r * 4] += F[p * 3]; sum[r * 4 + 1] += F[p * 3 + 1]; sum[r * 4 + 2] += F[p * 3 + 2]; sum[r * 4 + 3]++; }
  // dominant colour of a set of labels (largest of 3 clusters), so a mottled wall reads as its plaster and a barred window as its dark inside
  const pxOf = new Map(); for (let p = 0; p < N; p++) { const r = cc.R[p]; let a = pxOf.get(r); if (!a) pxOf.set(r, a = []); a.push(p); }
  const dominant = labs => { const px = labs.flatMap(r => pxOf.get(r) || []), step = Math.max(1, Math.floor(px.length / 3000)), pts = []; for (let i = 0; i < px.length; i += step) pts.push(px[i]); if (!pts.length) return [128, 128, 128];
    let cs = [0, 0.5, 0.99].map(f => { const q = pts[Math.floor(f * (pts.length - 1))]; return [A[q * 3], A[q * 3 + 1], A[q * 3 + 2]]; }).sort((a, b) => a[0] - b[0]); { const byL = pts.slice().sort((a, b) => A[a * 3] - A[b * 3]); cs = [0.15, 0.5, 0.85].map(f => { const q = byL[Math.floor(f * (byL.length - 1))]; return [A[q * 3], A[q * 3 + 1], A[q * 3 + 2]]; }); }
    let asg = new Int32Array(pts.length); for (let it = 0; it < 8; it++) { const acc = cs.map(() => [0, 0, 0, 0, 0, 0, 0]); pts.forEach((q, i) => { let b = 0, bd = 1e9; cs.forEach((c, k) => { const d = (A[q * 3] - c[0]) ** 2 + (A[q * 3 + 1] - c[1]) ** 2 + (A[q * 3 + 2] - c[2]) ** 2; if (d < bd) { bd = d; b = k; } }); asg[i] = b; const a = acc[b]; a[0] += A[q * 3]; a[1] += A[q * 3 + 1]; a[2] += A[q * 3 + 2]; a[3]++; a[4] += F[q * 3]; a[5] += F[q * 3 + 1]; a[6] += F[q * 3 + 2]; }); cs = cs.map((c, k) => acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : c); if (it === 7) { const big = acc.reduce((a, b) => b[3] > a[3] ? b : a); return [big[4] / big[3], big[5] / big[3], big[6] / big[3]]; } } };
  const mean = r => [sum[r * 4] / sum[r * 4 + 3], sum[r * 4 + 1] / sum[r * 4 + 3], sum[r * 4 + 2] / sum[r * 4 + 3]], dE = (a, b) => { const p = gLab(...a), q = gLab(...b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
  const nearestLab = c => { const l = gLab(...c); let b = null, bd = 1e9; for (const q of GLASS_PALETTE) { const g = gLab(q[1], q[2], q[3]), d = Math.hypot(l[0] - g[0], (l[1] - g[1]) * 1.2, (l[2] - g[2]) * 1.2); if (d < bd) { bd = d; b = q; } } return { name: b[0], rgb: [b[1], b[2], b[3]] }; };
  const walls = [...Array(cc.n).keys()].filter(r => kind[r] === 'wall'), col = new Array(cc.n);
  let cA = null, cB = null; if (walls.length) { const tot = walls.reduce((a, r) => a + sum[r * 4 + 3], 0), avg = [0, 1, 2].map(k => walls.reduce((a, r) => a + sum[r * 4 + k], 0) / tot);
    cA = avg; cB = walls.map(mean).sort((a, b) => dE(b, avg) - dE(a, avg))[0]; for (let it = 0; it < 8; it++) { const ga = [0, 0, 0, 0], gb = [0, 0, 0, 0]; for (const r of walls) { const m = mean(r), g = dE(m, cA) <= dE(m, cB) ? ga : gb; for (let k = 0; k < 3; k++) g[k] += m[k] * sum[r * 4 + 3]; g[3] += sum[r * 4 + 3]; } if (ga[3]) cA = ga.slice(0, 3).map(v => v / ga[3]); if (gb[3]) cB = gb.slice(0, 3).map(v => v / gb[3]); }
    cB = cA; } // one calm wall tone
  const gA = walls.filter(r => !cB || dE(mean(r), cA) <= dE(mean(r), cB)), gB = walls.filter(r => !gA.includes(r)), dA = dominant(gA), dB2 = gB.length ? dominant(gB) : dA;
  const wallGlass = new Set(); for (const r of walls) { col[r] = nearestLab(gA.includes(r) ? dA : dB2).rgb; wallGlass.add(col[r].join()); }
  const wallRGB = [...wallGlass].map(s2 => s2.split(',').map(Number)), apart = (c, t) => { let g = nearestLab(c).rgb; if (wallRGB.every(w => dE(g, w) >= t)) return g; let best = null, bd = 1e9; for (const q of GLASS_PALETTE) { const rgb = [q[1], q[2], q[3]]; if (wallRGB.some(w => dE(rgb, w) < t)) continue; const d = dE(c, rgb); if (d < bd) { bd = d; best = rgb; } } return best || g; };
  for (let r = 0; r < cc.n; r++) if (kind[r] !== 'wall') col[r] = apart(dominant([r]), kind[r] === 'op' ? 20 : 16);
  // bars / planks / courses inside each opening → came lines, evenly spaced so they read as made, not traced
  const overlay = [];
  for (const o of ops) { const w = o.x1 - o.x0, h = o.y1 - o.y0, mxI = Math.max(1, Math.round(w * 0.1)), myI = Math.max(1, Math.round(h * 0.1)); if (w < 8 || h < 8) continue;
    const pv = [], ph = []; for (let x = o.x0 + mxI; x < o.x1 - mxI; x++) { let s2 = 0; for (let y = o.y0 + myI; y < o.y1 - myI; y++) s2 += Gx[y * iw + x]; pv.push([x, s2 / (h - 2 * myI)]); }
    for (let y = o.y0 + myI; y < o.y1 - myI; y++) { let s2 = 0; for (let x = o.x0 + mxI; x < o.x1 - mxI; x++) s2 += Gy[y * iw + x]; ph.push([y, s2 / (w - 2 * mxI)]); }
    const peaks = pr => { const m = pr.reduce((a, q) => a + q[1], 0) / pr.length; return { m, n: pr.filter((q, i) => i > 0 && i < pr.length - 1 && q[1] > pr[i - 1][1] && q[1] >= pr[i + 1][1] && q[1] > m * 1.15).length, best: pr.reduce((a, q) => q[1] > a[1] ? q : a, [0, 0]) }; };
    const PV = peaks(pv), PH = peaks(ph), eV = PV.m, eH = PH.m, even = (a, b, n) => [...Array(n).keys()].map(i => Math.round(a + (b - a) * (i + 1) / (n + 1)));
    o.type = 'solid'; const [oc] = box(o.x0, o.y0, o.x1, o.y1), wl = gLab(...dA), busy = eV + eH > (tV + tH) * 0.55, warm = oc[1] > 12 && oc[2] > 18;
    const dl = gLab(...dominant([cc.R[Math.floor((o.y0 + o.y1) / 2) * iw + Math.floor((o.x0 + o.x1) / 2)]]))[0];
    if (!warm && oc[0] < wl[0] - 12 && dl < wl[0] - 12 && eV / tV + eH / tH >= 1 && h / w <= 1.6) { o.type = 'barred'; for (const c of even(o.x0, o.x1, Math.max(2, Math.min(5, Math.round(w / (ppi * 0.42)) - 1)))) overlay.push([[c, o.y0], [c, o.y1]]);
      const rails = ph.filter((q, i) => i > 0 && i < ph.length - 1 && q[1] > ph[i - 1][1] && q[1] >= ph[i + 1][1] && q[1] > eH * 1.5 && q[0] > o.y0 + h * 0.15 && q[0] < o.y1 - h * 0.15).sort((a, b) => b[1] - a[1]), rk = []; for (const q of rails) if (rk.length < 2 && rk.every(u => Math.abs(u - q[0]) > h * 0.2)) rk.push(q[0]); for (const y of rk) overlay.push([[o.x0, y], [o.x1, y]]);
      // the window's frame: a head moulding just above and a sill just below become came lines a little wider than the window
      for (const [dir, yb] of [[-1, o.y0], [1, o.y1]]) { let best = null; for (let d = 2; d <= 8; d++) { const y = yb + dir * d; if (y < 1 || y >= ih - 1) continue; const v = hs(y, Math.max(0, o.x0 - 2), Math.min(iw, o.x1 + 2)); if (v > 0.6 && (!best || v > best.v)) best = { y, v }; } if (best) overlay.push([[Math.max(0, o.x0 - 3), best.y], [Math.min(iw - 1, o.x1 + 3), best.y]]); } }
    else if (warm && PH.n >= 3) { o.type = 'courses'; for (const c of even(o.y0, o.y1, Math.max(2, Math.min(4, Math.round(h / (ppi * 0.6)) - 1)))) overlay.push([[o.x0, c], [o.x1, c]]); }
    else if (h / w > 1.3) { o.type = 'door'; const pk = pv.filter((q, i) => i > 0 && i < pv.length - 1 && q[1] > pv[i - 1][1] && q[1] >= pv[i + 1][1] && q[1] > tV * 0.9).sort((a, b) => b[1] - a[1]), keep = []; for (const q of pk) if (keep.length < 2 && keep.every(u => Math.abs(u - q[0]) > w * 0.25)) keep.push(q[0]);
      const pl = keep.length === 2 ? keep.sort((a, b) => a - b) : keep.length === 1 ? [keep[0], keep[0] - o.x0 > w / 2 ? Math.round(o.x0 + (keep[0] - o.x0) / 2) : Math.round(keep[0] + (o.x1 - keep[0]) / 2)].sort((a, b) => a - b) : even(o.x0, o.x1, 2); for (const c of pl) overlay.push([[c, o.y0], [c, o.y1]]); } }
  for (let r = 0; r < cc.n; r++) { const o = opOf[r]; if (!o || o.type === 'solid' || gLab(...col[r])[0] >= 30) continue; // came lines must show on the glass
    let b = null, bd = 1e9; for (const q of GLASS_PALETTE) { const rgb = [q[1], q[2], q[3]], g = gLab(...rgb); if (g[0] < 30 || wallRGB.some(w2 => dE(rgb, w2) < 20)) continue; const d = dE(col[r], rgb); if (d < bd) { bd = d; b = rgb; } } if (b) col[r] = b; }
  for (let r = 0; r < cc.n; r++) { const o = opOf[r]; if (o && o.type === 'solid' && dE(dominant([r]), dA) < 16) { kind[r] = 'wall'; col[r] = nearestLab(dA).rgb; o.type = 'wall'; } }
  // main structural lines (roofline, cornices, opening edges): long straight runs — the outline a viewer reads the building by
  const nV2 = new Uint8Array(N), nH2 = new Uint8Array(N); for (let y = 1; y < ih - 1; y++) for (let x = 1; x < iw - 1; x++) { const p = y * iw + x; if (Gx[p] > tV && Gx[p] >= Gx[p - 1] && Gx[p] > Gx[p + 1] && Gx[p] >= Gy[p] * 0.7) nV2[p] = 1; if (Gy[p] > tH && Gy[p] >= Gy[p - iw] && Gy[p] > Gy[p + iw] && Gy[p] >= Gx[p] * 0.7) nH2[p] = 1; }
  const main = new Uint8Array(N); for (let x = 1; x < iw - 1; x++) { let run = 0, gap = 0; for (let y = 0; y <= ih; y++) { const on = y < ih && (nV2[y * iw + x] || nV2[y * iw + x - 1] || nV2[y * iw + x + 1]); if (on) { run += gap + 1; gap = 0; } else if (run && gap < 2 && y < ih) { gap++; continue; } else { if (run >= ih * 0.15) for (let k = y - gap - run; k < y - gap; k++) if (nV2[k * iw + x]) main[k * iw + x] = 1; run = 0; gap = 0; } } }
  for (let y = 1; y < ih - 1; y++) { let run = 0, gap = 0; for (let x = 0; x <= iw; x++) { const on = x < iw && (nH2[y * iw + x] || nH2[(y - 1) * iw + x] || nH2[(y + 1) * iw + x]); if (on) { run += gap + 1; gap = 0; } else if (run && gap < 2 && x < iw) { gap++; continue; } else { if (run >= iw * 0.15) for (let k = x - gap - run; k < x - gap; k++) if (nH2[y * iw + k]) main[y * iw + k] = 1; run = 0; gap = 0; } } }
  if (false) for (let x = 0; x < iw; x++) { let run = 0; for (let y = 0; y <= ih; y++) { if (y < ih && bV[y * iw + x]) run++; else { if (run >= ih * 0.1) for (let k = y - run; k < y; k++) main[k * iw + x] = 1; run = 0; } } }
  for (let y = 0; y < ih; y++) { let run = 0; for (let x = 0; x <= iw; x++) { if (x < iw && bH[y * iw + x]) run++; else { if (run >= iw * 0.1) for (let k = x - run; k < x; k++) main[y * iw + k] = 1; run = 0; } } }
  // long structural lines that no lead follows yet (parapet mouldings, pilaster edges, an arch's sides) → came lines
  { const cov = new Uint8Array(N); const mark = (x, y) => { for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const X2 = x + i, Y2 = y + j; if (X2 >= 0 && Y2 >= 0 && X2 < iw && Y2 < ih) cov[Y2 * iw + X2] = 1; } };
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const p = y * iw + x, r = cc.R[p]; if ((x < iw - 1 && cc.R[p + 1] !== r) || (y < ih - 1 && cc.R[p + iw] !== r)) mark(x, y); }
    for (const l of overlay) { const [[ax, ay], [bx, by]] = l, n = Math.ceil(Math.hypot(bx - ax, by - ay)) + 1; for (let t = 0; t <= n; t++) mark(Math.round(ax + (bx - ax) * t / n), Math.round(ay + (by - ay) * t / n)); }
    const runs = [], scan = (len, other, at, minL, horiz) => { for (let a = 2; a < other - 2; a++) { let s0 = -1, gap = 0, unc = 0; for (let b = 0; b <= len; b++) { const p = horiz ? a * iw + b : b * iw + a, ln = b < len && (horiz ? nH2[p] || nH2[p - iw] || nH2[p + iw] : nV2[p] || nV2[p - 1] || nV2[p + 1]) && !(horiz ? sky[p] : false), on = ln && !cov[p];
      if (ln) { if (s0 < 0) { s0 = b; unc = 0; } gap = 0; if (on) unc++; } else if (s0 >= 0 && gap < 2 && b < len) gap++; else { if (s0 >= 0 && b - gap - s0 >= minL && unc >= (b - gap - s0) * 0.5) runs.push({ horiz, a, b0: s0, b1: b - gap, len: unc }); s0 = -1; gap = 0; } } } };
    scan(iw, ih, 0, iw * 0.2, true); scan(ih, iw, 0, ih * 0.2, false); runs.sort((p, q) => q.len - p.len); const took = { true: [], false: [] };
    for (const r of runs) { const t = took[r.horiz]; if (t.length >= 5 || t.some(u => Math.abs(u.a - r.a) < 4 && u.b0 < r.b1 && u.b1 > r.b0)) continue; t.push(r); overlay.push(r.horiz ? [[r.b0, r.a], [r.b1, r.a]] : [[r.a, r.b0], [r.a, r.b1]]); } }
  return { probe, cand, X, Y, col, kind, main, R: cc.R, n: cc.n, overlay, ops, sky: hasSky, ground: ground < ih, groundY: ground, cornices: corn.map(c => c.y), steps };
}
/* Calm background: k-means on a heavily blurred photo (background pixels only), labels smoothed with a big majority filter so the
   borders become long sweeping curves; small blobs are absorbed; returns a label per pixel (subject pixels = -1). */
/* ---------- animal faces: a pair of eyes → a stylised, cuttable head fitted to the photo ----------
   ears as straight-sided triangles (outer + inner ear), eyes, nose, a muzzle split down the middle, chin,
   2–3 forehead stripes, temples, cheeks, and one continuous head outline; the rest becomes a few calm pieces */
function kmD(P, k, D, iters = 12) { const n = P.length / D; let C = []; for (let i = 0; i < k; i++) { const j = Math.floor((i + 0.5) * n / k) * D; C.push(Array.from(P.slice(j, j + D))); }
  for (let it = 0; it < iters; it++) { const S = C.map(() => new Float64Array(D + 1)); for (let j = 0; j < n; j++) { let b = 0, bd = 1e18; for (let c = 0; c < k; c++) { let s = 0; for (let q = 0; q < D; q++) s += (P[j * D + q] - C[c][q]) ** 2; if (s < bd) { bd = s; b = c; } } for (let q = 0; q < D; q++) S[b][q] += P[j * D + q]; S[b][D]++; } C = C.map((c, i) => S[i][D] ? c.map((_, q) => S[i][q] / S[i][D]) : c); } return C; }
function polyFill(pts, W, H) { const M = new Uint8Array(W * H), n = pts.length; for (let y = 0; y < H; y++) { const yc = y + 0.5, xs = []; for (let i = 0; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; if ((y1 <= yc) !== (y2 <= yc)) xs.push(x1 + (yc - y1) / (y2 - y1) * (x2 - x1)); } xs.sort((a, b) => a - b); for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); x++) M[y * W + x] = 1; } return M; }
function findEyePair(A, iw, ih) {
  const N = iw * ih, smp = []; for (let p = 0; p < N; p += 3) smp.push(A[p * 3], A[p * 3 + 1], A[p * 3 + 2]);
  const KC = kmeans(new Float32Array(smp), 12, 12, 9), kw = new Float64Array(KC.length), kl = new Int32Array(N);
  for (let p = 0; p < N; p++) { kl[p] = nearestC(KC, A[p * 3], A[p * 3 + 1], A[p * 3 + 2]); kw[kl[p]]++; }
  const rar = KC.map(c1 => KC.reduce((a, c2, j) => a + kw[j] / N * Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]), 0)), rmx = Math.max(...rar) || 1;
  const sc = new Float32Array(N); for (let p = 0; p < N; p++) sc[p] = rar[kl[p]] / rmx * (0.4 + 0.6 * Math.min(1, Math.hypot(A[p * 3 + 1], A[p * 3 + 2]) / 40));
  const sb = blur1(sc, iw, ih, 1); let mx = 0; for (let p = 0; p < N; p++) mx = Math.max(mx, sb[p]);
  const bin = new Uint8Array(N); for (let p = 0; p < N; p++) bin[p] = sb[p] > mx * 0.6 ? 1 : 0;
  const cc = components(bin, iw, ih), st = new Map();
  for (let p = 0; p < N; p++) { const r = cc.R[p]; if (cc.from[r] !== 1) continue; const x = p % iw, y = (p / iw) | 0; let o = st.get(r); if (!o) st.set(r, o = { r, n: 0, x0: iw, y0: ih, x1: 0, y1: 0, sx: 0, sy: 0, l: [0, 0, 0] }); o.n++; o.sx += x; o.sy += y; o.x0 = Math.min(o.x0, x); o.x1 = Math.max(o.x1, x); o.y0 = Math.min(o.y0, y); o.y1 = Math.max(o.y1, y); for (let k = 0; k < 3; k++) o.l[k] += A[p * 3 + k]; }
  const bl = []; for (const o of st.values()) { if (o.n < N * 0.002 || o.n > N * 0.03) continue; const bw = o.x1 - o.x0 + 1, bh = o.y1 - o.y0 + 1, comp = o.n / (bw * bh), asp = bw / bh; if (comp < 0.5 || asp < 0.5 || asp > 2.2) continue;
    const lab = o.l.map(v => v / o.n), rr = Math.sqrt(o.n) * 0.6; let rs = [0, 0, 0], rn = 0; for (let y = Math.max(0, Math.round(o.y0 - rr)); y <= Math.min(ih - 1, Math.round(o.y1 + rr)); y++) for (let x = Math.max(0, Math.round(o.x0 - rr)); x <= Math.min(iw - 1, Math.round(o.x1 + rr)); x++) { const p = y * iw + x; if (cc.R[p] === o.r) continue; for (let k = 0; k < 3; k++) rs[k] += A[p * 3 + k]; rn++; }
    const con = rn ? Math.hypot(...rs.map((v, k) => v / rn - lab[k])) : 0; if (con < 15) continue; bl.push({ r: o.r, n: o.n, cx: o.sx / o.n, cy: o.sy / o.n, bb: [o.x0, o.y0, o.x1, o.y1], lab, con }); }
  let best = null; for (let i = 0; i < bl.length; i++) for (let j = i + 1; j < bl.length; j++) { const a = bl[i], b = bl[j], dl = Math.hypot(...a.lab.map((v, k) => v - b.lab[k])), dx = Math.abs(a.cx - b.cx), dy = Math.abs(a.cy - b.cy);
    if (dl < 18 && Math.max(a.n, b.n) / Math.min(a.n, b.n) < 2.2 && dx > iw * 0.15 && dx < iw * 0.5 && dy < dx * 0.35) { const v = (a.n + b.n) / (1 + dl / 10); if (!best || v > best.v) best = { v, L: a.cx < b.cx ? a : b, R: a.cx < b.cx ? b : a }; } }
  if (best) for (const e of [best.L, best.R]) { e.px = []; for (let y = e.bb[1]; y <= e.bb[3]; y++) for (let x = e.bb[0]; x <= e.bb[2]; x++) if (cc.R[y * iw + x] === e.r) e.px.push(y * iw + x); }
  return best;
}
function faceLayout(A, F, iw, ih, ppi, minA, maxA) {
  const ep = findEyePair(A, iw, ih); if (!ep) return null;
  const N = iw * ih, eL = ep.L, eR = ep.R, d = Math.hypot(eR.cx - eL.cx, eR.cy - eL.cy), ca = (eR.cx - eL.cx) / d, sa = (eR.cy - eL.cy) / d, C0 = [(eL.cx + eR.cx) / 2, (eL.cy + eR.cy) / 2];
  const UV = (x, y) => { const dx = x - C0[0], dy = y - C0[1]; return [(dx * ca + dy * sa) / d, (-dx * sa + dy * ca) / d]; }, XY = (u, v) => [C0[0] + (u * ca - v * sa) * d, C0[1] + (u * sa + v * ca) * d], XYs = q => q.map(([u, v]) => XY(u, v));
  const re = (Math.sqrt(eL.n / Math.PI) + Math.sqrt(eR.n / Math.PI)) / 2 / d, du = 1 / d;
  // fur vs background: fur is textured, a soft backdrop is not; colour models seeded from the face and the image border
  const A0 = toLab(F, N), gr = new Float32Array(N); for (let y = 1; y < ih - 1; y++) for (let x = 1; x < iw - 1; x++) { const p = y * iw + x; gr[p] = Math.abs(A0[(p + 1) * 3] - A0[(p - 1) * 3]) + Math.abs(A0[(p + iw) * 3] - A0[(p - iw) * 3]); }
  const T = blur1(gr, iw, ih, 4), fgS = [], bgS = [], tv = [], U = new Float32Array(N), V = new Float32Array(N);
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const p = y * iw + x, [u, v] = UV(x + 0.5, y + 0.5); U[p] = u; V[p] = v; const f = [A[p * 3], A[p * 3 + 1], A[p * 3 + 2], T[p] * 2];
    if (Math.hypot(u, (v - 0.3) * 1.1) < 0.95) { fgS.push(...f); tv.push(T[p]); } if (Math.min(x, y, iw - 1 - x) < 5 && v < 0.6 && Math.hypot(u, v) > 1.3) bgS.push(...f); }
  if (bgS.length < 4 * 150 || fgS.length < 4 * 300) return null;
  const Kf = kmD(fgS, 5, 4), Kb = kmD(bgS, 5, 4), fgp = new Float32Array(N); tv.sort((a, b) => a - b); const tm = tv[Math.floor(tv.length / 2)] || 1;
  for (let p = 0; p < N; p++) { const f = [A[p * 3], A[p * 3 + 1], A[p * 3 + 2], T[p] * 2], dd = K => { let m = 1e9; for (const c of K) m = Math.min(m, Math.hypot(c[0] - f[0], c[1] - f[1], c[2] - f[2], c[3] - f[3])); return m; }, a = dd(Kf), b = dd(Kb); fgp[p] = b / (a + b + 1e-6); }
  const fs1 = blur1(fgp, iw, ih, 3), S = new Float32Array(N); for (let p = 0; p < N; p++) S[p] = 0.55 * fs1[p] + 0.45 * Math.min(1, T[p] / tm);
  const S2 = blur1(S, iw, ih, 2); let M = new Uint8Array(N); for (let p = 0; p < N; p++) M[p] = S2[p] > 0.5 ? 1 : 0;
  { const cc = components(M, iw, ih), c0 = cc.R[Math.round(C0[1]) * iw + Math.round(C0[0])], keep = new Uint8Array(N); for (let p = 0; p < N; p++) keep[p] = cc.R[p] === c0 ? 1 : 0; const inv = new Uint8Array(N); for (let p = 0; p < N; p++) inv[p] = keep[p] ? 0 : 1; const ci = components(inv, iw, ih), edge = new Set(); for (let x = 0; x < iw; x++) { edge.add(ci.R[x]); edge.add(ci.R[(ih - 1) * iw + x]); } for (let y = 0; y < ih; y++) { edge.add(ci.R[y * iw]); edge.add(ci.R[y * iw + iw - 1]); } for (let p = 0; p < N; p++) if (inv[p] && !edge.has(ci.R[p])) keep[p] = 1; M = keep; }
  const at = (u, v) => { const [x, y] = XY(u, v), xi = Math.floor(x), yi = Math.floor(y); return xi < 0 || yi < 0 || xi >= iw || yi >= ih ? 0 : M[yi * iw + xi]; };
  const avg = (a, w) => a.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - w); j <= Math.min(a.length - 1, i + w); j++) { s += a[j]; n++; } return s / n; });
  // top contour and head sides (face frame: u along the eyes, v down, eye distance = 1)
  const us = []; for (let u = -2.4; u <= 2.4 + 1e-9; u += du) us.push(u);
  const vtop = us.map(u => { if (!at(u, 0.2) && !at(u, -0.2) && !at(u, -0.6)) { let any = false; for (let v = -0.6; v > -3; v -= du) if (at(u, v)) { any = true; break; } if (!any) return null; } for (let v = -3; v < 0.3; v += du) if (at(u, v) && at(u, v + du) && at(u, v + 2 * du) && at(u, v + 3 * du)) return v; return null; });
  const side = (v, s) => { let last = 0, miss = 0; for (let u = 0; Math.abs(u) < 2.4; u += s * du) { if (at(u, v)) { last = u; miss = 0; } else if (++miss > 4) break; } return last; };
  const vs = 0.35, uLs = Math.max(-2, side(vs, -1)), uRs = Math.min(2, side(vs, 1)); if (uLs > -0.75 || uRs < 0.75) return null;
  const cIdx = us.map((u, i) => [u, i]).filter(([u, i]) => Math.abs(u) < 0.25 && vtop[i] != null).map(q => vtop[q[1]]).sort((a, b) => a - b), vc = cIdx.length ? cIdx[Math.floor(cIdx.length / 2)] : null; if (vc == null || vc > -0.5) return null;
  const ear = s => { let ti = -1; for (let i = 0; i < us.length; i++) { const u = us[i]; if (vtop[i] == null || u * s < 0.15 || u * s > Math.abs(s < 0 ? uLs : uRs) + 0.2) continue; if (ti < 0 || vtop[i] < vtop[ti]) ti = i; } if (ti < 0 || vc - vtop[ti] < 0.3) return null;
    let ii = ti; while (ii - s >= 0 && ii - s < us.length && us[ii] * s > 0.12 && (vtop[ii] == null || vtop[ii] < vc - 0.04)) ii -= s; const I = [us[ii], vtop[ii] ?? vc];
    let oi = ti; while (oi + s >= 0 && oi + s < us.length && vtop[oi + s] != null && vtop[oi + s] < I[1] + 0.18) oi += s; const O = [us[oi], Math.max(vtop[oi], I[1] + 0.05)];
    const Tp = [us[ti], vtop[ti]]; if (Math.hypot(I[0] - O[0], I[1] - O[1]) < 0.3) return null; return { T: Tp, I, O }; };
  const EL = ear(-1), ER = ear(1);
  // a tip the photo crops off would be cut flat by the frame: keep each tip a little inside, pulled toward the ear's base
  for (const E of [EL, ER]) if (E) { const m = 0.3 * ppi, B = [(E.I[0] + E.O[0]) / 2, (E.I[1] + E.O[1]) / 2], bp = XY(...B), tp = XY(...E.T); let t = 1;
    if (tp[1] < m && bp[1] > m) t = Math.min(t, (bp[1] - m) / (bp[1] - tp[1])); if (tp[0] < m && bp[0] > m) t = Math.min(t, (bp[0] - m) / (bp[0] - tp[0])); if (tp[0] > iw - 1 - m && bp[0] < iw - 1 - m) t = Math.min(t, (iw - 1 - m - bp[0]) / (tp[0] - bp[0]));
    if (t < 1) E.T = [B[0] + t * (E.T[0] - B[0]), B[1] + t * (E.T[1] - B[1])]; }
  // nose: the pinkest / darkest spot below the eyes
  let nu = 0, nv = 0.65; { const c = []; for (let p = 0; p < N; p++) { const u = U[p], v = V[p]; if (Math.abs(u) < 0.35 && v > 0.4 && v < 1.0) c.push([A[p * 3 + 1] * 1.2 + Math.max(0, 45 - A[p * 3]) * 0.8, u, v]); } c.sort((a, b) => b[0] - a[0]); const top = c.slice(0, Math.max(5, Math.round(c.length * 0.03))); if (top.length && top[0][0] > 12) { nu = top.reduce((a, q) => a + q[1], 0) / top.length; nv = top.reduce((a, q) => a + q[2], 0) / top.length; } }
  const vchin = nv + 0.62, mcv = nv + 0.08;
  // head outline: sides from the photo, ears as triangles, crown from the photo, a rounded jaw
  const sideL = [], sideR = [], topL = EL ? EL.O[1] : vtop[us.findIndex(v => v != null)] ?? vc, topR = ER ? ER.O[1] : vc;
  for (let v = vs; v > topL; v -= du) sideL.push([side(v, -1), v]); for (let v = topR; v < vs; v += du) sideR.push([side(v, 1), v]);
  const sm = q => { const w = Math.max(2, Math.round(0.15 / du)), m = q.map((_, i) => { let b = 0; for (let j = Math.max(0, i - w); j <= Math.min(q.length - 1, i + w); j++) if (Math.abs(q[j][0]) > Math.abs(b)) b = q[j][0]; return b; }), a = avg(m, Math.round(0.1 / du)); return q.map((p, i) => [a[i], p[1]]); }, sL = sm(sideL), sR = sm(sideR);
  const uA = EL ? EL.I[0] : (sL.length ? sL[sL.length - 1][0] : uLs), uB = ER ? ER.I[0] : (sR.length ? sR[0][0] : uRs), crown = [];
  { const raw = []; for (let i = 0; i < us.length; i++) if (us[i] > uA && us[i] < uB) raw.push([us[i], vtop[i] ?? vc]); const a = avg(raw.map(p => Math.min(vc + 0.15, p[1])), 6); raw.forEach((p, i) => crown.push([p[0], a[i]])); }
  const jaw = []; { const pe = 2.6, cv = vchin - vs; for (let k = 0; k <= 24; k++) { const t = k / 24 * Math.PI / 2, c = Math.pow(Math.cos(t), 2 / pe), s = Math.pow(Math.sin(t), 2 / pe); jaw.push([nu + (uRs - nu) * c, vs + cv * s]); } for (let k = 23; k >= 0; k--) { const t = k / 24 * Math.PI / 2, c = Math.pow(Math.cos(t), 2 / pe), s = Math.pow(Math.sin(t), 2 / pe); jaw.push([nu + (uLs - nu) * c, vs + cv * s]); } }
  const head = [...sL, ...(EL ? [EL.O, EL.T, EL.I] : []), ...crown, ...(ER ? [ER.I, ER.T, ER.O] : []), ...sR, ...jaw];
  const inHead = polyFill(XYs(head), iw, ih);
  // forehead stripes: dark bands in the column profile between the ears
  const vb = -(re + 0.14), zl0 = EL ? EL.I[0] : -0.32, zr0 = ER ? ER.I[0] : 0.32, zl0c = Math.max(-0.55, Math.min(-0.2, zl0)), zr0c = Math.min(0.55, Math.max(0.2, zr0)), bl = -0.58, br = 0.58, zl = Math.min(zl0c, -0.3), zr = Math.max(zr0c, 0.3);
  // tabby forehead: 2–3 evenly spaced fan-shaped stripes (dark glass) with lighter fur between; the outer bands join the temples
  const zt = (u, v) => { const f = Math.max(0, Math.min(1, (v - vc) / (vb - vc))), a = zl + (bl - zl) * f, b = zr + (br - zr) * f; return (u - a) / (b - a || 1); };
  let zs = 0, zss = 0, zn = 0, ts = 0, tn = 0; for (let p = 0; p < N; p++) { if (!M[p]) continue; const u = U[p], v = V[p]; if (v >= vb || v < vc) continue; const t = zt(u, v), L0 = A0[p * 3]; if (t >= 0 && t < 1) { zs += L0; zss += L0 * L0; zn++; } else if (v > vc + 0.15 && Math.abs(u) < 1.1) { ts += L0; tn++; } }
  const zm = zn ? zs / zn : 0, zsd = zn ? Math.sqrt(Math.max(0, zss / zn - zm * zm)) : 0, tabby = zn > 50 && (zsd >= 9 || (tn > 50 && ts / tn - zm >= 6));
  const zw = ((zr - zl) + (br - bl)) / 2 * d, mw = ppi * 0.4; let stripes = []; const stripeC = Math.round(zsd);
  if (tabby) { const k = zw / 7 >= mw ? 3 : zw / 5 >= mw * 0.92 ? 2 : 0, nb = 2 * k + 1; for (let i = 0; i < k; i++) stripes.push({ a: (2 * i + 1) / nb, b: (2 * i + 2) / nb }); }
  const furT = stripes.length ? [stripes[0].a, stripes[stripes.length - 1].b] : [-1, 2];
  // labels in paint order
  const NAMES = ['bg', 'earL', 'innerL', 'earR', 'innerR', 'templeL', 'templeR', 'bridge', 'cheekL', 'cheekR', 'muzzleL', 'muzzleR', 'nose', 'chin', 'eyeL', 'eyeR', 'forehead'], id = n => NAMES.indexOf(n); stripes.forEach((s2, k) => NAMES.push('stripe' + k));
  const lab = new Int32Array(N).fill(0), ext = (a, t, k) => [a[0] + (a[0] - t[0]) * k, a[1] + (a[1] - t[1]) * k], earM = e => { if (!e) return null; const Tp = e.T, Ip = ext(e.I, Tp, 0.16), Op = ext(e.O, Tp, 0.16), Mp = [Ip[0] + (Op[0] - Ip[0]) * 0.6, Ip[1] + (Op[1] - Ip[1]) * 0.6], Tq = [Ip[0] + (Tp[0] - Ip[0]) * 0.74, Ip[1] + (Tp[1] - Ip[1]) * 0.74]; return { all: polyFill(XYs([Tp, Ip, Op]), iw, ih), inner: polyFill(XYs([Ip, Mp, Tq]), iw, ih), pin: [Tp, Ip, Op, Mp, Tq] }; };
  const eaL = earM(EL), eaR = earM(ER), nose = polyFill(XYs([[nu - 0.2, nv - 0.12], [nu + 0.2, nv - 0.12], [nu, nv + 0.13]]), iw, ih);
  const zone = polyFill(XYs([[zl, -3], [zr, -3], [br, vb], [bl, vb]]), iw, ih), eiL = -0.5 + re * 0.85, eiR = 0.5 - re * 0.85, bTop = stripes.length ? [bl + (br - bl) * furT[0], bl + (br - bl) * furT[1]] : [-0.3, 0.3], bridge = polyFill(XYs([[Math.max(bTop[0], eiL - 0.05), vb], [Math.min(bTop[1], eiR + 0.05), vb], [eiR, -0.02], [nu + 0.3, nv - 0.12], [nu - 0.3, nv - 0.12], [eiL, -0.02]]), iw, ih);
  const eyeIn = (e, x, y) => { const rx = (e.bb[2] - e.bb[0]) / 2 + 1.5, ry = (e.bb[3] - e.bb[1]) / 2 + 1.5, cx = (e.bb[0] + e.bb[2] + 1) / 2, cy = (e.bb[1] + e.bb[3] + 1) / 2; return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1; };
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const p = y * iw + x, u = U[p], v = V[p]; if (!inHead[p]) continue; let L;
    if (eyeIn(eL, x + 0.5, y + 0.5)) L = 'eyeL'; else if (eyeIn(eR, x + 0.5, y + 0.5)) L = 'eyeR'; else if (nose[p]) L = 'nose';
    else if (eaL && eaL.all[p]) L = eaL.inner[p] ? 'innerL' : 'earL'; else if (eaR && eaR.all[p]) L = eaR.inner[p] ? 'innerR' : 'earR';
    else if (((u - nu) / 0.5) ** 2 + ((v - mcv) / 0.28) ** 2 < 1) L = u < nu ? 'muzzleL' : 'muzzleR'; else if (v > mcv && Math.abs(u - nu) < 0.36) L = 'chin';
    else if (zone[p] && v < vb && (() => { const t = zt(u, v); return t >= furT[0] && t < furT[1]; })()) { const t = zt(u, v), k = stripes.findIndex(q => t >= q.a && t < q.b); L = k >= 0 ? 'stripe' + k : 'forehead'; } else if (bridge[p]) L = 'bridge';
    else if (v < 0) L = u < (bl + br) / 2 ? 'templeL' : 'templeR'; else L = u < nu ? 'cheekL' : 'cheekR'; lab[p] = id(L); }
  // background (and body below the head): a few calm sweeping pieces
  const bgL = calmBackground(A, inHead, iw, ih, { maxA: maxA * 0.9, pieces: 5 }), key = new Int32Array(N); for (let p = 0; p < N; p++) key[p] = inHead[p] ? lab[p] : V[p] > vs ? NAMES.length + (U[p] < nu ? 0 : 1) : NAMES.length + 2 + bgL[p]; // below the cheek line: the body as two calm pieces split under the chin (none wraps around the jaw)
  { // a label keeps its main part; stray crumbs (e.g. where an ear base overlaps a stripe) join the neighbour they share the most border with
    const c0 = components(key, iw, ih), ar = new Float64Array(c0.n); for (let p = 0; p < N; p++) ar[c0.R[p]]++;
    const big = new Map(), kOf = new Int32Array(c0.n); for (let p = 0; p < N; p++) kOf[c0.R[p]] = key[p]; for (let r = 0; r < c0.n; r++) { const k = kOf[r]; if (!big.has(k) || ar[r] > ar[big.get(k)]) big.set(k, r); }
    const crumb = r => big.get(kOf[r]) !== r && ar[r] < minA * 0.5, nb = new Map(); for (let p = 0; p < N; p++) { const r = c0.R[p]; if (!crumb(r)) continue; const x = p % iw, y = (p / iw) | 0; for (const q of [x > 0 ? p - 1 : -1, x < iw - 1 ? p + 1 : -1, y > 0 ? p - iw : -1, y < ih - 1 ? p + iw : -1]) if (q >= 0 && c0.R[q] !== r) { const m = nb.get(r) || nb.set(r, new Map()).get(r); m.set(key[q], (m.get(key[q]) || 0) + 1); } }
    const to = new Map(); for (const [r, m] of nb) to.set(r, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]); for (let p = 0; p < N; p++) { const t = to.get(c0.R[p]); if (t !== undefined) key[p] = t; } }
  const cc = components(key, iw, ih), type = cc.from.map(k => k < NAMES.length ? NAMES[k] : 'bg'), sumC = new Float64Array(cc.n * 4), area = new Float64Array(cc.n);
  for (let p = 0; p < N; p++) area[cc.R[p]]++;
  const col = [...Array(cc.n)].map(() => null), pxOf = [...Array(cc.n)].map(() => []); for (let p = 0; p < N; p++) pxOf[cc.R[p]].push(p);
  for (let r = 0; r < cc.n; r++) { let px = pxOf[r]; const t = type[r]; if (/^eye/.test(t)) { const e = t === 'eyeL' ? eL : eR; px = e.px.slice().sort((a, b) => A0[b * 3] - A0[a * 3]).slice(0, Math.max(1, Math.round(e.px.length * 0.15))); } else if (/stripe/.test(t)) px = px.slice().sort((a, b) => A0[a * 3] - A0[b * 3]).slice(0, Math.max(1, px.length >> 1)); else if (/^inner/.test(t)) px = px.slice().sort((a, b) => A0[b * 3 + 1] - A0[a * 3 + 1]).slice(0, Math.max(1, Math.round(px.length * 0.4))); else if (/^cheek/.test(t)) px = px.slice().sort((a, b) => A0[a * 3] - A0[b * 3]).slice(0, Math.max(1, px.length >> 1)); else if (/^(muzzle|chin)/.test(t)) px = px.slice().sort((a, b) => A0[b * 3] - A0[a * 3]).slice(0, Math.max(1, Math.round(px.length * 0.4))); else if (t === 'forehead' && stripes.length) px = px.slice().sort((a, b) => A0[b * 3] - A0[a * 3]).slice(0, Math.max(1, px.length >> 1)); else if (/inner/.test(t)) px = px.slice().sort((a, b) => A0[b * 3 + 1] - A0[a * 3 + 1]).slice(0, Math.max(1, px.length >> 1)); const c = [0, 0, 0]; for (const p of px) for (let k = 0; k < 3; k++) c[k] += F[p * 3 + k]; col[r] = c.map(v => v / px.length); }
  const KEY = /^(eye|nose|inner|stripe)/, subj = type.map(t => t === 'bg' ? 0 : 1), FEAT = /^(eye|nose|inner|stripe|ear|muzzle|chin|forehead)/, adv = type.map((t, r) => t !== 'bg' && area[r] >= minA * 0.2 && (KEY.test(t) || (FEAT.test(t) && area[r] < minA)) ? 1 : 0);
  // painted: pupils (the darkest part of each eye) and a few whiskers
  const dots = []; for (const e of [eL, eR]) { const px = e.px.slice().sort((a, b) => A0[a * 3] - A0[b * 3]), dk = px.slice(0, Math.max(3, Math.round(px.length * 0.12))); let sx = 0, sy = 0, sxx = 0, syy = 0; for (const p of dk) { const x = p % iw + 0.5, y = ((p / iw) | 0) + 0.5; sx += x; sy += y; sxx += x * x; syy += y * y; } const n = dk.length, mx = sx / n, my = sy / n, ex = (e.bb[2] - e.bb[0] + 1) / 2, ey = (e.bb[3] - e.bb[1] + 1) / 2; dots.push({ cx: mx, cy: my, rx: Math.max(ex * 0.16, Math.min(ex * 0.35, Math.sqrt(Math.max(0.2, sxx / n - mx * mx)) * 1.6)), ry: Math.max(ey * 0.5, Math.min(ey * 0.8, Math.sqrt(Math.max(0.2, syy / n - my * my)) * 2)), hex: '#141414' }); }
  const whiskers = []; for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const a = [nu + s * 0.42, nv + 0.12 + k * 0.08], b = [nu + s * (0.85 + k * 0.05), nv + 0.0 + k * 0.17], c = [nu + s * (1.25 + k * 0.05), nv - 0.04 + k * 0.3]; whiskers.push([a, b, c].map(([u, v]) => XY(u, v))); }
  const pins = [...(eaL ? eaL.pin : []), ...(eaR ? eaR.pin : []), [nu - 0.2, nv - 0.12], [nu + 0.2, nv - 0.12], [nu, nv + 0.13]].map(([u, v]) => XY(u, v));
  return { R: cc.R, n: cc.n, col, type, subj, adv, head: inHead, dots, whiskers, pins, stripes: stripes.length, stripeC, ears: (EL ? 1 : 0) + (ER ? 1 : 0), frame: { C0, d, ca, sa, re, nu, nv, vc, uLs, uRs, EL, ER } };
}
function calmBackground(A, mask, W, H, { pieces = 5, maxA = Infinity } = {}) {
  const N = W * H, r = Math.max(4, Math.round(Math.max(W, H) / 14)), ch = [0, 1, 2].map(c => { const a = new Float32Array(N), m = new Float32Array(N); for (let p = 0; p < N; p++) if (!mask[p]) { a[p] = A[p * 3 + c]; m[p] = 1; } const ba = blur1(a, W, H, r), bm = blur1(m, W, H, r); for (let p = 0; p < N; p++) ba[p] = bm[p] > 1e-3 ? ba[p] / bm[p] : 0; return ba; });
  const smp = [], stp = Math.max(1, Math.floor(N / 6000)); for (let p = 0; p < N; p += stp) if (!mask[p]) smp.push(ch[0][p], ch[1][p], ch[2][p]);
  const k = Math.max(2, Math.min(4, pieces - 2)), C = smp.length > 30 ? kmeans(new Float32Array(smp), k, 12, 11) : [[50, 0, 0]];
  let L = new Int32Array(N); for (let p = 0; p < N; p++) L[p] = mask[p] ? -1 : nearestC(C, ch[0][p], ch[1][p], ch[2][p]);
  // majority smoothing (per-label blur) → sweeping borders
  const sr = Math.max(3, Math.round(r * 0.8)); { const acc = C.map((_, i) => { const a = new Float32Array(N); for (let p = 0; p < N; p++) a[p] = L[p] === i ? 1 : 0; return blur1(a, W, H, sr); }); for (let p = 0; p < N; p++) if (!mask[p]) { let b = 0; for (let i = 1; i < C.length; i++) if (acc[i][p] > acc[b][p]) b = i; L[p] = b; } }
  // connected blobs; absorb small ones into the neighbour they share most border with
  for (let round = 0; round < 6; round++) { const key = new Int32Array(N); for (let p = 0; p < N; p++) key[p] = L[p] + 1; const cc = components(key, W, H), area = new Float64Array(cc.n); for (let p = 0; p < N; p++) area[cc.R[p]]++;
    let bgA = 0; for (let p = 0; p < N; p++) if (!mask[p]) bgA++; const small = i => cc.from[i] > 0 && area[i] < bgA / (pieces * 2.2); const nb = new Map();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, a = cc.R[p]; if (!small(a)) continue; for (const q of [x < W - 1 ? p + 1 : -1, y < H - 1 ? p + W : -1, x > 0 ? p - 1 : -1, y > 0 ? p - W : -1]) { if (q < 0) continue; const b = cc.R[q]; if (b === a || cc.from[b] === 0) continue; const m = nb.get(a) || new Map(); m.set(b, (m.get(b) || 0) + 1); nb.set(a, m); } }
    if (!nb.size) { L = new Int32Array(N); for (let p = 0; p < N; p++) L[p] = cc.from[cc.R[p]] === 0 ? -1 : cc.R[p]; break; }
    const to = new Map(); for (const [a, m] of nb) { let bb = -1, bv = -1; for (const [b, v] of m) if (v > bv) { bv = v; bb = b; } to.set(a, bb); }
    const lab = new Int32Array(cc.n); for (let i = 0; i < cc.n; i++) lab[i] = i; for (const [a, b] of to) lab[a] = to.has(b) && to.get(b) === a && b < a ? a : b;
    L = new Int32Array(N); for (let p = 0; p < N; p++) L[p] = cc.from[cc.R[p]] === 0 ? -1 : lab[cc.R[p]]; }
  // oversize blobs: split in two by colour + position (curved, follows the photo's soft light) until they fit
  for (let it = 0; it < 6; it++) { const area = new Map(); for (let p = 0; p < N; p++) if (L[p] >= 0) area.set(L[p], (area.get(L[p]) || 0) + 1); let big = -1, ba = maxA; for (const [l, a] of area) if (a > ba) { ba = a; big = l; } if (big < 0) break;
    const pts = [], idx = []; for (let p = 0; p < N; p++) if (L[p] === big) { idx.push(p); } const sc = 60 / Math.max(W, H), st2 = Math.max(1, Math.floor(idx.length / 4000)); for (let j = 0; j < idx.length; j += st2) { const p = idx[j]; pts.push(ch[0][p] * 0.5, ch[1][p] * 0.5, ch[2][p] * 0.5, (p % W) * sc, ((p / W) | 0) * sc); }
    const C2 = kmeans5(pts, 2), nl = Math.max(...area.keys()) + 1, tmp = new Float32Array(N); for (const p of idx) { const f = [ch[0][p] * 0.5, ch[1][p] * 0.5, ch[2][p] * 0.5, (p % W) * sc, ((p / W) | 0) * sc], d = C2.map(c => c.reduce((s, v, i) => s + (v - f[i]) ** 2, 0)); tmp[p] = d[1] < d[0] ? 1 : 0; }
    const bt = blur1(tmp, W, H, Math.max(3, Math.round(r * 0.8))); for (const p of idx) if (bt[p] > 0.5) L[p] = nl; }
  return L;
}
function kmeans5(pts, k) { const n = pts.length / 5, C = []; for (let i = 0; i < k; i++) C.push(pts.slice(Math.floor((i + 0.5) * n / k) * 5, Math.floor((i + 0.5) * n / k) * 5 + 5));
  for (let it = 0; it < 12; it++) { const acc = C.map(() => [0, 0, 0, 0, 0, 0]); for (let j = 0; j < n; j++) { let b = 0, bd = Infinity; for (let c = 0; c < k; c++) { let d = 0; for (let i = 0; i < 5; i++) d += (pts[j * 5 + i] - C[c][i]) ** 2; if (d < bd) { bd = d; b = c; } } for (let i = 0; i < 5; i++) acc[b][i] += pts[j * 5 + i]; acc[b][5]++; } acc.forEach((a, c) => { if (a[5]) for (let i = 0; i < 5; i++) C[c][i] = a[i] / a[5]; }); } return C; }
/* Perch / branch / wire under a subject: the dominant near-horizontal straight line among band contours (Hough), kept where it is
   continuously supported; extended to the panel edge when it nearly reaches it. Returns [[x,y],[x,y]] in image px or null. */
function houghPerch(thin, band, W, H, ppi, minSpan, footY = null, sig = 1e9) {
  const pts = []; for (let p = 0; p < W * H; p++) if (thin[p] && band[p]) pts.push([p % W, (p / W) | 0]); if (pts.length < 20) return null;
  let best = null; for (let deg = -40; deg <= 40; deg += 2) { const t = deg * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t), acc = new Map();
    for (const [x, y] of pts) { const r = Math.round((y * c - x * sn) / 1.5), w = footY == null ? 1 : Math.exp(-((y - footY) ** 2) / (2 * sig * sig)); acc.set(r, (acc.get(r) || 0) + w); }
    for (const [r, v] of acc) if (!best || v > best.v) best = { v, t, r: r * 1.5 }; }
  const c = Math.cos(best.t), sn = Math.sin(best.t), on = pts.filter(([x, y]) => Math.abs(y * c - x * sn - best.r) <= 2).map(([x, y]) => x * c + y * sn).sort((a, b) => a - b);
  let s0 = 0, bs = 0, be = 0; for (let i = 1; i <= on.length; i++) if (i === on.length || on[i] - on[i - 1] > ppi * 0.6) { if (on[i - 1] - on[s0] > be - bs) { bs = on[s0]; be = on[i - 1]; } s0 = i; }
  const cnt = on.filter(u => u >= bs && u <= be).length; if (be - bs < minSpan * 0.6 || cnt < (be - bs) * 0.45) return null;
  const at = u => [u * c - best.r * sn, u * sn + best.r * c]; let a = at(bs), b = at(be);
  const ext = (q, dir) => { for (let k = 0; k < ppi * 1.2; k++) { const nq = [q[0] + dir * c, q[1] + dir * sn]; if (nq[0] <= 0 || nq[0] >= W - 1 || nq[1] <= 0 || nq[1] >= H - 1) return nq; q = nq; } return null; };
  const ea = ext(a, -1), eb = ext(b, 1); if (ea) a = ea; if (eb) b = eb; return [a, b];
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
/* Auto subject (no tap): only when the usual subject finder fails (busy scene: saliency covers > 40% of the frame, or nothing stands
   out). Looks for a compact, colour-distinct blob (e.g. a robin's orange breast against a green garden and a fence) and builds the
   same box a tap there would. Returns { box, at:[fx,fy] }, { box: null, busy: true } (busy scene, nothing found) or null (normal finder is fine). */
async function glassAutoSubject(src) {
  const im = typeof src === 'string' ? await loadImg(src) : src, w0 = im.naturalWidth || im.width, h0 = im.naturalHeight || im.height, s = Math.min(1, 160 / Math.max(w0, h0)), W = Math.max(8, Math.round(w0 * s)), H = Math.max(8, Math.round(h0 * s));
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data, N = W * H, F = new Float32Array(N * 3); for (let i = 0; i < N; i++) { F[i * 3] = d[i * 4]; F[i * 3 + 1] = d[i * 4 + 1]; F[i * 3 + 2] = d[i * 4 + 2]; }
  const A = bilateral(toLab(F, N), W, H, 1, 10, 2), E = sobelEdges(A, W, H), m = subjectMask(F, A, E, W, H, {}, []);
  const axA = axisEdgeFrac(A, E, W, H); if (m.how === 'backdrop' || (m.how === 'saliency' && m.frac <= 0.4) || axA >= 0.5) return null;
  if (axA >= 0.4) { const fzA = facadeLayout(A, F, W, H, W / 12); if (fzA && fzA.ops.filter(q => q.type && q.type !== 'wall').length >= 3) return null; } // a building facade: no single subject
  const smp = []; for (let p = 0; p < N; p += 2) smp.push(A[p * 3], A[p * 3 + 1], A[p * 3 + 2]);
  const KC = kmeans(new Float32Array(smp), 12, 12, 9), kw = new Float64Array(KC.length), kl = new Int32Array(N); for (let p = 0; p < N; p++) { kl[p] = nearestC(KC, A[p * 3], A[p * 3 + 1], A[p * 3 + 2]); kw[kl[p]]++; }
  const rar = KC.map((c1, i) => KC.reduce((a, d2, j) => a + kw[j] / N * Math.hypot(c1[0] - d2[0], c1[1] - d2[1], c1[2] - d2[2]), 0)), rmx = Math.max(...rar) || 1;
  const sc = new Float32Array(N); for (let p = 0; p < N; p++) sc[p] = rar[kl[p]] / rmx * (0.4 + 0.6 * Math.min(1, Math.hypot(A[p * 3 + 1], A[p * 3 + 2]) / 40));
  const sb = blur1(sc, W, H, 1); let mx = 0; for (let p = 0; p < N; p++) mx = Math.max(mx, sb[p]); const bin = new Uint8Array(N); for (let p = 0; p < N; p++) bin[p] = sb[p] > mx * 0.62 ? 1 : 0;
  const cc = components(bin, W, H), st = new Map(); for (let p = 0; p < N; p++) { const r = cc.R[p]; if (cc.from[r] !== 1) continue; const x = p % W, y = (p / W) | 0; let o = st.get(r); if (!o) st.set(r, o = { n: 0, s: 0, x0: W, y0: H, x1: 0, y1: 0, sx: 0, sy: 0, l: [0, 0, 0] }); o.n++; o.s += sb[p]; o.sx += x; o.sy += y; o.x0 = Math.min(o.x0, x); o.x1 = Math.max(o.x1, x); o.y0 = Math.min(o.y0, y); o.y1 = Math.max(o.y1, y); for (let k = 0; k < 3; k++) o.l[k] += A[p * 3 + k]; }
  let best = null; const all = []; for (const [r, o] of st) { if (o.n < N * 0.002 || o.n > N * 0.15) continue; const comp = o.n / ((o.x1 - o.x0 + 1) * (o.y1 - o.y0 + 1)); if (comp < 0.35) continue;
    const lab = o.l.map(v => v / o.n), cx = o.sx / o.n, cy = o.sy / o.n, rr = Math.sqrt(o.n) * 0.9; let rs = [0, 0, 0], rn = 0; for (let y = Math.max(0, Math.round(o.y0 - rr)); y <= Math.min(H - 1, Math.round(o.y1 + rr)); y++) for (let x = Math.max(0, Math.round(o.x0 - rr)); x <= Math.min(W - 1, Math.round(o.x1 + rr)); x++) { const p = y * W + x; if (cc.R[p] === r) continue; for (let k = 0; k < 3; k++) rs[k] += A[p * 3 + k]; rn++; }
    const con = rn ? Math.hypot(...rs.map((v, k) => v / rn - lab[k])) : 0; if (con < 18) continue; const v = o.s / o.n * Math.sqrt(comp) * Math.sqrt(o.n / N) * con; const cand = { v, fx: cx / W, fy: cy / H, lab, n: o.n }; all.push(cand); if (!best || v > best.v) best = cand; }
  // two alike blobs side by side (a pair of eyes) are features of a larger subject, not the subject
  if (best && all.some(q => q !== best && Math.hypot(...q.lab.map((v, k) => v - best.lab[k])) < 15 && Math.max(q.n, best.n) / Math.min(q.n, best.n) < 2.5 && Math.abs(q.fy - best.fy) < 0.12 && Math.abs(q.fx - best.fx) > 0.08)) return null;
  if (!best) return { box: null, busy: true }; return { box: await glassTapBox(im, best.fx, best.fy), at: [best.fx, best.fy] };
}
/* ---------- main build ---------- */
function glassDefaults() { return { method: 'trace', colors: 6, tcolors: 12, tool: 'grinder', tpaint: true, tpaintAmt: 'medium', simplicity: 4, detail: 7, zoom: true, style: 'auto', smallFeat: 'pieces', paint: true, widthIn: 12, unit: 'in', focus: true, frame: true, frameIn: 1, line: 'foil116', frameGlass: '' }; }
function glassGeometry(o, aspect) { // aspect = h/w of image
  const fw = o.frame ? o.frameIn : 0, widthIn = Math.max(2, +o.widthIn || 12), heightIn = Math.max(2, o.heightIn ? +o.heightIn : r2(widthIn * aspect));
  const long = Math.max(widthIn, heightIn), hi = o.method !== 'stylized', ppi = hi && o.engine !== 'v6' ? Math.max(160 / long, Math.min(80, 800 / long)) : Math.max(160 / long, Math.min(hi ? 40 : 24, (hi ? 720 : 420) / long)); // traced photos get a finer grid so curves follow the photo
  const gridW = Math.round(widthIn * ppi), gridH = Math.round(heightIn * ppi), f = Math.round(fw * ppi);
  return { widthIn, heightIn, ppi: gridW / widthIn, gridW, gridH, f, innerW: gridW - 2 * f, innerH: gridH - 2 * f };
}
const r2 = n => Math.round(n * 100) / 100;
function glassRules(o) { const s = Math.max(1, Math.min(10, +o.simplicity || 5)); return { minAreaIn: 0.6 + s * 0.35, minWidthIn: 0.3 + s * 0.02, maxAreaIn: 48, blur: 1 + Math.floor(s / 3), majority: 1 + Math.floor(s / 3), eps: 0.6 + s * 0.12, beginnerMax: 35 }; }

/* img: {width,height,data(RGBA)} already sized innerW x innerH */
function glassBuild(img, o) {
  o = { ...glassDefaults(), ...o };
  // v7: "Trace photo" runs the PhotoTracer engine (tracer.js: faithful trace → cut pattern → paint lines); o.engine = 'v6' keeps the legacy tracer below
  if (o.method !== 'stylized' && o.engine !== 'v6' && typeof PhotoTracer !== 'undefined') { const G7 = glassGeometry(o, img.aspect || img.height / img.width);
    return PhotoTracer.trace({ ...img, f: o.frame ? G7.f : 0 }, o, glassTraceEnv(o)); }
  o = { ...glassDefaults(), ...o }; const tr = o.method !== 'stylized', G = glassGeometry(o, img.aspect || img.height / img.width), rules = tr ? traceRules(o) : glassRules(o);
  if (G.innerW !== img.width || G.innerH !== img.height) throw new Error(`image is ${img.width}×${img.height}, expected ${G.innerW}×${G.innerH}`);
  const W = G.gridW, H = G.gridH, iw = img.width, ih = img.height, ppi = G.ppi, notes = [];
  // photo → Lab, edge-preserving smoothing, colour edges
  const n0 = iw * ih; let F = new Float32Array(n0 * 3); for (let i = 0; i < n0; i++) { const a = img.data[i * 4 + 3] / 255; F[i * 3] = img.data[i * 4] * a + 255 * (1 - a); F[i * 3 + 1] = img.data[i * 4 + 1] * a + 255 * (1 - a); F[i * 3 + 2] = img.data[i * 4 + 2] * a + 255 * (1 - a); }
  const A = bilateral(toLab(F, n0), iw, ih, 2, 8 + rules.blur * 2, 2), E = sobelEdges(A, iw, ih);
  const minA = rules.minAreaIn * ppi * ppi, minW = rules.minWidthIn * ppi, det = Math.max(1, Math.min(10, +o.detail || 6)), sim = Math.max(1, Math.min(10, +o.simplicity || 5));
  // subject (with optional Grok box, given in photo coords → panel coords via the crop)
  const cr = img.crop || [0, 0, 1, 1], toIn = b => [(b[0] - cr[0]) / cr[2], (b[1] - cr[1]) / cr[3], (b[2] - cr[0]) / cr[2], (b[3] - cr[1]) / cr[3]].map(v => Math.max(0, Math.min(1, v)));
  let ih2 = 0; for (let i = 0; i < img.data.length; i += 997) ih2 = (ih2 * 31 + img.data[i]) | 0;
  const sm = tr ? { mask: new Uint8Array(n0).fill(1), how: 'off', frac: 1 } : o.focus ? subjectMask(F, A, E, iw, ih, { subjectBox: o.subjectBox ? toIn(o.subjectBox) : null, cacheKey: cr.join(',') + ':' + ih2 + ':' + rules.blur }, notes) : { mask: new Uint8Array(n0).fill(1), how: 'off', frac: 1 };
  let mask = sm.mask, featMap = null;
  if (o.features && o.features.length) { featMap = new Uint8Array(n0); for (const f of o.features) { const bx = toIn(f.box); for (let y = Math.floor(bx[1] * ih); y < Math.ceil(bx[3] * ih); y++) for (let x = Math.floor(bx[0] * iw); x < Math.ceil(bx[2] * iw); x++) featMap[y * iw + x] = 1; } }
  // superpixels → merge across weak edges (detail on subject, big simple pieces behind)
  const subjT = minA * (1 + (10 - det) * 0.15), featT = minA, bgT = minA * (2.5 + sim * 0.5);
  const S0 = Math.max(4, Math.min(9, Math.round(Math.sqrt(minA) * 0.3)));
  const Cm = contourMap(A, E, iw, ih), Ec = new Float32Array(n0); for (let p = 0; p < n0; p++) Ec[p] = Cm[p] ? 1 : E[p] * 0.25;
  const axf = tr ? 0 : axisEdgeFrac(A, E, iw, ih), fz0 = !tr && o.style !== 'organic' && o.facade !== false && sm.how !== 'backdrop' && (o.style === 'geometric' || axf >= 0.4) ? facadeLayout(A, F, iw, ih, ppi) : null;
  // a building: mostly straight edges, or nearly so and a facade (sky, windows, doors) is actually found
  const geo = !tr && (o.style === 'geometric' || (o.style !== 'organic' && (axf >= 0.5 || (!!fz0 && fz0.ops.filter(q => q.type && q.type !== 'wall').length >= 3))));
  if (geo && o.style !== 'geometric') notes.push('Straight-line style chosen automatically (lots of horizontal/vertical edges, e.g. a building) — windows and doors become rectangles. Switch Style to Organic for curves.');
  if (geo && sm.how !== 'backdrop') { sm.mask.fill(1); sm.how = 'off'; sm.frac = 1; }
  // an animal face (two eyes found): a stylised, cuttable head layout replaces the free-form merge
  const fc = !tr && !geo && o.face !== false && o.style !== 'geometric' && o.smallFeat !== 'off' && o.focus !== false ? faceLayout(A, F, iw, ih, ppi, minA, rules.maxAreaIn * ppi * ppi) : null;
  if (fc) { mask = fc.head; sm.mask = fc.head; sm.how = 'face'; let hs = 0; for (let p = 0; p < n0; p++) hs += fc.head[p]; sm.frac = hs / n0; }
  const advMinIn = Math.max(0.35, rules.minAreaIn * 0.18), advMin = !tr && o.smallFeat === 'pieces' ? advMinIn * ppi * ppi : 0, advDE = 22;
  const sp = tr ? null : geo ? xyCut(A, iw, ih, Math.max(3, Math.round(Math.sqrt(minA) * 0.35)), Math.round(n0 / (S0 * S0 * 2)), 0.5) : slic(A, iw, ih, S0, mask, 6);
  // calm background behind a found subject: a few large sweeping pieces from heavily blurred colour areas, so the subject pops
  const calm = !tr && !geo && !fc && o.calmBg !== false && !!o.subjectBox && ['grok', 'box'].includes(sm.how) && sm.frac < 0.45;
  if (calm) { const bgL = calmBackground(A, mask, iw, ih, { maxA: rules.maxAreaIn * ppi * ppi * 0.9, pieces: Math.max(4, Math.min(7, Math.round(n0 * (1 - sm.frac) / (rules.maxAreaIn * ppi * ppi * 0.55)))) }), key = new Int32Array(n0); let mx = 0; for (let p = 0; p < n0; p++) mx = Math.max(mx, sp.R[p]);
    for (let p = 0; p < n0; p++) key[p] = mask[p] ? sp.R[p] : mx + 1 + bgL[p]; const c = components(key, iw, ih); sp.R = c.R; sp.n = c.n; }
  const fz = geo ? fz0 : null;
  const rm = tr ? traceSegment(F, iw, ih, ppi, rules) : fz ? { R: fz.R, n: fz.n } : fc ? { R: fc.R, n: fc.n } : ragMerge(sp.R, sp.n, A, Ec, mask, iw, ih, { subjT, featT, bgT, crumb: minA * 0.25, absMin: minA * 0.6, weakT: 0.15, strongT: 0.45 - det * 0.015, hardCap: Math.round(n0 / (minA * 1.5)), subjMax: subjT * 4, bgMax: rules.maxAreaIn * ppi * ppi, keepSil: sm.how !== 'none' && sm.how !== 'off', featMap, advMin, advDE, geo });
  const RN = rm.n, rs3 = new Float64Array(RN * 3), ra = new Float64Array(RN), rsub = new Float64Array(RN);
  for (let p = 0; p < n0; p++) { const r = rm.R[p]; ra[r]++; rs3[r * 3] += F[p * 3]; rs3[r * 3 + 1] += F[p * 3 + 1]; rs3[r * 3 + 2] += F[p * 3 + 2]; rsub[r] += mask[p]; }
  const colors = fz ? fz.col.map(c => c.slice()) : fc ? fc.col.map(c => c.slice()) : [...Array(RN).keys()].map(r => [rs3[r * 3] / ra[r], rs3[r * 3 + 1] / ra[r], rs3[r * 3 + 2] / ra[r]]), subjOfLab = fc ? fc.subj.slice() : [...Array(RN).keys()].map(r => rsub[r] / ra[r] > 0.5 ? 1 : 0);
  if (calm) { // small subject pieces on the outline that look like the background next to them (a pole, a bit of fence) belong to the background
    const lab3 = new Float64Array(RN * 3); for (let p = 0; p < n0; p++) { const r = rm.R[p]; lab3[r * 3] += A[p * 3]; lab3[r * 3 + 1] += A[p * 3 + 1]; lab3[r * 3 + 2] += A[p * 3 + 2]; }
    const lb = r => [lab3[r * 3] / ra[r], lab3[r * 3 + 1] / ra[r], lab3[r * 3 + 2] / ra[r]], dB = new Float64Array(RN).fill(1e9), bN = new Int32Array(RN).fill(-1), dS = new Float64Array(RN).fill(1e9), nb = new Float64Array(RN), sA = subjOfLab.reduce((a, v, r) => a + (v ? ra[r] : 0), 0);
    const pr = (a, b) => { if (a === b) return; const d = Math.hypot(...lb(a).map((v, k) => v - lb(b)[k])); for (const [u, w] of [[a, b], [b, a]]) { if (!subjOfLab[u]) continue; if (subjOfLab[w]) dS[u] = Math.min(dS[u], d); else { if (d < dB[u]) { dB[u] = d; bN[u] = w; } nb[u]++; } } };
    for (let y = 0; y < ih - 1; y++) for (let x = 0; x < iw - 1; x++) { const p = y * iw + x; pr(rm.R[p], rm.R[p + 1]); pr(rm.R[p], rm.R[p + iw]); }
    for (let r = 0; r < RN; r++) if (subjOfLab[r] && ra[r] < sA * 0.1 && ((nb[r] > Math.sqrt(ra[r]) * 0.8 && dB[r] < 16 && dB[r] < dS[r] * 0.8) || (nb[r] > Math.sqrt(ra[r]) * 2.2 && dB[r] < 20 && dB[r] < dS[r]))) { subjOfLab[r] = 0; for (let p = 0; p < n0; p++) if (rm.R[p] === r) { mask[p] = 0; if (bN[r] >= 0) rm.R[p] = bN[r]; } } }
  // key small features (eyes, nose, windows, door): small but high-contrast regions on the subject are kept as "advanced" pieces
  const advOfLab = new Uint8Array(RN); if (fc) fc.adv.forEach((v, r) => advOfLab[r] = v); if (tr && rm.adv) rm.adv.forEach((v, r) => advOfLab[r] = v);
  if (advMin && !fc) { const rl = new Float64Array(RN * 3), fa = new Float64Array(RN); for (let p = 0; p < n0; p++) { const r = rm.R[p]; rl[r * 3] += A[p * 3]; rl[r * 3 + 1] += A[p * 3 + 1]; rl[r * 3 + 2] += A[p * 3 + 2]; if (featMap) fa[r] += featMap[p]; }
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
  if (!tr) mergeSmall(st, W, H, minA * 0.35, ppi);                    // drop speckles first (a traced photo already has none)
  openPieces(st, W, H, minW, tr); Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv));
  mergeSmall(st, W, H, tr ? minA * 0.5 : minA, ppi); // traced: only the crumbs left by trimming narrow necks
  let rings;
  for (let round = 0; round < 4; round++) {
    // oversize → split; holes → split through the hole
    let changed = false; const s = regionStats(st.R, st.n, W, H);
    for (let i = 0, n0 = st.n; i < n0; i++) if (!st.fixed[i] && s.area[i] > rules.maxAreaIn * ppi * ppi) { splitRegion(st, W, H, i, Math.ceil(s.area[i] / (rules.maxAreaIn * ppi * ppi * 0.7)), groups++); changed = true; }
    if (changed) Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv));
    if (fixCheckers(st.R, W, H)) { Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv)); mergeSmall(st, W, H, tr ? minA * 0.5 : minA, ppi); fixCheckers(st.R, W, H); Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv)); }
    const tr = traceRegions(st.R, st.n, W, H); let holes = 0;
    tr.rings.forEach((rs, i) => { if (rs.length < 2 || st.fixed[i]) return; const pts = rs.map(r => r.map(v => [v % tr.VW, Math.floor(v / tr.VW)])), ar = pts.map(p => Math.abs(ringArea(p))), outer = ar.indexOf(Math.max(...ar));
      pts.forEach((hp, j) => { if (j === outer) return; const cx = Math.round(hp.reduce((a, p) => a + p[0], 0) / hp.length), cy = hp.reduce((a, p) => a + p[1], 0) / hp.length, g = groups++, base = st.n;
      if (tr) { // two short straight cuts from the hole to the piece's outside edge (the two shortest rays at least 60° apart); the wedge between them becomes its own piece
        const ray = t => { const dx = Math.cos(t), dy = Math.sin(t); let inR = false, len = 0; for (let k = 0; k < W + H; k++) { const x = Math.floor(cx + dx * k * 0.5), y = Math.floor(cy + dy * k * 0.5); if (x < 0 || y < 0 || x >= W || y >= H) return inR ? len : Infinity; const r = st.R[y * W + x]; if (r === i) { inR = true; len += 0.5; } else if (inR) return len; } return Infinity; };
        const K = 24, rl = [...Array(K)].map((_, k) => [ray(k * 2 * Math.PI / K), k * 2 * Math.PI / K]).sort((a, b) => a[0] - b[0]), t1 = rl[0][1], t2 = (rl.find(r => { const d = Math.abs(r[1] - t1) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d) >= Math.PI / 3 - 1e-6; }) || rl[1])[1];
        let a0 = Math.min(t1, t2), a1 = Math.max(t1, t2); const inside = a1 - a0 <= Math.PI; // the smaller wedge
        const px = []; for (let q = 0; q < W * H; q++) if (st.R[q] === i) { px.push(q); let an = Math.atan2(((q / W) | 0) + 0.5 - cy, q % W + 0.5 - cx); if (an < 0) an += 2 * Math.PI; const w = an >= a0 && an <= a1; if (w === inside) st.R[q] = base; }
        // keep only the cuts next to the hole: parts of the region the line crosses further away rejoin their neighbour across it
        const cl = new Int32Array(px.length).fill(-1), at = new Map(px.map((q, k) => [q, k])), sz = []; let nc = 0;
        for (let k = 0; k < px.length; k++) { if (cl[k] >= 0) continue; const lab0 = st.R[px[k]], stk = [k]; cl[k] = nc; let m = 0; while (stk.length) { const u = stk.pop(), q = px[u]; m++; for (const v of [q - 1, q + 1, q - W, q + W]) { const w = at.get(v); if (w !== undefined && cl[w] < 0 && st.R[v] === lab0) { cl[w] = nc; stk.push(w); } } } sz.push(m); nc++; }
        const nearC = [i, base].map(l => { let bk = -1, bd = Infinity; for (let k = 0; k < px.length; k++) if (st.R[px[k]] === l) { const d = Math.hypot(px[k] % W + 0.5 - cx, ((px[k] / W) | 0) + 0.5 - cy); if (d < bd) { bd = d; bk = k; } } return bk >= 0 ? cl[bk] : -1; });
        for (let pass = 0; pass < 3; pass++) for (let k = 0; k < px.length; k++) { const c = cl[k]; if (nearC.includes(c)) continue; const q = px[k]; for (const v of [q - 1, q + 1, q - W, q + W]) { const w = at.get(v); if (w !== undefined && st.R[v] !== st.R[q]) { const to = cl[w], toL = st.R[v]; for (let k2 = 0; k2 < px.length; k2++) if (cl[k2] === c) { cl[k2] = to; st.R[px[k2]] = toL; } break; } } } } // the shortest straight cut through the hole
      else for (let q = 0; q < W * H; q++) if (st.R[q] === i && q % W >= cx) st.R[q] = base; st.col.push(st.col[i]); st.fixed.push(0); st.group.push(g); if (st.subj) st.subj.push(st.subj[i]); if (st.adv) st.adv.push(st.adv[i]); st.group[i] = g; st.n++; holes++; }); });
    if (!holes && !changed) break;
    Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv)); mergeSmall(st, W, H, tr ? minA * 0.5 : minA, ppi);
  }
  fixCheckers(st.R, W, H); Object.assign(st, rebuild(st.R, W, H, st.col, st.fixed, st.group, st.subj, st.adv));
  const chains = []; rings = vectorize(st.R, st.n, W, H, { smooth: geo ? 0 : tr ? rules.smooth : 3, eps: geo ? 0.75 : rules.eps, chains, pins: fc ? fc.pins.map(([x, y]) => [x + G.f, y + G.f]) : null });
  if (geo) { rings.forEach(rs => rs && rs.forEach(r => r.forEach(q => q.hard = true))); chains.forEach(c => c.pts && c.pts.forEach(q => q.hard = true)); }
  // piece colours: the photo's average under each piece, then grouped into the chosen number of glass colours
  const sa = new Float64Array(st.n * 4); { for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const r = st.R[(y + G.f) * W + x + G.f], q = y * iw + x; if (st.fixed[r]) continue; sa[r * 4] += F[q * 3]; sa[r * 4 + 1] += F[q * 3 + 1]; sa[r * 4 + 2] += F[q * 3 + 2]; sa[r * 4 + 3]++; }
    if (!fz && !fc) for (let r = 0; r < st.n; r++) if (sa[r * 4 + 3]) st.col[r] = [sa[r * 4] / sa[r * 4 + 3], sa[r * 4 + 1] / sa[r * 4 + 3], sa[r * 4 + 2] / sa[r * 4 + 3]]; }
  const kc = Math.max(2, Math.min(10, Math.round(o.colors))), qs = [];
  for (let r = 0; r < st.n; r++) if (!st.fixed[r] && (!calm || st.subj[r])) { const reps = Math.max(1, Math.min(40, Math.round(sa[r * 4 + 3] / minA * 2 * (st.subj[r] && sm.frac < 0.45 ? 3 : 1)))); for (let k = 0; k < reps; k++) qs.push(...st.col[r]); }
  const qC = kmeans(new Float32Array(qs), kc, 20, 13), userCols = (o.userColors || []).map(u => [u.name, ...[1, 3, 5].map(i => parseInt(u.hex.slice(i, i + 2), 16))]);
  const glassOf = r => st.fixed[r] ? { name: o.frameGlass || nearestGlass(dark).name, rgb: st.col[r] } : tr || fz || fc ? nearestGlass(st.col[r], userCols) : calm && !st.subj[r] ? nearestGlass(st.col[r], userCols) : calm && (() => { const c0 = Math.hypot(...gLab(...st.col[r]).slice(1)); return c0 >= 30 && Math.hypot(...gLab(...qC[nearestC(qC, ...st.col[r])]).slice(1)) < c0 * 0.6; })() ? nearestGlass(st.col[r], userCols) : nearestGlass(qC[nearestC(qC, ...st.col[r])], userCols);
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
  // a subject piece never shares its glass with a background piece it touches (the silhouette must read in glass, not only in lead)
  if (calm) { const byId = new Map(pieces.map(p => [p.id, p])), adj = new Map();
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) { const a = st.R[y * W + x]; for (const b of [st.R[y * W + x + 1], st.R[(y + 1) * W + x]]) { if (a === b) continue; const pa = byId.get(a), pb = byId.get(b); if (!pa || !pb || pa.frame || pb.frame || pa.subj === pb.subj) continue; const sp2 = pa.subj ? pa : pb, bp = pa.subj ? pb : pa; (adj.get(sp2.id) || adj.set(sp2.id, new Set()).get(sp2.id)).add(bp.glass); } }
    const bgGlass = new Set(pieces.filter(p => !p.subj && !p.frame).map(p => p.glass)), bgRGB = pieces.filter(p => !p.subj && !p.frame).map(p => p.rgb);
    for (const [id, used] of adj) { const pc = byId.get(id); if (pc.user || !used.has(pc.glass)) continue; const c = st.col[id], lc = gLab(...c), neutral = Math.hypot(lc[1], lc[2]) < 16; const cand = GLASS_PALETTE.filter(g => !bgGlass.has(g[0]) && (() => { const gl = gLab(g[1], g[2], g[3]), gc = Math.hypot(gl[1], gl[2]); return neutral ? gc < 12 : gc < 12 || (gl[1] * lc[1] + gl[2] * lc[2]) / (gc * Math.hypot(lc[1], lc[2])) > 0.7; })()).map(g => ({ g, d: cdist(c, [g[1], g[2], g[3]]), far: Math.min(...bgRGB.map(b => cdist(b, [g[1], g[2], g[3]]))) })); if (!cand.length) continue;
      const bd = Math.min(...cand.map(o => o.d)), best = cand.filter(o => o.d <= (neutral ? bd * 3 + 80 : bd * 1.15 + 12)).sort((a, b) => b.far - a.far)[0].g; pc.glass = best[0]; pc.rgb = [best[1], best[2], best[3]]; } }
  // calm subject: in the lower body, lighter neutral parts (a belly) get light glass and darker ones (wing, tail) dark glass, so they never merge
  if (calm) { const sp2 = pieces.filter(p => p.subj && !p.user), bgG = new Set(pieces.filter(p => !p.subj && !p.frame).map(p => p.glass));
    if (sp2.length) { const ys = sp2.map(p => p.label[1]), y0 = Math.min(...ys), y1 = Math.max(...ys), neu = sp2.filter(p => { const l = gLab(...p.src); return Math.hypot(l[1], l[2]) < 18 && p.label[1] > y0 + (y1 - y0) * 0.35; });
      if (neu.length >= 2) { const Ls = neu.map(p => gLab(...p.src)[0]).sort((a, b) => a - b), med = Ls[Math.floor(Ls.length / 2)], pick = names => { for (const n of names) { const g = GLASS_PALETTE.find(q => q[0] === n); if (g && !bgG.has(n)) return g; } return null; };
        const light = pick(['White opal', 'Wispy white', 'Clear textured', 'Light gray']), dark = pick(['Charcoal', 'Medium gray', 'Black opal']), xs2 = sp2.map(p => p.label[0]), cx = (Math.min(...xs2) + Math.max(...xs2)) / 2, bw2 = Math.max(...xs2) - Math.min(...xs2) || 1, chr = p => { const l = gLab(...p.src); return Math.hypot(l[1], l[2]); }, breast = sp2.reduce((a, p) => chr(p) > chr(a) ? p : a), front = Math.sign(breast.label[0] - cx) || 1;
        for (const p of neu) { const L = gLab(...p.src)[0], g = L >= med + 2 && (p.label[0] - cx) * front >= -bw2 * 0.1 ? light : L <= med - 2 ? dark : null; if (g) { p.glass = g[0]; p.rgb = [g[1], g[2], g[3]]; } } } } }
  // face: features never share glass with what they touch (inner ear vs ear, stripes vs fur, eyes, nose, muzzle), and the background contrasts with the head
  if (fc) { const byId = new Map(pieces.map(p => [p.id, p])), tc = new Map();
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const r = st.R[(y + G.f) * W + x + G.f], t = fc.type[fc.R[y * iw + x]]; let m = tc.get(r); if (!m) tc.set(r, m = new Map()); m.set(t, (m.get(t) || 0) + 1); }
    for (const p of pieces) { const m = tc.get(p.id); p.part = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : 'frame'; }
    const adj = new Map(pieces.map(p => [p.id, new Set()])); for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) { const a = st.R[y * W + x]; for (const b of [st.R[y * W + x + 1], st.R[(y + 1) * W + x]]) if (a !== b && byId.has(a) && byId.has(b) && !byId.get(a).frame && !byId.get(b).frame) { adj.get(a).add(b); adj.get(b).add(a); } }
    const FEAT = /^(eye|nose|inner|stripe|ear|muzzle|chin|forehead)/, must = (a, b) => a.subj !== b.subj || FEAT.test(a.part) || FEAT.test(b.part), lum = c => gLab(...c)[0];
    const pick = (p, avoid, pref) => { const neu = Math.hypot(...gLab(...p.src).slice(1)) < 14 && !/^inner|^nose|^eye/.test(p.part), c = GLASS_PALETTE.filter(g => (!neu || !p.subj || Math.hypot(...gLab(g[1], g[2], g[3]).slice(1)) < 14) && !avoid.some(q => q[0] === g[0] || cdist([g[1], g[2], g[3]], q[1]) < (p.subj ? 40 : 70)) && (!pref || pref(g))).map(g => [g, cdist(p.src, [g[1], g[2], g[3]])]).sort((a, b) => a[1] - b[1]); return c.length ? c[0][0] : null; };
    const G3 = g => [g[1], g[2], g[3]], chrG = g => Math.hypot(...gLab(...G3(g)).slice(1)), byName = n => GLASS_PALETTE.find(g => g[0] === n), nearestIn = (c, list) => list.map(byName).filter(Boolean).sort((a, b) => cdist(c, G3(a)) - cdist(c, G3(b)))[0];
    for (const p of pieces) { if (p.frame || p.user) continue; const lc = gLab(...p.src), chr = Math.hypot(lc[1], lc[2]); let g = null;
      if (/^inner/.test(p.part)) g = nearestIn(p.src, ['Pink', 'Flesh / peach', 'Rose']);
      else if (p.part === 'nose') g = lc[1] > 6 ? nearestIn(p.src, ['Pink', 'Rose', 'Flesh / peach']) : nearestIn(p.src, ['Charcoal', 'Black opal', 'Brown']);
      else if (/^eye/.test(p.part)) g = GLASS_PALETTE.filter(q => chrG(q) >= 25).sort((a, b) => cdist(p.src, G3(a)) - cdist(p.src, G3(b)))[0];
      else if (chr < 14) g = GLASS_PALETTE.filter(q => chrG(q) < 14).sort((a, b) => cdist(p.src, G3(a)) - cdist(p.src, G3(b)))[0];
      if (g) { p.glass = g[0]; p.rgb = G3(g); } }
    for (let pass = 0; pass < 3; pass++) for (const p of pieces) { if (p.frame || p.user) continue; const nbs = [...adj.get(p.id)].map(i => byId.get(i)).filter(q => must(p, q) && (p.subj ? FEAT.test(p.part) || !q.subj : true));
      if (!p.subj && !nbs.some(q => q.subj)) continue; if (p.subj && !FEAT.test(p.part)) continue;
      const avoid = nbs.filter(q => p.subj ? true : q.subj).map(q => [q.glass, q.rgb]), clash = avoid.some(q => q[0] === p.glass || cdist(p.rgb, q[1]) < (p.subj ? 40 : 70)); if (!clash) continue;
      const pref = /^inner|^nose/.test(p.part) ? g => ['Pink', 'Flesh / peach', 'Rose', 'Light amber', 'Wispy white'].includes(g[0]) : /^muzzle|^chin/.test(p.part) ? g => lum([g[1], g[2], g[3]]) > Math.max(...nbs.filter(q => q.subj).map(q => lum(q.rgb)), 0) + 6 : /^stripe/.test(p.part) ? g => lum([g[1], g[2], g[3]]) < Math.min(...nbs.map(q => lum(q.rgb))) - 8 : null;
      const g = pick(p, avoid, pref) || pick(p, avoid, null); if (g) { p.glass = g[0]; p.rgb = [g[1], g[2], g[3]]; } } }
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
  if (fz) { const ov = new Uint8Array(n0); for (const l of fz.overlay) for (let i = 1; i < l.length; i++) { const [ax, ay] = l[i - 1], [bx, by] = l[i], n = Math.ceil(Math.hypot(bx - ax, by - ay)) + 1; for (let t = 0; t <= n; t++) { const x = Math.round(ax + (bx - ax) * t / n), y = Math.round(ay + (by - ay) * t / n); if (x >= 0 && y >= 0 && x < iw && y < ih) ov[y * iw + x] = 1; } }
    cOn = 0; cAll = 0; for (let y = 2; y < ih - 2; y++) for (let x = 2; x < iw - 2; x++) { const q = y * iw + x; if (!fz.main[q]) continue; cAll++; const g = (y + G.f) * W + x + G.f, r = st.R[g]; let on = false; for (let j = -2; j <= 2 && !on; j++) for (let i = -2; i <= 2; i++) if (st.R[g + j * W + i] !== r || ov[q + j * iw + i]) { on = true; break; } if (on) cOn++; } }
  const outlineKept = cAll ? Math.round(cOn / cAll * 100) : 100;
  if (outlineKept < 45 && sm.how !== 'none' && !fc) notes.push(`Only ${outlineKept}% of the subject’s outlines became lead lines at this size. For more recognisable detail, make the panel larger, lower Simplicity, or raise Detail on subject.`);
  // painted detail: strong interior contours that are not lead lines (subject + must-keep features; whole panel when there is no subject)
  let detail = [], dots = [], shapes = [], overlay = [];
  if (tr) notes.push(`Traced from your photo: ${rm.colors} colour zones found, then every area smaller than ${rules.minAreaIn} sq in was merged into its most similar neighbour; each piece shows its real average photo colour (glass names are the nearest stock glass).`);
  if (fc) notes.push(`Face layout: ${fc.ears} ear${fc.ears === 1 ? '' : 's'} as triangles with inner ears, eyes with painted pupils, nose, muzzle split down the middle, chin${fc.stripes ? ', ' + fc.stripes + ' forehead stripes' : ''}; the background is a few calm pieces.`);
  if (fz) { for (const l of fz.overlay) overlay.push(l.map(([x, y]) => [r2(x + G.f), r2(y + G.f)])); notes.push(`Building layout: ${fz.ops.length} windows/doors as rectangles${fz.sky ? ', sky' : ''}${fz.cornices.length ? ', ' + fz.cornices.length + ' cornice line' + (fz.cornices.length > 1 ? 's' : '') : ''}; bars and planks are came lines.`); }
  if (!tr && o.paint !== false && o.smallFeat !== 'off') {
    const hasSubj = sm.how !== 'none' && sm.how !== 'off' && !geo, thin = contourMap(A, E, iw, ih, hasSubj ? 0.45 : geo ? 0.5 : 0.62, 0.28, Math.round(ppi * 0.3), false), allow = new Uint8Array(n0);
    if (hasSubj) { const dm = blur1(Float32Array.from(mask), iw, ih, 3); for (let p = 0; p < n0; p++) allow[p] = dm[p] > 0.5 ? 1 : 0; } else allow.fill(1);
    if (featMap) for (let p = 0; p < n0; p++) if (featMap[p]) allow[p] = 1;
    // painted dots: tiny dark features (eyes, pupils, nostrils, a beak tip) below piece size
    const Lb = new Float32Array(n0); for (let p = 0; p < n0; p++) Lb[p] = A[p * 3]; const Lm = blur1(Lb, iw, ih, Math.max(2, Math.round(ppi * 0.25))), dk = new Uint8Array(n0);
    const allowD = new Uint8Array(n0); if (hasSubj) { const dm2 = blur1(Float32Array.from(mask), iw, ih, Math.max(3, Math.round(ppi * 0.3))); for (let p = 0; p < n0; p++) allowD[p] = allow[p] || dm2[p] > 0.12 ? 1 : 0; } else allowD.set(allow);
    for (let p = 0; p < n0; p++) dk[p] = allowD[p] && !geo && Lb[p] < 38 && Lm[p] - Lb[p] > 16 && Math.hypot(A[p * 3 + 1], A[p * 3 + 2]) < 22 ? 1 : 0;
    const dc = components(dk, iw, ih), da = new Float64Array(dc.n), dx = new Float64Array(dc.n), dy = new Float64Array(dc.n), dxx = new Float64Array(dc.n), dyy = new Float64Array(dc.n), dcol = new Float64Array(dc.n * 3), dcon = new Float64Array(dc.n);
    for (let p = 0; p < n0; p++) { const r = dc.R[p]; if (dc.from[r] !== 1) continue; const x = p % iw, y = (p / iw) | 0; da[r]++; dx[r] += x; dy[r] += y; dxx[r] += x * x; dyy[r] += y * y; dcol[r * 3] += F[p * 3]; dcol[r * 3 + 1] += F[p * 3 + 1]; dcol[r * 3 + 2] += F[p * 3 + 2]; dcon[r] += Lm[p] - Lb[p]; }
    const amin = 0.004 * ppi * ppi, amax = 0.12 * ppi * ppi, cands = [];
    for (let r = 0; r < dc.n; r++) { if (dc.from[r] !== 1 || da[r] < amin || da[r] > amax) continue; const cx = dx[r] / da[r], cy = dy[r] / da[r], sx = Math.sqrt(Math.max(0.25, dxx[r] / da[r] - cx * cx)), sy = Math.sqrt(Math.max(0.25, dyy[r] / da[r] - cy * cy)); if (Math.max(sx, sy) / Math.min(sx, sy) > 3.5) continue;
      cands.push({ c: dcon[r] / da[r] * Math.sqrt(da[r]), d: { cx: r2(cx + G.f), cy: r2(cy + G.f), rx: r2(Math.max(1.2, sx * 1.8)), ry: r2(Math.max(1.2, sy * 1.8)), hex: gHex([0, 1, 2].map(k => Math.min(60, dcol[r * 3 + k] / da[r]))) } }); }
    dots = cands.sort((a, b) => b.c - a.c).slice(0, 12).map(x => x.d);
    // painted shapes: elongated darker features that poke out of the subject outline (beak, claws, antennae) — filled with glass paint
    if (hasSubj && calm) { const dm3 = blur1(Float32Array.from(mask), iw, ih, 2), Lr = new Float32Array(n0), Cr = new Float32Array(n0); for (let p = 0; p < n0; p++) { const c = gLab(F[p * 3], F[p * 3 + 1], F[p * 3 + 2]); Lr[p] = c[0]; Cr[p] = Math.hypot(c[1], c[2]); }
      const Lr1 = blur1(Lr, iw, ih, 1), Lm2 = blur1(Lr, iw, ih, Math.max(3, Math.round(ppi * 0.4))), sk = new Uint8Array(n0);
      const near = chamferT(mask, iw, ih); for (let p = 0; p < n0; p++) sk[p] = near[p] < ppi * 1.1 && dm3[p] < 0.99 && Lr[p] < 50 && Lm2[p] - Lr[p] > 9 && Cr[p] < 28 ? 1 : 0;
      const kc2 = components(sk, iw, ih), info = new Map();
      for (let p = 0; p < n0; p++) { const r = kc2.R[p]; if (kc2.from[r] !== 1) continue; let o2 = info.get(r); if (!o2) info.set(r, o2 = { px: [], out: 0, edge: 0, con: 0, col: [0, 0, 0] }); const x = p % iw, y = (p / iw) | 0; o2.px.push([x + G.f + 0.5, y + G.f + 0.5]); if (!mask[p]) o2.out++; if (dm3[p] > 0.05) o2.edge++; o2.con += Lm2[p] - Lb[p]; o2.col[0] += F[p * 3]; o2.col[1] += F[p * 3 + 1]; o2.col[2] += F[p * 3 + 2]; }
      const sc = []; for (const [, o2] of info) { const n = o2.px.length; if (n < ppi * ppi * 0.01 || n > ppi * ppi * 0.13 || o2.out < n * 0.12 || o2.edge < n * 0.2) continue; const mx = o2.px.reduce((a, q) => a + q[0], 0) / n, my = o2.px.reduce((a, q) => a + q[1], 0) / n; let sxx = 0, syy = 0, sxy = 0; for (const [x, y] of o2.px) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); } const tr = (sxx + syy) / n, dt = (sxx * syy - sxy * sxy) / n / n, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - dt)), l2 = Math.max(0.01, tr - l1); if (l1 / l2 < 3) continue; sc.push({ o2, c: o2.con / n * Math.sqrt(n), mx, my }); }
      const grow = ppi * 0.03; shapes = sc.sort((a, b) => b.c - a.c).slice(0, 3).map(({ o2, mx, my }) => ({ pts: hull(o2.px).map(([x, y]) => { const dx = x - mx, dy = y - my, d = Math.hypot(dx, dy) || 1; return [r2(x + dx / d * grow), r2(y + dy / d * grow)]; }), hex: gHex(o2.col.map(v => Math.min(70, v / o2.px.length * 0.8))) })).filter(o2 => o2.pts.length >= 3); }
    const Dl = distT(st.R, W, H); detail = detailLines(thin, allow, Dl, st, G, iw, ih, ppi, (iw + ih) * (0.6 + det * 0.18) * (hasSubj ? Math.max(0.35, sm.frac) * 1.6 : geo ? 1.2 : 0.7), geo);
    if (calm && hasSubj) { // calm subjects: a few long, smooth painted lines instead of many scratchy ones, plus feather bands on the wing
      const lenOf = l => l.reduce((a, q, i) => i ? a + Math.hypot(q[0] - l[i - 1][0], q[1] - l[i - 1][1]) : 0, 0), sa = Math.sqrt(sm.frac * n0);
      detail = detail.map(l => { if (l.length < 3) return l; const k = new Uint8Array(l.length); k[0] = k[l.length - 1] = 1; dp(l, ppi * 0.05, k, 0, l.length - 1); return l.filter((_, i) => k[i]); }).filter(l => lenOf(l) > sa * 0.16).sort((a, b) => lenOf(b) - lenOf(a)).slice(0, 8);
      const acc = new Map(); let mA = 0; for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const p = y * iw + x; if (mask[p]) mA++; const r = st.R[(y + G.f) * W + x + G.f]; if (r < 0 || !st.subj[r]) continue; let a = acc.get(r); if (!a) acc.set(r, a = { n: 0, x: 0, y: 0, xx: 0, yy: 0, xy: 0, L: 0 }); a.n++; a.x += x; a.y += y; a.xx += x * x; a.yy += y * y; a.xy += x * y; a.L += A[p * 3]; }
      let wing = null; for (const [r, a] of acc) { if (a.n < mA * 0.05) continue; const mx = a.x / a.n, my = a.y / a.n, sxx = a.xx / a.n - mx * mx, syy = a.yy / a.n - my * my, sxy = a.xy / a.n - mx * my, tr = sxx + syy, dt = sxx * syy - sxy * sxy, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - dt)), l2 = Math.max(0.5, tr - l1); if (l1 / l2 < 1.8) continue; const L = a.L / a.n; if (!wing || L < wing.L) wing = { r, L, mx, my, l1, l2, ang: 0.5 * Math.atan2(2 * sxy, sxx - syy) }; }
      if (wing) { const vx = Math.cos(wing.ang), vy = Math.sin(wing.ang), ux = -vy, uy = vx, hw = 2 * Math.sqrt(wing.l2), hl = Math.sqrt(3 * wing.l1), ins = ppi * 0.07;
        const lab = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= iw || yi >= ih ? -2 : st.R[(yi + G.f) * W + xi + G.f]; };
        for (const off of [-hw / 3, hw / 3]) { let run = [], best = []; for (let t = -hl; t <= hl; t += 1) { const x = wing.mx + vx * t + ux * off, y = wing.my + vy * t + uy * off, ok = [[0, 0], [ux * ins, uy * ins], [-ux * ins, -uy * ins], [vx * ins, vy * ins], [-vx * ins, -vy * ins]].every(([a, b]) => lab(x + a, y + b) === wing.r); if (ok) run.push([x, y]); else { if (run.length > best.length) best = run; run = []; } } if (run.length > best.length) best = run;
          if (best.length > hl * 0.7) detail.push([best[0], best[Math.floor(best.length / 2)], best[best.length - 1]].map(([x, y]) => [r2(x + G.f), r2(y + G.f)])); } } }
    if (fc) { dots = fc.dots.map(q => ({ cx: r2(q.cx + G.f), cy: r2(q.cy + G.f), rx: r2(q.rx), ry: r2(q.ry), hex: q.hex })); shapes = []; detail = fc.whiskers.map(l => l.map(([x, y]) => [r2(x + G.f), r2(y + G.f)])); }
    if (fz) detail = detail.filter(l => l.length >= 2 && Math.hypot(l[l.length - 1][0] - l[0][0], l[l.length - 1][1] - l[0][1]) > iw * 0.12).slice(0, 4); // graffiti and stains are dropped
    // legs and perch: a band just under a found subject keeps its few longest contours (legs, the branch or wire it stands on)
    if (calm) { let bx0 = iw, by0 = ih, bx1 = 0, by1 = 0; for (let p = 0; p < n0; p++) if (mask[p]) { const x = p % iw, y = (p / iw) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      const bw = bx1 - bx0, bh = by1 - by0, band = new Uint8Array(n0), thinB = contourMap(A, E, iw, ih, 0.5, 0.25, Math.round(ppi * 0.4), false);
      for (let y = Math.max(0, Math.round(by1 - bh * 0.25)); y < Math.min(ih, Math.round(by1 + bh * 0.3)); y++) for (let x = Math.max(0, Math.round(bx0 - bw * 0.35)); x < Math.min(iw, Math.round(bx1 + bw * 0.35)); x++) band[y * iw + x] = allow[y * iw + x] ? 0 : 1;
      { const pl = houghPerch(thinB, band, iw, ih, ppi, bw, by1 - bh * 0.1, bh * 0.15); if (pl) overlay.push(pl.map(([x, y]) => [r2(x + G.f), r2(y + G.f)])); }
      const bl = overlay.length ? [] : detailLines(thinB, band, Dl, st, G, iw, ih, ppi, (bw + bh) * 3, false), lenOf = l => l.reduce((a, q, i) => i ? a + Math.hypot(q[0] - l[i - 1][0], q[1] - l[i - 1][1]) : 0, 0);
      const pc = bl.map(l => { const k = new Uint8Array(l.length); k[0] = k[l.length - 1] = 1; dp(l, ppi * 0.12, k, 0, l.length - 1); const q = l.filter((_, i) => k[i]); return { q, len: lenOf(q), span: Math.hypot(q[q.length - 1][0] - q[0][0], q[q.length - 1][1] - q[0][1]) }; }).filter(o2 => o2.span > bw * 0.55 && o2.span > o2.len * 0.8).sort((a, b) => b.span - a.span);
      if (pc.length) overlay.push(pc[0].q); }
  }
  const silhouette = sm.how === 'none' || sm.how === 'off' ? [] : chains.filter(c => c.s[0] >= 0 && c.s[1] >= 0 && !st.fixed[c.s[0]] && !st.fixed[c.s[1]] && !!st.subj[c.s[0]] !== !!st.subj[c.s[1]]).map(c => chainSegs(c.pts)).filter(s => s.length > 1);
  const line = GLASS_LINES[o.line] || GLASS_LINES.foil116;
  const dbg = o._debug ? { mask: sm.mask, iw, ih } : undefined;
  return { _dbg: dbg, _facade: fz && o._debug ? { main: Array.from(fz.main), lead: (() => { const a = new Uint8Array(iw * ih); for (let y = 1; y < ih - 1; y++) for (let x = 1; x < iw - 1; x++) { const g = (y + G.f) * W + x + G.f; if (st.R[g] !== st.R[g + 1] || st.R[g] !== st.R[g + W]) a[y * iw + x] = 1; } return Array.from(a); })(), probe: fz.probe, ops: fz.ops, steps: fz.steps, cornices: fz.cornices, ground: fz.groundY, cand: fz.cand, X: fz.X, Y: fz.Y } : undefined, kind: 'glass', version: 2, f: G.f, crop: img.crop || [0, 0, 1, 1], subject: { how: sm.how, frac: r2(sm.frac), outlineKept }, silhouette, detail, dots, shapes, overlay, style: geo ? 'geometric' : 'organic', axisFrac: r2(axf), widthIn: G.widthIn, heightIn: r2(G.gridH / G.ppi), ppi: G.ppi, gridW: W, gridH: H, frameIn: o.frame ? o.frameIn : 0, lineIn: line.in, lineLabel: line.label, pieces, legend, notes,
    stats: { outlineKept, advanced: adv.length, detailLines: detail.length, dots: dots.length + shapes.length, pieces: pieces.length, colors: legend.length, difficulty, reasons, smallestIn: r2(smallest), minAreaIn: r2(rules.minAreaIn), minWidthIn: r2(rules.minWidthIn), flagged: { advanced: adv, small, narrow, deep, sharp, hole } }, settings: o };
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
  const zc = (o.method === 'stylized' || o.subjectBox) && o.focus && o.zoom ? glassSubjectCrop(im, w, h, o) : [0, 0, 1, 1], zw = zc[2] * w, zh = zc[3] * h;
  const aspect = o.heightIn ? +o.heightIn / (+o.widthIn || 12) : zh / zw, G = glassGeometry(o, aspect);
  const c = document.createElement('canvas'); c.width = G.innerW; c.height = G.innerH; const g = c.getContext('2d', { willReadFrequently: true });
  // cover-fit the (zoomed) region into the panel's aspect
  const s = Math.max(G.innerW / zw, G.innerH / zh), vw = G.innerW / s, vh = G.innerH / s, vx = zc[0] * w + (zw - vw) / 2, vy = zc[1] * h + (zh - vh) / 2;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, vx, vy, vw, vh, 0, 0, G.innerW, G.innerH);
  const d = g.getImageData(0, 0, c.width, c.height); return { width: d.width, height: d.height, data: d.data, aspect, crop: [vx / w, vy / h, vw / w, vh / h], zoomed: zc[2] < 0.999 || zc[3] < 0.999 };
}

/* ---------- SVG ---------- */
function glassSVG(P, { cut = false, numbers = true, scaleBar = true, fill = 'glass', photo = null, opacity = 1, lines: showLines = true, paint: showPaint = true, paintGuide = false } = {}) {
  const lw = P.lineIn * P.ppi, lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], colOf = p => cut ? [255, 255, 255] : fill === 'photo' && p.src ? p.src : p.rgb;
  const body = P.pieces.map(p => `<path data-piece="${p.n}" d="${p.segs.map(segsToD).join('')}" fill="${gHex(colOf(p))}" fill-rule="evenodd"/>`).join('');
  const lines = P.pieces.map(p => `<path d="${p.segs.map(segsToD).join('')}"/>`).join('');
  const sil = (P.silhouette || []).map(s => segsToD(s)).join(''), det = (P.detail || []).map(l => 'M' + l.map(q => q.join(' ')).join('L')).join(''), dots = (P.dots || []).map(d => `<ellipse cx="${d.cx}" cy="${d.cy}" rx="${d.rx}" ry="${d.ry}" fill="${cut ? 'none' : d.hex}" stroke="${cut ? '#b0b0b0' : 'none'}"/>`).join('') + (P.shapes || []).map(d => `<path d="M${d.pts.map(q => q.join(' ')).join('L')}Z" fill="${cut ? 'none' : d.hex}" stroke="${cut ? '#b0b0b0' : 'none'}"/>`).join('');
  const nums = numbers ? P.pieces.map(p => `<text x="${p.label[0]}" y="${p.label[1]}" font-size="${p.font}" fill="${cut || (opacity > 0.5 && lum(colOf(p)) > 140) ? '#000' : '#fff'}"${opacity <= 0.5 && !cut ? ' stroke="#000" stroke-width="0.6" paint-order="stroke"' : ''}>${p.n}</text>`).join('') : '';
  const bar = scaleBar ? `<g class="scale"><rect x="${P.gridW - P.ppi - 4}" y="${P.gridH - 10}" width="${P.ppi}" height="3" fill="#e33"/></g>` : '';
  let under = '';
  if (photo && P.crop) { const f = P.f != null ? P.f : Math.round(P.frameIn * P.ppi), iw = P.gridW - 2 * f, ih = P.gridH - 2 * f, fw = iw / P.crop[2], fh = ih / P.crop[3];
    under = `<defs><clipPath id="gInner"><rect x="${f}" y="${f}" width="${iw}" height="${ih}"/></clipPath></defs><image href="${photo}" x="${+(f - P.crop[0] * fw).toFixed(2)}" y="${+(f - P.crop[1] * fh).toFixed(2)}" width="${+fw.toFixed(2)}" height="${+fh.toFixed(2)}" preserveAspectRatio="none" clip-path="url(#gInner)"/>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${P.widthIn}in" height="${P.heightIn}in" viewBox="0 0 ${P.gridW} ${P.gridH}" data-ppi="${P.ppi}">
<title>Stained glass pattern ${P.widthIn}×${P.heightIn} in, ${P.stats.pieces} pieces</title>
<rect width="${P.gridW}" height="${P.gridH}" fill="#fff"/>${under}
<g id="pieces"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}>${body}</g>
${showLines ? '' : '<!--'}<g id="lead" fill="none" stroke="${cut ? '#9a9a9a' : '#1a1a1a'}" stroke-width="${+lw.toFixed(3)}" stroke-linejoin="round" stroke-linecap="round">${lines}${sil ? `<path id="silhouette" d="${sil}" stroke-width="${+(lw * 1.6).toFixed(3)}"/>` : ''}${(P.overlay || []).length ? `<path id="overlay-lead" d="${P.overlay.map(l => 'M' + l.map(q => q.join(' ')).join('L')).join('')}"${cut ? ' stroke-dasharray="4 2"' : ''}/>` : ''}</g>${showLines ? '' : '-->'}
${showLines && (det || dots) ? `<g id="detail" fill="none" stroke="${cut ? '#b0b0b0' : '#1a1a1a'}" stroke-width="${+(lw * 0.5).toFixed(3)}" stroke-linecap="round" stroke-linejoin="round"${cut ? ' stroke-dasharray="2 2"' : ''}><path d="${det}"/>${dots}</g>` : ''}
${glassPaintSVG(P, cut ? (paintGuide ? 'guide' : '') : showPaint ? 'color' : '')}
${cut ? `<g id="cut" fill="none" stroke="#000" stroke-width="${+(0.012 * P.ppi).toFixed(3)}">${lines}</g>` : ''}
<g id="numbers" font-family="Helvetica, Arial, sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central">${nums}</g>
</svg>`;
}

/* paint lines (glass-paint trace lines + light matting) — 'color': dark brown strokes on the colour pattern; 'guide': thin dashed grey on the printable paint guide */
function glassPaintSVG(P, mode) {
  const pt = P.paint; if (!mode || !pt || !(pt.lines.length || pt.mat.length)) return '';
  const d = pt.lines.map(l => 'M' + l.map(q => q[0] + ' ' + q[1]).join('L')).join('');
  if (mode === 'guide') return `<g id="paint" fill="none" stroke="#8a8a8a" stroke-width="${+Math.max(0.6, 0.012 * P.ppi).toFixed(2)}" stroke-dasharray="${+(0.05 * P.ppi).toFixed(2)} ${+(0.035 * P.ppi).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></g>`;
  const mat = pt.mat.length ? `<g transform="translate(${P.f} ${P.f})" fill="#2a1a10">${pt.mat.map(([m, a]) => `<path d="${m}" fill-opacity="${a}"/>`).join('')}</g>` : '';
  return `<g id="paint">${mat}<path d="${d}" fill="none" stroke="#2a1a10" stroke-opacity="0.85" stroke-width="${pt.widthPx}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}
/* ---------- PDF (real scale, tiled on Letter with alignment marks) ---------- */
function glassPDF(P, { cut = false, guide = null, title = 'Stained glass pattern', paintGuide = false } = {}) {
  const pm = P.paint && P.paint.lines.length ? (cut ? (paintGuide ? 'guide' : '') : 'color') : '';
  const doc = new PDFDoc(), M = 36, PW = 612, PH = 792, pw = (PW - 2 * M) / 72, ph = (PH - 2 * M) / 72, ov = 0.5;
  const fits = P.widthIn <= pw && P.heightIn <= ph;
  const cols = fits ? 1 : Math.ceil((P.widthIn - ov) / (pw - ov)), rows = fits ? 1 : Math.ceil((P.heightIn - ov) / (ph - ov)), sx = pw - ov, sy = ph - ov;
  const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], lw = P.lineIn * P.ppi;
  // cover page
  const c = doc.page(); let y = M;
  c.text(M, y, 18, title + (cut ? (paintGuide ? ' — dashed paint lines + cut lines' : ' — cut lines') : ''), true); y += 26;
  c.text(M, y, 11, `Finished size ${P.widthIn} × ${P.heightIn} in (${(P.widthIn * 2.54).toFixed(1)} × ${(P.heightIn * 2.54).toFixed(1)} cm) · ${P.stats.pieces} pieces · ${P.lineLabel}${P.frameIn ? ` · ${P.frameIn}″ frame` : ''}`); y += 16;
  c.text(M, y, 12, `Difficulty: ${P.stats.difficulty}`, true); y += 16;
  for (const r of P.stats.reasons) y = c.para(M + 8, y, 520, 9.5, '• ' + r);
  y += 6;
  // preview fit into box
  const boxW = 250, boxH = 300, s = Math.min(boxW / P.gridW, boxH / P.gridH);
  c.op(`q ${f2(s)} 0 0 ${f2(-s)} ${M} ${f2(PH - y)} cm`); drawPieces(c, P, cut, lw, pm); c.op('Q');
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
    p.op(`${f2(sc)} 0 0 ${f2(-sc)} ${f2(M - x0 * 72)} ${f2(PH - M + y0 * 72)} cm`); drawPieces(p, P, cut, lw, pm);
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
    p.text(M, 14, 8.5, `Scan Lab · ${title}${cut ? (paintGuide ? ' — paint lines' : ' — cut lines') : ''} · ${label} · page ${n} of ${1 + rows * cols}`, false, [90, 90, 90]);
    p.stroke(0, 0, 0).lw(1).line(PW - M - 72, 18, PW - M, 18).line(PW - M - 72, 14, PW - M - 72, 22).line(PW - M, 14, PW - M, 22); p.text(PW - M - 72, PH - 30, 7, '1 inch — check with a ruler', false, [90, 90, 90]);
  }
  doc.meta = { pages: 1 + rows * cols, rows, cols, scale: 72 / P.ppi };
  return doc;
}
function drawPieces(p, P, cut, lw, pm) {
  for (const pc of P.pieces) { const c = cut ? [255, 255, 255] : pc.rgb; p.fill(...c); p.path(pc.segs.flat()); p.op('f*'); }
  p.stroke(cut ? 150 : 26, cut ? 150 : 26, cut ? 150 : 26).lw(lw).op('1 j');
  for (const pc of P.pieces) { p.path(pc.segs.flat()); p.op('S'); }
  if (P.silhouette && P.silhouette.length) { p.lw(lw * 1.6).op('1 J'); for (const s of P.silhouette) { p.path(s); p.op('S'); } p.op('0 J'); }
  if (pm) { const pl = P.paint.lines, w = pm === 'guide' ? Math.max(0.6, 0.012 * P.ppi) : P.paint.widthPx; p.lw(w).op('1 J 1 j'); if (pm === 'guide') { p.stroke(138, 138, 138).op(`[${f2(0.05 * P.ppi)} ${f2(0.035 * P.ppi)}] 0 d`); } else p.stroke(42, 26, 16); for (const l of pl) { p.path([['M', ...l[0]], ...l.slice(1).map(q => ['L', ...q])]); p.op('S'); } p.op('[] 0 d 0 J'); p.stroke(cut ? 150 : 26, cut ? 150 : 26, cut ? 150 : 26).lw(lw); }
  if (P.overlay && P.overlay.length) { p.lw(lw).op('1 J'); if (cut) p.op('[4 2] 0 d'); for (const l of P.overlay) { p.path([['M', ...l[0]], ...l.slice(1).map(q => ['L', ...q])]); p.op('S'); } p.op('[] 0 d 0 J'); }
  if (P.detail && P.detail.length) { p.stroke(cut ? 170 : 26, cut ? 170 : 26, cut ? 170 : 26).lw(lw * 0.5).op('1 J'); if (cut) p.op('[2 2] 0 d'); for (const l of P.detail) { p.path([['M', ...l[0]], ...l.slice(1).map(q => ['L', ...q])]); p.op('S'); } p.op('[] 0 d 0 J'); }
  for (const d of P.dots || []) { const k = 0.5523, { cx, cy, rx, ry } = d; if (!cut) p.fill(...[1, 3, 5].map(i => parseInt(d.hex.slice(i, i + 2), 16))); else p.stroke(170, 170, 170).lw(lw * 0.4);
    p.op(`${f2(cx + rx)} ${f2(cy)} m ${f2(cx + rx)} ${f2(cy + k * ry)} ${f2(cx + k * rx)} ${f2(cy + ry)} ${f2(cx)} ${f2(cy + ry)} c ${f2(cx - k * rx)} ${f2(cy + ry)} ${f2(cx - rx)} ${f2(cy + k * ry)} ${f2(cx - rx)} ${f2(cy)} c ${f2(cx - rx)} ${f2(cy - k * ry)} ${f2(cx - k * rx)} ${f2(cy - ry)} ${f2(cx)} ${f2(cy - ry)} c ${f2(cx + k * rx)} ${f2(cy - ry)} ${f2(cx + rx)} ${f2(cy - k * ry)} ${f2(cx + rx)} ${f2(cy)} c ${cut ? 'S' : 'f'}`); }
  for (const d of P.shapes || []) { if (!cut) p.fill(...[1, 3, 5].map(i => parseInt(d.hex.slice(i, i + 2), 16))); else p.stroke(170, 170, 170).lw(lw * 0.4); p.op(d.pts.map((q, i) => `${f2(q[0])} ${f2(q[1])} ${i ? 'l' : 'm'}`).join(' ') + ` h ${cut ? 'S' : 'f'}`); }
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
