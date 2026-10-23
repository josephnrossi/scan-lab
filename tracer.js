/* Scan Lab — Stained Glass photo tracer (v7). Deterministic, on-device, no AI shapes: the photo is duplicated at a working size and vectorised.
   1 duplicate at ~800 px (original untouched)  2 bilateral smoothing in Lab  3 k-means colour quantisation in Lab (the photo's own colours)
   4 connected colour zones merged with an edge-aware Ward cost down to the Detail target; anything under the minimum cuttable size joins its most similar neighbour,
     except small high-contrast features (eyes, beak, windows) which are kept  5 cuttability: opening at the minimum width, straight cuts through very concave or
     oversized pieces, extra cut lines so no piece encloses another  6 shared borders traced into smooth, gap-free curves (Douglas-Peucker + quadratic curves),
     numbered pieces, glass palette (k-means over the pieces' real colours, 6–24), legend with area per colour.
   Runs in a Web Worker (tracer-worker.js) or inline. Exposes self.PhotoTracer = { trace, rules }. */
(function (root) {
'use strict';
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function components(L, W, H) {
  const R = new Int32Array(W * H).fill(-1), from = []; let n = 0; const st = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) { if (R[i] >= 0) continue; const lab = L[i]; let sp = 0; st[sp++] = i; R[i] = n;
    while (sp) { const p = st[--sp], x = p % W, y = (p - x) / W; const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]; for (const q of nb) if (q >= 0 && R[q] < 0 && L[q] === lab) { R[q] = n; st[sp++] = q; } }
    from.push(lab); n++; }
  return { R, n, from };
}
/* chamfer (3-4) distance to nearest pixel of a different region or the outside; returns px units */
/* chamfer distance to the nearest set pixel of a 0/1 map (image edges are not boundaries) */
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
/* ---------- colour ---------- */
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const fl = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
function rgbLab(r, g, b) { const R = LIN[r], G = LIN[g], B = LIN[b], X = fl((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), Y = fl(0.2126 * R + 0.7152 * G + 0.0722 * B), Z = fl((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883); return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)]; }
const r2 = n => Math.round(n * 100) / 100, hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* edge-preserving smoothing: bilateral filter in Lab (keeps outlines crisp, flattens texture/noise inside areas) */
function bilateral(A, W, H, iters, sr, rad) {
  let src = A; const N = W * H, ss = rad * 0.75 + 0.5, DI = [], DJ = [], WS = []; for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) { DI.push(i); DJ.push(j); WS.push(Math.exp(-(i * i + j * j) / (2 * ss * ss))); }
  const nt = WS.length, di = Int32Array.from(DI), dj = Int32Array.from(DJ), ws = Float32Array.from(WS), LUT = new Float32Array(4096), k = 4096 / (9 * sr * sr); for (let i = 0; i < 4096; i++) LUT[i] = Math.exp(-(i / k) / (2 * sr * sr));
  for (let it = 0; it < iters; it++) { const out = new Float32Array(N * 3);
    for (let y = 0; y < H; y++) { const inY = y >= rad && y < H - rad; for (let x = 0; x < W; x++) { const p = y * W + x, p3 = p * 3, L0 = src[p3], a0 = src[p3 + 1], b0 = src[p3 + 2], inside = inY && x >= rad && x < W - rad; let s = 0, sl = 0, sa = 0, sb = 0;
      for (let t = 0; t < nt; t++) { let q; if (inside) q = (p + dj[t] * W + di[t]) * 3; else { const xx = x + di[t], yy = y + dj[t]; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; q = (yy * W + xx) * 3; }
        const vl = src[q], va = src[q + 1], vb = src[q + 2], dl = vl - L0, da = va - a0, db = vb - b0, li = ((dl * dl + da * da + db * db) * k) | 0; if (li >= 4096) continue; const w = ws[t] * LUT[li]; s += w; sl += w * vl; sa += w * va; sb += w * vb; }
      out[p3] = sl / s; out[p3 + 1] = sa / s; out[p3 + 2] = sb / s; } }
    src = out; }
  return src;
}
/* Canny on the smoothed Lab image: gradient (colour-aware), non-maximum suppression, hysteresis → thin strong edges (the subject outline, eyes, windows) */
function canny(A, W, H, pct = 0.82, minHi = 7) {
  const N = W * H, G = new Float32Array(N), D = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; let gx2 = 0, gy2 = 0, gxy = 0;
    for (let c = 0; c < 3; c++) { const w = c ? 0.6 : 1, v = (o) => A[(p + o) * 3 + c]; const gx = (v(-W + 1) + 2 * v(1) + v(W + 1) - v(-W - 1) - 2 * v(-1) - v(W - 1)) * w, gy = (v(W - 1) + 2 * v(W) + v(W + 1) - v(-W - 1) - 2 * v(-W) - v(-W + 1)) * w; gx2 += gx * gx; gy2 += gy * gy; gxy += gx * gy; }
    G[p] = Math.sqrt(gx2 + gy2) / 4; const ang = 0.5 * Math.atan2(2 * gxy, gx2 - gy2); let a = ang * 180 / Math.PI; if (a < 0) a += 180; D[p] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3; }
  const nm = new Float32Array(N), off = [[1, -1], [W + 1, -W - 1], [W, -W], [W - 1, -W + 1]];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x, g = G[p], [o1, o2] = off[D[p]]; if (g >= G[p + o1] && g > G[p + o2]) nm[p] = g; }
  const hs = []; for (let p = 0; p < N; p += 7) if (nm[p] > 0) hs.push(nm[p]); hs.sort((a, b) => a - b);
  const hi = Math.max(minHi, hs.length ? hs[Math.floor(hs.length * pct)] : 10), lo = hi * 0.45, E = new Uint8Array(N), st = [];
  for (let p = 0; p < N; p++) if (nm[p] >= hi && !E[p]) { E[p] = 1; st.push(p); while (st.length) { const q = st.pop(); for (const o of [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1]) { const r = q + o; if (r >= 0 && r < N && !E[r] && nm[r] >= lo) { E[r] = 1; st.push(r); } } } }
  return { E, G, hi };
}
/* deterministic k-means++ in Lab (weighted) */
function kmeansPP(P, w, k, iters, seed, maximin) {
  const n = w.length, rnd = mulberry(seed), C = [], d2 = new Float64Array(n).fill(Infinity); k = Math.min(k, n);
  if (maximin) { // farthest-point seeding: a small but distinct colour (blue eyes, a pink nose, a red coat) gets its own glass
    let i0 = 0; for (let i = 1; i < n; i++) if (w[i] > w[i0]) i0 = i; C.push([P[i0 * 3], P[i0 * 3 + 1], P[i0 * 3 + 2]]);
    while (C.length < k) { const c = C[C.length - 1]; let bi = -1, bv = 0; for (let i = 0; i < n; i++) { const dl = P[i * 3] - c[0], da = P[i * 3 + 1] - c[1], db = P[i * 3 + 2] - c[2], d = dl * dl + da * da + db * db; if (d < d2[i]) d2[i] = d; const v = d2[i] * Math.pow(w[i], 0.35); if (v > bv) { bv = v; bi = i; } } if (bi < 0) break; C.push([P[bi * 3], P[bi * 3 + 1], P[bi * 3 + 2]]); }
    return lloyd(P, w, C, iters, n); }
  let tw = 0; for (let i = 0; i < n; i++) tw += w[i]; let t = rnd() * tw, i0 = 0; for (; i0 < n - 1; i0++) { t -= w[i0]; if (t <= 0) break; } C.push([P[i0 * 3], P[i0 * 3 + 1], P[i0 * 3 + 2]]);
  while (C.length < k) { const c = C[C.length - 1]; let s = 0; for (let i = 0; i < n; i++) { const dl = P[i * 3] - c[0], da = P[i * 3 + 1] - c[1], db = P[i * 3 + 2] - c[2], d = dl * dl + da * da + db * db; if (d < d2[i]) d2[i] = d; s += d2[i] * w[i]; }
    if (s <= 0) break; let r = rnd() * s, j = 0; for (; j < n - 1; j++) { r -= d2[j] * w[j]; if (r <= 0) break; } C.push([P[j * 3], P[j * 3 + 1], P[j * 3 + 2]]); }
  return lloyd(P, w, C, iters, n);
}
function lloyd(P, w, C, iters, n) {
  const as = new Int32Array(n);
  for (let it = 0; it < iters; it++) { const S = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { let b = 0, bd = Infinity; for (let c = 0; c < C.length; c++) { const dl = P[i * 3] - C[c][0], da = P[i * 3 + 1] - C[c][1], db = P[i * 3 + 2] - C[c][2], d = dl * dl + da * da + db * db; if (d < bd) { bd = d; b = c; } } as[i] = b; const s = S[b]; s[0] += P[i * 3] * w[i]; s[1] += P[i * 3 + 1] * w[i]; s[2] += P[i * 3 + 2] * w[i]; s[3] += w[i]; }
    let moved = 0; for (let c = 0; c < C.length; c++) if (S[c][3] > 0) { const nc = [S[c][0] / S[c][3], S[c][1] / S[c][3], S[c][2] / S[c][3]]; moved += Math.abs(nc[0] - C[c][0]) + Math.abs(nc[1] - C[c][1]) + Math.abs(nc[2] - C[c][2]); C[c] = nc; }
    if (moved < 0.05) break; }
  return { C, as };
}
/* 3×3 majority vote on a label map (removes speckle and pixel stair-steps without moving real edges) */
function majority(L, W, H, passes, protect) {
  const nb = new Int32Array(8);
  for (let ps = 0; ps < passes; ps++) { const o = L.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x, c = L[p]; if (protect && protect[c]) continue;
      nb[0] = L[p - 1]; nb[1] = L[p + 1]; nb[2] = L[p - W]; nb[3] = L[p + W]; nb[4] = L[p - W - 1]; nb[5] = L[p - W + 1]; nb[6] = L[p + W - 1]; nb[7] = L[p + W + 1];
      let same = 0; for (let i = 0; i < 8; i++) if (nb[i] === c) same++; if (same >= 3) continue;
      let best = c, bc = same; for (let i = 0; i < 8; i++) { const v = nb[i]; if (v === c || (protect && protect[v] === 2)) continue; let k = 0; for (let j = 0; j < 8; j++) if (nb[j] === v) k++; if (k > bc) { bc = k; best = v; } } o[p] = best; }
    L = o; }
  return L;
}
/* chamfer 3-4 distance to the nearest pixel with a different label (image edges count as edges); px units */
function distToEdge(R, W, H) {
  const N = W * H, D = new Float32Array(N), BIG = 1e9;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, r = R[p]; D[p] = (x === 0 || y === 0 || x === W - 1 || y === H - 1 || R[p - 1] !== r || R[p + 1] !== r || R[p - W] !== r || R[p + W] !== r) ? 1 : BIG; }
  for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; let v = D[p]; v = Math.min(v, D[p - 1] + 3, D[p - W] + 3, D[p - W - 1] + 4, D[p - W + 1] + 4); D[p] = v; }
  for (let y = H - 2; y >= 0; y--) for (let x = W - 2; x >= 1; x--) { const p = y * W + x; let v = D[p]; v = Math.min(v, D[p + 1] + 3, D[p + W] + 3, D[p + W + 1] + 4, D[p + W - 1] + 4); D[p] = v; }
  for (let p = 0; p < N; p++) D[p] = D[p] === 1 ? 0.5 : (D[p] - 1) / 3 + 0.5; return D;
}
/* fill pixels labelled -1 from their nearest labelled neighbours (breadth-first; ties go to the most similar colour) */
function fillOrphans(R, W, H) {
  const N = W * H; let q = []; for (let p = 0; p < N; p++) if (R[p] >= 0) { const x = p % W; if ((x > 0 && R[p - 1] < 0) || (x < W - 1 && R[p + 1] < 0) || (p >= W && R[p - W] < 0) || (p + W < N && R[p + W] < 0)) q.push(p); }
  while (q.length) { const nq = []; for (const p of q) { const x = p % W, r = R[p]; for (const t of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) if (t >= 0 && t < N && R[t] < 0) { R[t] = r; nq.push(t); } } q = nq; }
  return R;
}

/* SLIC superpixels in Lab+xy: compact cells that snap to the photo's edges (so a boundary can exist even where two areas share a quantised colour) */
function slic(A, W, H, S, m, iters) {
  const N = W * H, cs = []; for (let y = S / 2; y < H; y += S) for (let x = S / 2; x < W; x += S) { const p = (Math.round(y) * W + Math.round(x)) * 3; cs.push([A[p], A[p + 1], A[p + 2], x, y]); }
  const L = new Int32Array(N).fill(-1), Dm = new Float32Array(N), k = cs.length, sum = new Float64Array(k * 6), w = (m / S) * (m / S);
  for (let it = 0; it < iters; it++) { Dm.fill(Infinity);
    for (let c = 0; c < k; c++) { const C = cs[c], x0 = Math.max(0, Math.floor(C[3] - S)), x1 = Math.min(W - 1, Math.ceil(C[3] + S)), y0 = Math.max(0, Math.floor(C[4] - S)), y1 = Math.min(H - 1, Math.ceil(C[4] + S));
      for (let y = y0; y <= y1; y++) { const dy = y - C[4]; for (let x = x0; x <= x1; x++) { const p = y * W + x, q = p * 3, dl = A[q] - C[0], da = A[q + 1] - C[1], db = A[q + 2] - C[2], dx = x - C[3], d = dl * dl + da * da + db * db + w * (dx * dx + dy * dy); if (d < Dm[p]) { Dm[p] = d; L[p] = c; } } } }
    sum.fill(0); for (let p = 0; p < N; p++) { const c = L[p], o = c * 6, q = p * 3; sum[o] += A[q]; sum[o + 1] += A[q + 1]; sum[o + 2] += A[q + 2]; sum[o + 3] += p % W; sum[o + 4] += (p / W) | 0; sum[o + 5]++; }
    for (let c = 0; c < k; c++) { const o = c * 6, n = sum[o + 5]; if (n) cs[c] = [sum[o] / n, sum[o + 1] / n, sum[o + 2] / n, sum[o + 3] / n, sum[o + 4] / n]; } }
  return L;
}

/* ---------- region graph ---------- */
function graph(R, n, W, H, A, F, Eb) {
  const area = new Float64Array(n), ed = new Float64Array(n), lab = new Float64Array(n * 3), rgb = new Float64Array(n * 3), adj = Array.from({ length: n }, () => new Map()), touch = new Uint8Array(n);
  const link = (a, b, e) => { let m = adj[a].get(b); if (!m) { m = [0, 0]; adj[a].set(b, m); adj[b].set(a, m); } m[0]++; m[1] += e; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, r = R[p]; area[r]++; ed[r] += Eb[p]; for (let c = 0; c < 3; c++) { lab[r * 3 + c] += A[p * 3 + c]; rgb[r * 3 + c] += F[p * 4 + c]; } if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touch[r] = 1;
    if (x < W - 1 && R[p + 1] !== r) link(r, R[p + 1], Eb[p] | Eb[p + 1]); if (y < H - 1 && R[p + W] !== r) link(r, R[p + W], Eb[p] | Eb[p + W]); }
  return { n, area, ed, lab, rgb, adj, touch };
}
function mergeGraph(g, R, opts) {
  const { n, area, ed, lab, rgb, adj } = g, par = new Int32Array(n).map((_, i) => i), ver = new Int32Array(n), find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const mean = r => [lab[r * 3] / area[r], lab[r * 3 + 1] / area[r], lab[r * 3 + 2] / area[r]], dE2 = (a, b) => { let d = 0; for (let c = 0; c < 3; c++) { const v = lab[a * 3 + c] / area[a] - lab[b * 3 + c] / area[b]; d += v * v; } return d; };
  let alive = 0; for (let r = 0; r < n; r++) if (area[r] > 0) alive++;
  const merge = (a, b) => { if (adj[a].size < adj[b].size) [a, b] = [b, a]; par[b] = a; area[a] += area[b]; ed[a] += ed[b]; for (let c = 0; c < 3; c++) { lab[a * 3 + c] += lab[b * 3 + c]; rgb[a * 3 + c] += rgb[b * 3 + c]; } g.touch[a] |= g.touch[b];
    for (const [t, m] of adj[b]) { if (t === a) continue; adj[t].delete(b); const ex = adj[a].get(t); if (ex) { ex[0] += m[0]; ex[1] += m[1]; } else { adj[a].set(t, m); adj[t].set(a, m); } }
    adj[a].delete(b); adj[b] = new Map(); ver[a]++; ver[b]++; alive--; return a; };
  // Ward-style cost: colour difference² × harmonic area, raised along strong photo edges — small specks and similar neighbours go first,
  // a small but strongly different area (an eye, a beak, a window) costs a lot to lose
  let tA = 0, tE = 0; for (let r = 0; r < n; r++) { tA += area[r]; tE += ed[r]; } const d0 = Math.max(1e-3, 2 * tE / tA), lo = opts.calm;
  // focus weighting: soft, blurry, featureless areas (bokeh, sky, a plain wall) merge cheaply; detailed in-focus areas (the subject) keep their pieces
  const fw = (a, b) => lo + (1 - lo) * Math.min(1, (ed[a] + ed[b]) / (area[a] + area[b]) / d0);
  const beta = opts.beta, fd2 = opts.featDE * opts.featDE, cost = (a, b) => { const m = adj[a].get(b); return dE2(a, b) * Math.pow(area[a] * area[b] / (area[a] + area[b]), opts.aexp) * (1 + beta * m[1] / m[0]) * fw(a, b); };
  const heap = [], push = e => { heap.push(e); let i = heap.length - 1; while (i) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return t; };
  // phase 1 — region growing: every zone under the cuttable size merges (cheapest first) until none is left, except a clear feature (big enough, very different)
  const small = (r, q) => area[r] < opts.minA && !(area[r] >= opts.featA && dE2(r, q) >= fd2), ok1 = (a, b) => small(a, b) || small(b, a);
  for (let r = 0; r < n; r++) for (const q of adj[r].keys()) if (q > r && ok1(r, q)) push([cost(r, q), r, q, 0, 0]);
  while (heap.length && alive > opts.target * (opts.p1 ?? 1)) { const [, a, b, va, vb] = pop(); if (par[a] !== a || par[b] !== b || ver[a] !== va || ver[b] !== vb || !ok1(a, b)) continue; const m = merge(a, b); for (const t of adj[m].keys()) if (ok1(m, t)) push([cost(m, t), m, t, ver[m], ver[t]]); }
  // phase 2 — Ward merging of everything down to the Detail target (similar neighbours without a photo edge between them go first)
  heap.length = 0; for (let r = 0; r < n; r++) if (par[r] === r) for (const q of adj[r].keys()) if (q > r) push([cost(r, q), r, q, ver[r], ver[q]]);
  while (heap.length && alive > opts.target) { const [, a, b, va, vb] = pop(); if (par[a] !== a || par[b] !== b || ver[a] !== va || ver[b] !== vb) continue; const m = merge(a, b); for (const t of adj[m].keys()) push([cost(m, t), m, t, ver[m], ver[t]]); }
  // every piece cuttable: under the minimum size → into the most similar neighbour, unless it is a clear feature (kept, marked)
  const feat = new Uint8Array(n), minDE = r => { let m = Infinity, ef = 0, tl = 0; for (const [q, e] of adj[r]) { m = Math.min(m, Math.sqrt(dE2(r, q))); ef += e[1]; tl += e[0]; } return [m, tl ? ef / tl : 0]; };
  for (let round = 0; round < 8; round++) { const list = []; for (let r = 0; r < n; r++) if (par[r] === r && area[r] > 0 && area[r] < opts.minA && !feat[r] && adj[r].size) list.push(r); if (!list.length) break; list.sort((a, b) => area[a] - area[b]);
    for (const r of list) { if (par[r] !== r || area[r] >= opts.minA || feat[r]) continue; if (area[r] >= opts.featA) { const [m, ef] = minDE(r); if (m >= opts.featDE || (m >= opts.featDE * 0.65 && ef >= 0.55)) { feat[r] = 1; continue; } }
      let tot = 0; for (const e of adj[r].values()) tot += e[0]; let best = -1, bs = Infinity; for (const [q, e] of adj[r]) { const s = Math.sqrt(dE2(r, q)) * (1 + 2 * e[1] / e[0]) * (1.35 - 0.7 * e[0] / tot); if (s < bs) { bs = s; best = q; } }
      if (best >= 0) { const m = merge(r, best); feat[m] = feat[r] && feat[best] ? 1 : 0; } } }
  const out = new Int32Array(R.length); for (let p = 0; p < R.length; p++) out[p] = find(R[p]);
  return { R: out, feat: (r => feat[find(r)]), mean };
}
/* relabel to 0..n-1 connected pieces; return feature flags carried over */
function relabel(R, W, H, featOf) { const c = components(R, W, H), f = new Uint8Array(c.n); for (let i = 0; i < c.n; i++) f[i] = featOf ? featOf(c.from[i]) : 0; return { R: c.R, n: c.n, feat: f }; }
/* small fragments (after opening/splitting) join the neighbour with the closest colour; features ≥ featA are kept */
function absorb(R, n, W, H, A, F, Eb, feat, minPx, featA, palOf) {
  for (let round = 0; round < 6; round++) {
    const g = graph(R, n, W, H, A, F, Eb), to = new Int32Array(n).map((_, i) => i); let any = false;
    const order = [...Array(n).keys()].filter(r => g.area[r] > 0 && g.area[r] < minPx && !(feat[r] && g.area[r] >= featA)).sort((a, b) => g.area[a] - g.area[b]);
    const taken = new Uint8Array(n);
    for (const r of order) { if (taken[r]) continue; let best = -1, bs = Infinity, tot = 0; for (const e of g.adj[r].values()) tot += e[0];
      for (const [q, e] of g.adj[r]) { if (taken[q] && to[q] === r) continue; let d = 0; for (let c = 0; c < 3; c++) { const v = g.lab[r * 3 + c] / g.area[r] - g.lab[q * 3 + c] / g.area[q]; d += v * v; } const s = Math.sqrt(d) * (palOf && palOf[r] === palOf[q] ? 0.5 : 1) * (1.35 - 0.7 * e[0] / tot); if (s < bs) { bs = s; best = q; } }
      if (best >= 0) { to[r] = best; taken[r] = 1; any = true; } }
    if (!any) { const c = components(R, W, H); if (c.n !== n) { feat = Uint8Array.from(c.from.map(x => feat[x])); if (palOf) palOf = Int32Array.from(c.from.map(x => palOf[x])); R = c.R; n = c.n; } break; }
    const fin = r => { let g2 = 0; while (to[r] !== r && g2++ < 64) r = to[r]; return r; };
    for (let p = 0; p < R.length; p++) R[p] = fin(R[p]);
    const pal2 = palOf ? palOf.slice() : null, c = components(R, W, H), f2 = new Uint8Array(c.n); for (let i = 0; i < c.n; i++) { f2[i] = feat[c.from[i]]; if (pal2) pal2[i] = palOf[c.from[i]]; }
    R = c.R; n = c.n; feat = f2; if (palOf) palOf = pal2.slice(0, n);
  }
  return { R, n, feat, pal: palOf };
}
/* morphological opening per piece: anything narrower than the minimum cuttable width (slivers, necks, sharp spikes) goes to its neighbours */
function openPieces(R, W, H, rad, keep, A) {
  const N = W * H, D = distToEdge(R, W, H), C = new Float32Array(N).fill(1e9);
  for (let p = 0; p < N; p++) if (D[p] >= rad || (keep && keep[R[p]])) C[p] = 0; // feature pieces (eyes, beak…) are never eroded
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, r = R[p]; let v = C[p]; if (x > 0 && R[p - 1] === r) v = Math.min(v, C[p - 1] + 1); if (y > 0 && R[p - W] === r) v = Math.min(v, C[p - W] + 1); if (x > 0 && y > 0 && R[p - W - 1] === r) v = Math.min(v, C[p - W - 1] + 1.41); if (x < W - 1 && y > 0 && R[p - W + 1] === r) v = Math.min(v, C[p - W + 1] + 1.41); C[p] = v; }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const p = y * W + x, r = R[p]; let v = C[p]; if (x < W - 1 && R[p + 1] === r) v = Math.min(v, C[p + 1] + 1); if (y < H - 1 && R[p + W] === r) v = Math.min(v, C[p + W] + 1); if (x < W - 1 && y < H - 1 && R[p + W + 1] === r) v = Math.min(v, C[p + W + 1] + 1.41); if (x > 0 && y < H - 1 && R[p + W - 1] === r) v = Math.min(v, C[p + W - 1] + 1.41); C[p] = v; }
  const O = new Int32Array(N); let removed = 0; for (let p = 0; p < N; p++) { if (C[p] <= rad + 0.5) O[p] = R[p]; else { O[p] = -1; removed++; } }
  if (!A) return { R: fillOrphans(O, W, H), removed };
  // trimmed pixels go to the touching piece of the closest colour (not just the nearest one), wave by wave
  let n = 0; for (let p = 0; p < N; p++) if (R[p] >= n) n = R[p] + 1; const cnt = new Float64Array(n), m = new Float64Array(n * 3);
  for (let p = 0; p < N; p++) if (O[p] >= 0) { const r = O[p]; cnt[r]++; m[r * 3] += A[p * 3]; m[r * 3 + 1] += A[p * 3 + 1]; m[r * 3 + 2] += A[p * 3 + 2]; } for (let r = 0; r < n; r++) if (cnt[r]) { m[r * 3] /= cnt[r]; m[r * 3 + 1] /= cnt[r]; m[r * 3 + 2] /= cnt[r]; }
  let todo = []; for (let p = 0; p < N; p++) if (O[p] < 0) todo.push(p);
  while (todo.length) { const set = [], rest = []; for (const p of todo) { const x = p % W; let best = -1, bd = Infinity; for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) { if (q < 0 || q >= N) continue; const l = O[q]; if (l < 0) continue; const d = (A[p * 3] - m[l * 3]) ** 2 + (A[p * 3 + 1] - m[l * 3 + 1]) ** 2 + (A[p * 3 + 2] - m[l * 3 + 2]) ** 2; if (d < bd) { bd = d; best = l; } } if (best >= 0) set.push(p, best); else rest.push(p); }
    if (!set.length) break; for (let i = 0; i < set.length; i += 2) O[set[i]] = set[i + 1]; todo = rest; }
  return { R: O, removed };
}
/* border relaxation: each border pixel joins the touching piece whose mean colour it matches best (with a smoothness term), so lead lines settle on the real colour edge */
function relax(R, n, A, W, H, iters, lam, keep) {
  const N = W * H, cnt = new Float64Array(n), m = new Float64Array(n * 3), nb = new Int32Array(8), nc = new Int32Array(8), off = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
  for (let it = 0; it < iters; it++) { cnt.fill(0); m.fill(0); for (let p = 0; p < N; p++) { const r = R[p]; cnt[r]++; m[r * 3] += A[p * 3]; m[r * 3 + 1] += A[p * 3 + 1]; m[r * 3 + 2] += A[p * 3 + 2]; }
    for (let r = 0; r < n; r++) if (cnt[r]) { m[r * 3] /= cnt[r]; m[r * 3 + 1] /= cnt[r]; m[r * 3 + 2] /= cnt[r]; }
    const o = R.slice(); let moved = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x, own = R[p]; if (R[p - 1] === own && R[p + 1] === own && R[p - W] === own && R[p + W] === own) continue; if (keep && keep[own]) continue;
      let k = 0; for (let t = 0; t < 8; t++) { const l = R[p + off[t]]; let j = 0; for (; j < k; j++) if (nb[j] === l) { nc[j]++; break; } if (j === k) { nb[k] = l; nc[k] = 1; k++; } }
      const L0 = A[p * 3], a0 = A[p * 3 + 1], b0 = A[p * 3 + 2], dist = (l, c) => Math.sqrt((L0 - m[l * 3]) ** 2 + (a0 - m[l * 3 + 1]) ** 2 + (b0 - m[l * 3 + 2]) ** 2) - lam * c;
      let ownC = 0; for (let j = 0; j < k; j++) if (nb[j] === own) ownC = nc[j]; let best = own, bd = dist(own, ownC);
      for (let j = 0; j < k; j++) { if (nb[j] === own) continue; const d = dist(nb[j], nc[j]); if (d < bd) { bd = d; best = nb[j]; } }
      if (best !== own) { o[p] = best; moved++; } }
    R.set(o); if (!moved) break; }
  return R;
}
/* split one piece into k by k-means on pixel positions (straight-ish cut lines) */
function splitPiece(R, W, H, r, k, nextId) {
  const px = []; for (let p = 0; p < R.length; p++) if (R[p] === r) px.push(p); if (px.length < k * 4) return 0;
  const P = new Float32Array(px.length * 3), w = new Float32Array(px.length).fill(1); px.forEach((p, i) => { P[i * 3] = p % W; P[i * 3 + 1] = (p / W) | 0; });
  const km = kmeansPP(P, w, k, 12, 5 + r); px.forEach((p, i) => { if (km.as[i]) R[p] = nextId + km.as[i] - 1; }); return km.C.length - 1;
}

/* ---------- the tracer ---------- */
/* img: {width,height,data RGBA} at working resolution (panel inner area). o: settings. env: {palette:[[name,r,g,b]...], line:{in,label}, frameGlass} */
/* Cuttability limits by tool, from published stained-glass construction guidance (finished size, after the line allowance).
   mm² → sq in: ÷ 645.16; mm → in: ÷ 25.4.
   - Narrowest part / smallest piece: EZGlassPattern cut-checker limits — "tricky" under 9 mm / 250 mm², "won't cut" under 5 mm / 100 mm²,
     "won't cut (Beginner)" under 7 mm / 196 mm².  https://ezglasspattern.com/is-my-stained-glass-pattern-cuttable
     Beginner class guidance (pieces ≥ 2 cm at the narrowest) is for a first ~20-piece suncatcher, so it is used only as the hand-cutting comfort size.
     https://dorsetstainedglass.com/wp-content/uploads/2026/01/Suncatcher-Stained-Glass-Design-Template-20cm-x-30cm.pdf
     "below roughly half an inch, a piece becomes fragile in the grinder" https://www.stainedglassonline.com/stained-glass-patterns
   - Inside curves: hand cutting "tricky" deeper than 0.55 × opening, "won't cut" deeper than 0.9 × opening (EZGlassPattern, link above);
     severe inside curves must be broken out in steps (Delphi: https://www.delphiglass.com/page/knowledgeBaseView?KBItemID=12);
     deeply concave shapes "may be best cut with a diamond band saw or ring saw" (https://www.jimbolesdesigns.com/HKWT/stainedGlassTips.pdf);
     a ring saw "makes the impossible glass cuts possible" (https://www.delphiglass.com/pdf/lesson/How%20to%20Use%20a%20Ring%20Saw.pdf);
     a 1/8″ grinder bit reaches tighter inside curves than the standard 1/4″ bit (https://www.glasscampus.com/tutorials/Lazy%20Man's%20Guide.pdf).
   - Points need a break line to an edge (cuts run edge to edge): https://www.delphiglass.com/pdf/lesson/How%20to%20Create%20a%20Pattern.pdf
   - Piece inside another piece: always uncuttable — add a line out to the edge (EZGlassPattern, link above).
   - Junctions: three lines meeting is ideal, avoid five or six (https://ezglasspattern.com/beginner-stained-glass-patterns; warns at 4).
   - Line allowance taken off each piece: foil shears remove 1/32″, lead shears 5/64″ (https://www.delphiglass.com/page/knowledgeBaseView?KBItemID=10).
   - Panels over ~2 ft (610 mm) need reinforcement (https://www.delphiglass.com/page/knowledgeBaseView?KBItemID=44,
     https://glasstips.blogspot.com/2008/11/copper-foil-limitations.html). No published limit for one piece was found; 36 sq in is a handling guess. */
const MM2 = 1 / 645.16, MM = 1 / 25.4;
const TOOLS = {
  // regular piece: smallest area / narrowest part; feature piece (eye, beak, window): smallest area / narrowest part; concave pieces below splitSolidity get a break line
  // hand: EZGlassPattern "won't cut (Beginner)" 196 mm² / 7 mm for every piece; features down to the general "won't cut" 100 mm² / 5 mm
  hand:    { label: 'Hand cutting', minArea: 196 * MM2, minWidth: 7 * MM, featArea: 100 * MM2, featWidth: 5 * MM, splitSolidity: 0.6, deepFlag: 'deep-curve' },
  // grinder (default): EZGlassPattern general "won't cut" 100 mm² / 5 mm — anything bigger is cuttable (between 100 and 250 mm² it is "tricky");
  // features (eyes) down to 64 mm² (8×8 mm) / 4 mm: our extrapolation for grinder-shaped tiny pieces held with a grinder cookie/tongs
  // (everythingstainedglass.com/grinding-stained-glass describes grinding ~1 cm triangles this way)
  grinder: { label: 'With grinder', minArea: 100 * MM2, minWidth: 5 * MM, featArea: 64 * MM2, featWidth: 4 * MM, splitSolidity: 0.42, deepFlag: 'grind' },
  // ring saw: cuts any curve (Delphi ring-saw lesson); size limits below the hand/grinder ones are our extrapolation (64 mm² / 4 mm, features 36 mm² / 3 mm)
  ringsaw: { label: 'Ring saw', minArea: 64 * MM2, minWidth: 4 * MM, featArea: 36 * MM2, featWidth: 3 * MM, splitSolidity: 0.25, deepFlag: 'saw' },
};
const LINE_ALLOW = { foil116: 1 / 32, foil18: 1 / 32, came316: 5 / 64, came14: 5 / 64 }; // inches removed per line by pattern shears (Delphi KB 10)
function rules(o, innerAreaIn) {
  const det = Math.max(1, Math.min(10, +o.detail || 6)), t = (det - 1) / 9, target = Math.round(22 * Math.pow(20, t)), TU = o._tune || {};
  const tool = TOOLS[o.tool] || TOOLS.grinder, allow = TU.oldRules ? 0 : (LINE_ALLOW[o.line] ?? 1 / 32);
  if (TU.oldRules) { // v7-draft rules kept for the before/after comparison
    const floorIn = 0.28 - 0.16 * t, minAreaIn = r2(Math.max(floorIn, Math.min(1.5, (innerAreaIn || 80) / (target * 2.2))));
    return { det, target, tool: 'old', minAreaIn, featAreaIn: r2(Math.max(0.08, minAreaIn * 0.35)), minWidthIn: r2(Math.max(0.2, Math.min(0.42, 0.45 * Math.sqrt(minAreaIn)))), featWidthIn: 0, maxAreaIn: 24, splitSolidity: 0.58, deepFlag: 'deep-curve', allowIn: 0, colors: Math.max(4, Math.min(24, Math.round(+o.tcolors || 12))) };
  }
  // Detail sets the piece count; the tool sets the physical floor (a bigger panel therefore keeps more detail). Pieces are measured after the line allowance.
  const minAreaIn = r2(Math.max(tool.minArea, Math.min(1.5, (innerAreaIn || 80) / (target * (TU.fill ?? 3)))));
  return { det, target, tool: o.tool in TOOLS ? o.tool : 'grinder', toolLabel: tool.label, minAreaIn, featAreaIn: r2(tool.featArea), minWidthIn: r2(Math.max(tool.minWidth, Math.min(0.42, 0.45 * Math.sqrt(minAreaIn)))), featWidthIn: r2(tool.featWidth),
    maxAreaIn: 36, splitSolidity: tool.splitSolidity, deepFlag: tool.deepFlag, allowIn: allow, colors: Math.max(4, Math.min(24, Math.round(+o.tcolors || 12))) };
}
function trace(img, o, env) {
  const TU = o._tune || {}, T = { start: now() }, tick = k => { T[k] = Math.round(now() - T.start); };
  const iw = img.width, ih = img.height, N = iw * ih, F = img.data, widthIn = +o.widthIn || 12;
  const f = Math.max(0, Math.round(img.f || 0)), W = iw + 2 * f, H = ih + 2 * f, ppi = W / widthIn, notes = [], ru = rules(o, N / ppi / ppi);
  const minA = ru.minAreaIn * ppi * ppi, featA = ru.featAreaIn * ppi * ppi, maxA = ru.maxAreaIn * ppi * ppi, minW = (ru.minWidthIn + ru.allowIn) * ppi; // width is checked on the drawn piece, so the line allowance is added
  // 1 the duplicate: photo → Lab (alpha over white); the original image is never touched
  const A0 = new Float32Array(N * 3); for (let p = 0; p < N; p++) { const a = F[p * 4 + 3] / 255; const c = rgbLab(Math.round(F[p * 4] * a + 255 * (1 - a)), Math.round(F[p * 4 + 1] * a + 255 * (1 - a)), Math.round(F[p * 4 + 2] * a + 255 * (1 - a))); A0[p * 3] = c[0]; A0[p * 3 + 1] = c[1]; A0[p * 3 + 2] = c[2]; }
  // 2 edge-preserving smoothing
  const sc = Math.max(iw, ih) / 800, A = bilateral(A0, iw, ih, 2, 7, Math.max(1, Math.round(2 * sc))); tick('smooth');
  // strong edges (Canny) — the lines that make the subject recognisable; dilated by 1 px for scoring
  const cn = canny(A, iw, ih), Eb = new Uint8Array(N); for (let y = 1; y < ih - 1; y++) for (let x = 1; x < iw - 1; x++) { const p = y * iw + x; if (cn.E[p] || cn.E[p - 1] || cn.E[p + 1] || cn.E[p - iw] || cn.E[p + iw]) Eb[p] = 1; } tick('edges');
  // 3 colour quantisation in Lab with the photo's own colours (finer than the final glass palette; regions merge later)
  const K0 = Math.max(16, Math.min(32, ru.colors + 10)), step = Math.max(1, Math.floor(N / 30000)), S = []; for (let p = 0; p < N; p += step) S.push(A[p * 3], A[p * 3 + 1], A[p * 3 + 2]);
  const Sp = new Float32Array(S), km = kmeansPP(Sp, new Float32Array(Sp.length / 3).fill(1), K0, 16, 11), C0 = km.C;
  let Q = new Int32Array(N); for (let p = 0; p < N; p++) { let b = 0, bd = Infinity; for (let c = 0; c < C0.length; c++) { const dl = A[p * 3] - C0[c][0], da = A[p * 3 + 1] - C0[c][1], db = A[p * 3 + 2] - C0[c][2], d = dl * dl + da * da + db * db; if (d < bd) { bd = d; b = c; } } Q[p] = b; }
  Q = majority(Q, iw, ih, 2); tick('quantize');
  // 4 regions: connected colour zones → merged (Ward cost, edge-aware) to the Detail target, then every piece made cuttable
  // 4a FAITHFUL TRACE — a literal vector duplicate: small edge-hugging superpixels × quantised colours, only speckles removed and
  // near-identical neighbours joined (ΔE < 3 with no photo edge between them); every region keeps its own real mean colour. No cuttability rules.
  const Sf = Math.max(4, Math.round((TU.sf ?? 6) * sc)), SP = slic(A, iw, ih, Sf, 10, 4), key = new Int32Array(N); for (let p = 0; p < N; p++) key[p] = SP[p] * 64 + Q[p]; tick('superpixels');
  let cc = components(key, iw, ih); const startRegions = cc.n;
  { const ab0 = absorb(cc.R, cc.n, iw, ih, A, F, Eb, new Uint8Array(cc.n), Math.max(6, Math.round(10 * sc * sc)), 1e12, null); cc = { R: ab0.R, n: ab0.n }; }
  { const g0 = graph(cc.R, cc.n, iw, ih, A, F, Eb), n0 = cc.n, par = new Int32Array(n0).map((_, i) => i), ar = Float64Array.from(g0.area), sl = Float64Array.from(g0.lab), find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    const de = (a, b) => Math.sqrt((sl[a * 3] / ar[a] - sl[b * 3] / ar[b]) ** 2 + (sl[a * 3 + 1] / ar[a] - sl[b * 3 + 1] / ar[b]) ** 2 + (sl[a * 3 + 2] / ar[a] - sl[b * 3 + 2] / ar[b]) ** 2), pairs = [];
    for (let r = 0; r < n0; r++) for (const [q, e] of g0.adj[r]) if (q > r && e[1] / e[0] < 0.2) { const d = de(r, q); if (d < (TU.fde ?? 3)) pairs.push([d, r, q]); } pairs.sort((a, b) => a[0] - b[0]);
    for (const [, a0, b0] of pairs) { const a = find(a0), b = find(b0); if (a === b || de(a, b) >= (TU.fde ?? 3)) continue; par[b] = a; ar[a] += ar[b]; for (let c = 0; c < 3; c++) sl[a * 3 + c] += sl[b * 3 + c]; }
    for (let p = 0; p < N; p++) cc.R[p] = find(cc.R[p]); cc = components(cc.R, iw, ih); }
  const R0 = cc.R, n0 = cc.n; tick('faithful');
  let faithful = null, fD = null, fL = null, fA = null;
  if (o.faithful !== false) { const g0 = graph(R0, n0, iw, ih, A, F, Eb), rs0 = vectorize(R0, n0, iw, ih, { smooth: 1, eps: 0.6 }), paths = []; fD = new Array(n0); fL = new Float32Array(n0); fA = g0.area; for (let r = 0; r < n0; r++) fL[r] = g0.lab[r * 3] / g0.area[r];
    for (let r = 0; r < n0; r++) { const rs = rs0[r]; if (!rs || !rs.length) continue; fD[r] = rs.map(ringSegs).map(segsToD).join(''); paths.push([fD[r], hex([g0.rgb[r * 3] / g0.area[r], g0.rgb[r * 3 + 1] / g0.area[r], g0.rgb[r * 3 + 2] / g0.area[r]])]); }
    let big = 0; for (let r = 1; r < n0; r++) if (g0.area[r] > g0.area[big]) big = r; // any region the vectoriser could not ring sits on the largest region's colour instead of showing as a hole
    faithful = { w: iw, h: ih, regions: paths.length, paths, bg: hex([g0.rgb[big * 3] / g0.area[big], g0.rgb[big * 3 + 1] / g0.area[big], g0.rgb[big * 3 + 2] / g0.area[big]]) }; tick('faithfulVec'); }
  // 4b CUT PATTERN — derived from the faithful trace: its regions are merged (edge-aware Ward cost) down to the Detail target
  let g = graph(R0, n0, iw, ih, A, F, Eb);
  const mg = mergeGraph(g, R0, { target: Math.round(ru.target * (TU.tmul ?? 1)), minA, featA, featDE: TU.featDE ?? 20, beta: TU.beta ?? 4, aexp: TU.aexp ?? 1, calm: TU.calm ?? 0.3, p1: TU.p1 }); let rl = relabel(mg.R, iw, ih, mg.feat), R = rl.R, n = rl.n, feat = rl.feat; tick('merge'); T.nMerge = n;
 
  if (TU.relax !== 0) { relax(R, n, A, iw, ih, TU.relax ?? 4, TU.lam ?? 6, null); rl = relabel(R, iw, ih, x => feat[x]); R = rl.R; n = rl.n; feat = rl.feat; }
 
  if (TU.thin !== 0) for (let round = 0; round < 3; round++) { // pieces narrower than the cuttable width everywhere (a window bar, a whisker strip) join the most similar neighbour whole, before trimming
    const D = distToEdge(R, iw, ih), md = new Float32Array(n); for (let p = 0; p < N; p++) if (D[p] > md[R[p]]) md[R[p]] = D[p];
    const gg = graph(R, n, iw, ih, A, F, Eb), to = new Int32Array(n).map((_, i) => i); let any = 0;
    const order = [...Array(n).keys()].filter(r => md[r] < minW * 0.5 && !(feat[r] && gg.area[r] >= featA)).sort((a, b) => gg.area[a] - gg.area[b]), done = new Uint8Array(n);
    for (const r of order) { if (done[r]) continue; let best = -1, bs = Infinity; for (const [q, e] of gg.adj[r]) { if (done[q] && to[q] === r) continue; let d = 0; for (let c = 0; c < 3; c++) d += (gg.lab[r * 3 + c] / gg.area[r] - gg.lab[q * 3 + c] / gg.area[q]) ** 2; const sc = Math.sqrt(d) / Math.sqrt(e[0]); if (sc < bs) { bs = sc; best = q; } } if (best >= 0) { to[r] = best; done[r] = 1; any++; } }
    if (!any) break; const fin = r => { let g2 = 0; while (to[r] !== r && g2++ < 64) r = to[r]; return r; }; for (let p = 0; p < N; p++) R[p] = fin(R[p]);
    rl = relabel(R, iw, ih, x => feat[x]); R = rl.R; n = rl.n; feat = rl.feat; }
 
  // glass palette: k-means over the pieces' real mean colours (area-weighted) → the N glass colours you buy
  const palette = r => { const gg = graph(R, n, iw, ih, A, F, Eb), P = new Float32Array(n * 3), w = new Float32Array(n); for (let i = 0; i < n; i++) { w[i] = gg.area[i]; for (let c = 0; c < 3; c++) P[i * 3 + c] = gg.lab[i * 3 + c] / gg.area[i]; }
    const k2 = kmeansPP(P, w.map(v => Math.sqrt(v)), ru.colors, TU.lloyd ?? 4, 3, true), pal = Int32Array.from(k2.as); return { gg, C: k2.C, pal }; };
  let pk = palette(); let pal = pk.pal;
  { // neighbours that got the same glass colour and meet without a strong photo edge become one piece (no needless lead lines)
    const gg = pk.gg, par = new Int32Array(n).map((_, i) => i), ar = Float64Array.from(gg.area), find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    const pairs = []; for (let r = 0; r < n; r++) for (const [q, e] of gg.adj[r]) if (q > r && pal[q] === pal[r] && e[1] / e[0] < (TU.samePal ?? 0.3)) { let d = 0; for (let c = 0; c < 3; c++) d += (gg.lab[r * 3 + c] / gg.area[r] - gg.lab[q * 3 + c] / gg.area[q]) ** 2; if (Math.sqrt(d) < (TU.sameDE ?? 3)) pairs.push([e[1] / e[0], r, q]); } pairs.sort((a, b) => a[0] - b[0]);
    for (const [, a, b] of pairs) { const x = find(a), y = find(b); if (x === y || ar[x] + ar[y] > maxA * 0.8) continue; par[y] = x; ar[x] += ar[y]; feat[x] = 0; }
    for (let p = 0; p < N; p++) R[p] = find(R[p]); const c2 = components(R, iw, ih), f2 = new Uint8Array(c2.n), p2 = new Int32Array(c2.n); for (let i = 0; i < c2.n; i++) { f2[i] = feat[c2.from[i]]; p2[i] = pal[c2.from[i]]; } R = c2.R; n = c2.n; feat = f2; pal = p2; }
  tick('palette'); T.nPal = n;
  // 5 cuttability: open every piece at the minimum width; split very concave or oversized pieces; bridge pieces that enclose another
  const protect = new Uint8Array(n); for (let i = 0; i < n; i++) if (feat[i]) protect[i] = 1;
  R = majority(R, iw, ih, 2, protect);
  let op = openPieces(R, iw, ih, minW * 0.5 * (TU.openK ?? 1), feat, A); { const c2 = components(op.R, iw, ih); R = c2.R; n = c2.n; feat = Uint8Array.from(c2.from.map(x => feat[x])); pal = Int32Array.from(c2.from.map(x => pal[x])); }
  let ab = absorb(R, n, iw, ih, A, F, Eb, feat, minA * 0.55, featA, pal); R = ab.R; n = ab.n; feat = ab.feat; pal = ab.pal; T.nOpen = n;
  for (let round = 0; round < 3; round++) { // concave (C/L-shaped) or oversized pieces get a straight cut
    const vec = traceRegions(R, n, iw, ih), gg = graph(R, n, iw, ih, A, F, Eb); let next = n, did = 0; const parent = [];
    for (let r = 0; r < n; r++) { const ring = vec.rings[r] && vec.rings[r].length ? vec.rings[r].reduce((a, b) => b.length > a.length ? b : a) : null; if (!ring) continue;
      const pts = ring.map(v => [v % vec.VW, Math.floor(v / vec.VW)]), ha = Math.abs(ringArea(hull(pts))) || 1, sol = gg.area[r] / ha; let k = 1;
      if (gg.area[r] > maxA) k = Math.ceil(gg.area[r] / (maxA * 0.75)); else if (sol < ru.splitSolidity && gg.area[r] > minA * 2.2) k = 2; // hand: break line through deep inside curves; grinder/saw: only extreme C-shapes
      if (k > 1) { const add = splitPiece(R, iw, ih, r, Math.min(k, 6), next); for (let j = 0; j < add; j++) parent.push(r); next += add; did++; } }
    if (!did) break; const pal2 = Int32Array.from([...pal, ...parent.map(r => pal[r])]), feat2 = Uint8Array.from([...feat, ...parent.map(() => 0)]);
    const c2 = components(R, iw, ih); R = c2.R; n = c2.n; pal = Int32Array.from(c2.from.map(x => pal2[x])); feat = Uint8Array.from(c2.from.map(x => feat2[x]));
    ab = absorb(R, n, iw, ih, A, F, Eb, feat, minA * 0.55, featA, pal); R = ab.R; n = ab.n; feat = ab.feat; pal = ab.pal; }
 
  let bridged = 0;
  for (let round = 0; round < 3; round++) { // no piece may enclose another (a ring of glass cannot be cut): cut the outer piece on both sides of the inner one
    const vec = traceRegions(R, n, iw, ih); let did = 0;
    for (let q = 0; q < n; q++) { if (!vec.rings[q] || vec.rings[q].length < 2) continue;
      // holes of q: non-q pixels inside q's bounding box not reachable from outside the box without crossing q
      let x0 = iw, y0 = ih, x1 = 0, y1 = 0; for (let p = 0; p < N; p++) if (R[p] === q) { const x = p % iw, y = (p / iw) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const bw = x1 - x0 + 3, bh = y1 - y0 + 3, M = new Uint8Array(bw * bh), st = [0]; M[0] = 2; const at = (x, y) => { const X = x + x0 - 1, Y = y + y0 - 1; return X < 0 || Y < 0 || X >= iw || Y >= ih ? -1 : R[Y * iw + X]; };
      while (st.length) { const i = st.pop(), x = i % bw, y = (i / bw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue; const j = yy * bw + xx; if (M[j] || at(xx, yy) === q) continue; M[j] = 2; st.push(j); } }
      let hx = 0, hy = 0, hn = 0; for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (!M[y * bw + x] && at(x, y) !== q) { hx += x + x0 - 1; hy += y + y0 - 1; hn++; }
      if (!hn) continue; hx /= hn; hy /= hn;
      // direction: towards the nearest way out of q
      let best = null, bd = Infinity; for (let p = 0; p < N; p++) { if (R[p] !== q) continue; const x = p % iw, y = (p / iw) | 0; let out = x === 0 || y === 0 || x === iw - 1 || y === ih - 1; if (!out) for (const t of [p - 1, p + 1, p - iw, p + iw]) { const r = R[t]; if (r !== q) { const tx = t % iw, ty = (t / iw) | 0, lx = tx - x0 + 1, ly = ty - y0 + 1; if (M[ly * bw + lx] === 2) { out = true; break; } } } if (out) { const d = (x - hx) ** 2 + (y - hy) ** 2; if (d < bd) { bd = d; best = [x, y]; } } }
      if (!best) continue; let dx = best[0] - hx, dy = best[1] - hy; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      for (const sgn of [1, -1]) { let x = hx, y = hy, inQ = false; for (let s = 0; s < 4 * (iw + ih); s++) { x += sgn * dx * 0.5; y += sgn * dy * 0.5; const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= iw || yi >= ih) break; const p = yi * iw + xi, r = R[p]; if (r === q || r === -2) { R[p] = -2; inQ = true; } else if (inQ) break; } }
      for (let p = 0; p < N; p++) if (R[p] === -2) R[p] = n + 1e6; // temporary cut label
      did++; bridged++; }
    if (!did) break;
    { const c2 = components(R, iw, ih), cut = n + 1e6; for (let p = 0; p < N; p++) if (c2.from[c2.R[p]] === cut) c2.R[p] = -1; fillOrphans(c2.R, iw, ih); const cp = components(c2.R, iw, ih); R = cp.R; const fromOld = cp.from.map(x => c2.from[x]); n = cp.n; pal = Int32Array.from(fromOld.map(x => x === cut ? 0 : pal[x])); feat = Uint8Array.from(fromOld.map(x => x === cut ? 0 : feat[x])); }
    ab = absorb(R, n, iw, ih, A, F, Eb, feat, minA * 0.4, featA, pal); R = ab.R; n = ab.n; feat = ab.feat; pal = ab.pal; }
  tick('cuttable');
  // final palette pass on the finished pieces (real mean colours), so legend counts are exact
  pk = palette(); pal = pk.pal; const gF = pk.gg;
  // palette display colour = area-weighted mean of the real photo pixels in that colour
  const K = pk.C.length, prgb = Array.from({ length: K }, () => [0, 0, 0, 0]); for (let r = 0; r < n; r++) { const k = pal[r]; for (let c = 0; c < 3; c++) prgb[k][c] += gF.rgb[r * 3 + c]; prgb[k][3] += gF.area[r]; }
  const pcol = prgb.map(s => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : [128, 128, 128]);
  const glassName = (() => { const used = new Map(); const pl = env.palette || [], cd = (a, b) => { const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db); };
    const order = [...Array(K).keys()].sort((a, b) => prgb[b][3] - prgb[a][3]), names = new Array(K);
    for (const k of order) { let best = 'Glass ' + (k + 1), bd = Infinity; for (const p of pl) { const d = cd(pcol[k], [p[1], p[2], p[3]]); if (d < bd) { bd = d; best = p[0]; } } let ud = Infinity, ub = null; for (const u of env.user || []) { const d = cd(pcol[k], [u[1], u[2], u[3]]); if (d < ud) { ud = d; ub = u; } } if (ub && ud <= bd * 1.6 + 45) best = ub[0]; const c = (used.get(best) || 0) + 1; used.set(best, c); names[k] = c > 1 ? `${best} ${['', '', 'B', 'C', 'D', 'E', 'F'][c] || c}` : best; }
    return names; })();
  // outline kept: share of strong photo edges that lie on (within 2 px of) a lead line
  const D2 = distToEdge(R, iw, ih); let eT = 0, eK = 0; for (let p = 0; p < N; p++) if (cn.E[p]) { const x = p % iw, y = (p / iw) | 0; if (x < 3 || y < 3 || x > iw - 4 || y > ih - 4) continue; eT++; if (D2[p] <= 2.5) eK++; }
  // 5b PAINT LINES — the traditional trace-line / matting technique (glass paint on the cut pieces, fired, then foiled):
  // fine detail the cut pattern cannot keep as glass (pupils, fur strokes, whiskers, feather barbs, mullions, petal veins) is taken
  // from the photo's edges and drawn as thin painting guide lines INSIDE pieces. Edges that already sit on a lead line are removed
  // (lead half-width + 2 px buffer), very short fragments dropped, the rest chained and smoothed into strokes.
  // Light shading (matting) = faithful-trace regions clearly darker than the piece they sit in.
  // Sources: https://www.glasspaintersmethod.com/how-to-paint-stained-glass/ (copy the main trace lines, then soften into shading),
  //          https://www.atomicstainedglass.com/the-process (glass is painted with vitreous paint and kiln-fired after cutting, before leading)
  let paint = null;
  if (o.tpaint !== false) {
    const AM = { light: { pct: 0.9, hi: 16, minLen: 16, wMM: 0.5, mat: 0 }, medium: { pct: 0.8, hi: 10, minLen: 10, wMM: 0.7, mat: 0.28 }, bold: { pct: 0.7, hi: 9, minLen: 6, wMM: 1, mat: 0.42 } }, am = AM[o.tpaintAmt] || AM.medium;
    const ce = canny(A0, iw, ih, TU.ppct ?? am.pct, TU.phi ?? am.hi).E, buf = (env.line ? env.line.in : 1 / 16) * ppi / 2 + 2, M = new Uint8Array(N);
    for (let y = 2; y < ih - 2; y++) for (let x = 2; x < iw - 2; x++) { const p = y * iw + x; if (ce[p] && D2[p] > buf) M[p] = 1; }
    const lines = [], seen = new Uint8Array(N), nb8 = [-1, 1, -iw, iw, -iw - 1, -iw + 1, iw - 1, iw + 1], minLen = Math.max(4, Math.round((TU.pmin ?? am.minLen) * Math.max(0.6, ppi / 60)));
    const deg = p => { let d = 0; for (const o2 of nb8) if (M[p + o2]) d++; return d; };
    // connected fragments → drop short ones
    const comp = new Int32Array(N).fill(-1), csz = []; for (let p = 0; p < N; p++) if (M[p] && comp[p] < 0) { const id = csz.length, st = [p]; comp[p] = id; let c = 0; while (st.length) { const q = st.pop(); c++; for (const o2 of nb8) { const r = q + o2; if (M[r] && comp[r] < 0) { comp[r] = id; st.push(r); } } } csz.push(c); }
    for (let p = 0; p < N; p++) if (M[p] && csz[comp[p]] < minLen) M[p] = 0;
    // chain pixels into polylines (start at endpoints first), then simplify + Chaikin-smooth
    const walk = p0 => { const pts = [[p0 % iw, (p0 / iw) | 0]]; seen[p0] = 1; let p = p0; for (;;) { let nx = -1; for (const o2 of nb8) { const r = p + o2; if (M[r] && !seen[r]) { nx = r; break; } } if (nx < 0) break; seen[nx] = 1; pts.push([nx % iw, (nx / iw) | 0]); p = nx; } return pts; };
    const rdp = (pts, eps) => { if (pts.length < 3) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]]; while (st.length) { const [a, b] = st.pop(); let md = 0, mi = -1; const [x1, y1] = pts[a], [x2, y2] = pts[b], L = Math.hypot(x2 - x1, y2 - y1) || 1; for (let i = a + 1; i < b; i++) { const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L; if (d > md) { md = d; mi = i; } } if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); } } return pts.filter((_, i) => keep[i]); };
    const chaikin = pts => { if (pts.length < 3) return pts; const o2 = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]]; o2.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } o2.push(pts[pts.length - 1]); return o2; };
    const starts = []; for (let p = 0; p < N; p++) if (M[p] && deg(p) === 1) starts.push(p); for (let p = 0; p < N; p++) if (M[p]) starts.push(p);
    let px = 0; for (const p of starts) { if (seen[p]) continue; const pts = walk(p); if (pts.length < Math.max(3, minLen / 2)) continue; px += pts.length; lines.push(chaikin(chaikin(rdp(pts, 0.7))).map(q => [r2(q[0] + 0.5 + f), r2(q[1] + 0.5 + f)])); }
    // matting: faithful regions much darker than their piece, as a soft translucent wash
    const mat = []; if (am.mat && fD) { const pl = new Float32Array(n), pa = new Float64Array(n); for (let p = 0; p < N; p++) { pl[R[p]] += A[p * 3]; pa[R[p]]++; } const pr = new Int32Array(n0).fill(-1); for (let p = 0; p < N; p++) if (pr[R0[p]] < 0) pr[R0[p]] = R[p];
      for (let r = 0; r < n0; r++) { const q = pr[r]; if (q < 0 || !fD[r]) continue; const dl = pl[q] / pa[q] - fL[r]; if (dl > (TU.matDL ?? 14) && fA[r] < pa[q] * 0.7) mat.push([fD[r], r2(Math.min(am.mat, dl / 90))]); } }
    paint = { lines, mat, widthPx: r2(am.wMM / 25.4 * ppi), amount: o.tpaintAmt in AM ? o.tpaintAmt : 'medium', strokes: lines.length, px };
    tick('paint'); }
  // 6 panel = traced pieces + border frame; vectorise shared borders into smooth gap-free curves
  const G = new Int32Array(W * H); const FR = [n, n + 1, n + 2, n + 3]; // top, bottom, left, right frame strips
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (y < f) G[i] = FR[0]; else if (y >= H - f) G[i] = FR[1]; else if (x < f) G[i] = FR[2]; else if (x >= W - f) G[i] = FR[3]; else G[i] = R[(y - f) * iw + (x - f)]; }
  const nAll = f > 0 ? n + 4 : n;
  const rings = vectorize(G, nAll, W, H, { smooth: Math.max(3, Math.round(ppi / 11)), eps: Math.max(0.8, ppi * 0.014) }); tick('vectorize');
  const DT = distToEdge(G, W, H), best = new Int32Array(nAll).fill(-1), bestD = new Float32Array(nAll); for (let i = 0; i < W * H; i++) { const r = G[i]; if (DT[i] > bestD[r]) { bestD[r] = DT[i]; best[r] = i; } }
  const dark = (() => { let k0 = 0, lo = Infinity; for (let k = 0; k < K; k++) { const l = 0.3 * pcol[k][0] + 0.59 * pcol[k][1] + 0.11 * pcol[k][2]; if (l < lo) { lo = l; k0 = k; } } return k0; })();
  const fg = env.frameGlass && (env.palette || []).find(p => p[0] === env.frameGlass);
  let pieces = [];
  for (let r = 0; r < nAll; r++) { const rs = rings[r]; if (!rs || !rs.length) continue; const isF = r >= n;
    const areaPx = isF ? (r < n + 2 ? W * f : f * (H - 2 * f)) : gF.area[r], outer = rs.reduce((a, q) => q.length > a.length ? q : a, rs[0]).map(q => q.p), pa = Math.abs(ringArea(outer)), ha = Math.abs(ringArea(hull(outer))) || 1, flags = [];
    const areaIn = areaPx / ppi / ppi, wIn = bestD[r] * 2 / ppi, k = isF ? -1 : pal[r];
    if (!isF) { if (feat[r] && areaIn < ru.minAreaIn) flags.push('advanced'); else if (areaIn < ru.minAreaIn * 0.75) flags.push('small'); if (wIn - ru.allowIn < (feat[r] ? ru.featWidthIn || ru.minWidthIn : ru.minWidthIn) * 0.9) flags.push('narrow'); if (pa / ha < 0.6) flags.push(ru.deepFlag); if (rs.length > 1) flags.push('hole'); }
    const rgb = isF ? (fg ? [fg[1], fg[2], fg[3]] : pcol[dark]) : pcol[k], glass = isF ? (fg ? fg[0] : glassName[dark]) : glassName[k];
    const src = isF ? rgb : [gF.rgb[r * 3] / gF.area[r], gF.rgb[r * 3 + 1] / gF.area[r], gF.rgb[r * 3 + 2] / gF.area[r]];
    const lp = best[r] >= 0 ? [best[r] % W + 0.5, Math.floor(best[r] / W) + 0.5] : outer[0];
    pieces.push({ id: r, frame: isF, pal: k, rgb: rgb.map(Math.round), src: src.map(Math.round), glass, segs: rs.map(ringSegs), poly: rs.map(q => q.map(v => v.p)), label: lp.map(r2), font: r2(Math.max(4, Math.min(bestD[r] * 1.15, 0.3 * ppi))), areaIn: r2(areaIn), widthIn: r2(wIn), flags }); }
  pieces.sort((a, b) => (a.frame - b.frame) || Math.floor(a.label[1] / ppi) - Math.floor(b.label[1] / ppi) || a.label[0] - b.label[0]); pieces.forEach((p, j) => p.n = j + 1);
  const leg = new Map(); for (const p of pieces) { const e = leg.get(p.glass) || { glass: p.glass, hex: hex(p.rgb), count: 0, areaIn: 0, pieces: [] }; e.count++; e.areaIn = r2(e.areaIn + p.areaIn); e.pieces.push(p.n); leg.set(p.glass, e); }
  const legend = [...leg.values()].sort((a, b) => b.areaIn - a.areaIn);
  const inner = pieces.filter(p => !p.frame), by = fl2 => inner.filter(p => p.flags.includes(fl2)).map(p => p.n), adv = by('advanced'), small = by('small'), narrow = by('narrow'), deep = by('deep-curve'), grind = by('grind'), saw = by('saw'), hole = by('hole'), reasons = [];
  const smallest = inner.length ? Math.min(...inner.map(p => p.areaIn)) : 0, list = a => a.length > 6 ? a.slice(0, 6).map(x => '#' + x).join(', ') + ` +${a.length - 6} more` : a.map(x => '#' + x).join(', ');
  // junctions where 4 pieces meet (2×2 pixel blocks with 4 different pieces); 3 is ideal, 5–6 is a problem (EZGlassPattern)
  let j4 = 0; for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) { const i = y * W + x, a = G[i], b = G[i + 1], c = G[i + W], d = G[i + W + 1]; if (a !== b && a !== c && a !== d && b !== c && b !== d && c !== d) j4++; }
  if (pieces.length > 90) reasons.push(`${pieces.length} pieces — a first project is easier around 40–90 pieces (lower Detail or make the panel larger).`);
  if (adv.length) reasons.push(`${adv.length} small feature piece${adv.length > 1 ? 's' : ''} kept so the subject stays recognisable (${list(adv)}) — cut these slowly and grind to fit.`);
  if (deep.length) reasons.push(`Deep inside curves on ${list(deep)} — break them out in several shallow scores, or switch Tools to “With grinder”.`);
  if (grind.length) reasons.push(`Grinder pieces: ${list(grind)} have deep inside curves — rough-cut, then grind the curve with the 1/4″ (or 1/8″) bit.`);
  if (saw.length) reasons.push(`Ring-saw pieces: ${list(saw)} have deep inside curves — cut these on the ring saw.`);
  if (narrow.length) reasons.push(`Narrow pieces: ${list(narrow)}.`);
  if (small.length) reasons.push(`Small pieces: ${list(small)}.`);
  if (hole.length) reasons.push(`Pieces ${list(hole)} still surround another piece — add a cut line from the inner piece to the edge.`);
  if (j4) reasons.push(`${j4} spot${j4 > 1 ? 's' : ''} where 4 pieces meet — fine to build, but 3 lines per joint is ideal.`);
  if (Math.max(widthIn, H / ppi) > 24) reasons.push('Panel is over 24″ — add reinforcement (re-strip or a rebar every 12–18″).');
  if (!reasons.length) reasons.push('Every piece meets the rules for your tools: no slivers, no rings, curves you can cut.');
  const difficulty = pieces.length <= 110 && !deep.length && !narrow.length && !hole.length && adv.length <= 6 ? 'Beginner' : pieces.length > 220 ? 'Advanced' : 'Intermediate';
  tick('done');
  if (paint && paint.strokes) notes.push(`${paint.strokes} paint lines (fine detail such as eyes, fur, feathers, window bars and veins) are a painting guide inside the pieces — not cut lines. Trace them on the cut glass with glass paint, fire (or use no-kiln glass paint markers), then foil.`);
  notes.push(`Traced from your photo: ${startRegions.toLocaleString()} colour zones found; the faithful trace keeps ${n0.toLocaleString()} regions; the cut pattern merges them into ${inner.length} pieces along the photo’s strongest edges; ${K} glass colours taken from the photo itself.${bridged ? ` ${bridged} enclosed piece${bridged > 1 ? 's' : ''} got a short extra cut line so nothing is a ring.` : ''}`);
  const outlineKept = eT ? Math.round(eK / eT * 100) : null;
  return { kind: 'glass', version: 3, method: 'trace', engine: 'tracer-v7', f, crop: img.crop || [0, 0, 1, 1], widthIn: r2(widthIn), heightIn: r2(H / ppi), frameIn: r2(f / ppi), gridW: W, gridH: H, ppi, lineIn: env.line ? env.line.in : 1 / 16, lineLabel: env.line ? env.line.label : 'Copper foil — 1/16″ lines',
    pieces, legend, notes, trace: faithful, paint, silhouette: [], detail: [], dots: [], shapes: [], overlay: [], subject: { how: 'off', frac: 1, outlineKept }, timing: T,
    stats: { outlineKept, advanced: adv.length, detailLines: 0, dots: 0, pieces: pieces.length, colors: legend.length, difficulty, reasons, smallestIn: r2(smallest), minAreaIn: ru.minAreaIn, minWidthIn: ru.minWidthIn, target: ru.target, flagged: { advanced: adv, small, narrow, deep, grind, saw, hole }, junctions4: j4, tool: ru.tool, toolLabel: ru.toolLabel, featAreaIn: ru.featAreaIn, allowIn: ru.allowIn }, settings: o };
}
root.PhotoTracer = { trace, rules };
if (typeof module !== 'undefined' && module.exports) module.exports = root.PhotoTracer;
})(typeof self !== 'undefined' ? self : this);
