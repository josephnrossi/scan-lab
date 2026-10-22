/* Scan Lab — "Trace photo": a faithful vectorisation of the real photo into cuttable stained-glass pieces. Runs on the device, no API.
   1 edge-preserving smoothing (bilateral, in Lab)  2 colour quantisation (k-means in Lab; Detail sets 8–20 colours)
   3 connected regions (colour zones × small superpixels), grown together while their mean colours stay within the Detail threshold
   4 regions under the minimum cuttable area merge into their most similar neighbour (no confetti) 5 borders relaxed onto the photo's edges
   glass.js then traces the shared borders into smooth curves, applies the cuttability rules, numbers the pieces and builds the legend;
   every piece is filled with its real average photo colour. Nothing is invented: Simplify only makes the same regions coarser. */
function traceRules(o) {
  const det = Math.max(1, Math.min(10, +o.detail || 6)), sim = Math.max(1, Math.min(10, +o.simplicity || 4));
  const minAreaIn = Math.round(1.6 * Math.pow(0.1, (det - 1) / 9) * (0.55 + sim * 0.11) * 100) / 100;
  return { det, sim, minAreaIn, minWidthIn: Math.round(Math.max(0.2, Math.min(0.45, 0.4 * Math.sqrt(minAreaIn))) * 100) / 100, maxAreaIn: 80, smooth: 3, beginnerMax: 35,
    colors: Math.round(8 + (det - 1) * 12 / 9), sr: 5 + sim * 1.3, iters: sim >= 7 ? 4 : 3, relax: 4, lam: 6, eps: 0.45 + sim * 0.09, blur: 1, keepDE: 20, T: 19.2 - det * 1.6 + (sim - 4) * 0.8 };
}
/* label map (iw×ih) of traced regions; adv[r] = 1 for small regions kept because they clearly differ from everything around them (eyes, a nose, a beak) */
function traceSegment(F, iw, ih, ppi, rules) {
  const N = iw * ih, A = bilateral(toLab(F, N), iw, ih, rules.iters, rules.sr, ppi >= 32 ? 3 : 2), minA = rules.minAreaIn * ppi * ppi, keepA = minA * 0.35;
  // colour quantisation in Lab, plus a few extra colours for small but clearly different areas that k-means would swallow
  const step = Math.max(1, Math.floor(N / 24000)), pts = []; for (let p = 0; p < N; p += step) pts.push(A[p * 3], A[p * 3 + 1], A[p * 3 + 2]);
  const C = kmeans(new Float32Array(pts), rules.colors, 18, 11), near = (l, a, b) => { let k0 = 0, bd = Infinity; for (let k = 0; k < C.length; k++) { const x = l - C[k][0], y = a - C[k][1], z = b - C[k][2], d = x * x + y * y + z * z; if (d < bd) { bd = d; k0 = k; } } return [k0, bd]; };
  for (let extra = 0; extra < 4; extra++) { const far = []; for (let p = 0; p < N; p += 2) if (near(A[p * 3], A[p * 3 + 1], A[p * 3 + 2])[1] > 196) far.push(p); if (far.length * 2 < keepA) break; const m = [0, 0, 0]; for (const p of far) for (let k = 0; k < 3; k++) m[k] += A[p * 3 + k]; C.push(m.map(v => v / far.length)); }
  // every pixel takes its nearest quantised colour; a 5×5 then 3×3 majority vote removes noise without moving real edges
  let L = new Int32Array(N); for (let p = 0; p < N; p++) L[p] = near(A[p * 3], A[p * 3 + 1], A[p * 3 + 2])[0];
  const K = C.length, cnt = new Float32Array(K);
  for (const rad of [2, 1, 1]) { const o = new Int32Array(N); for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { cnt.fill(0); for (let j = -rad; j <= rad; j++) { const yy = y + j; if (yy < 0 || yy >= ih) continue; for (let i = -rad; i <= rad; i++) { const xx = x + i; if (xx >= 0 && xx < iw) cnt[L[yy * iw + xx]]++; } }
      const c0 = L[y * iw + x]; cnt[c0] += 0.5; let best = c0, bc = 0; for (let k = 0; k < K; k++) if (cnt[k] > bc) { bc = cnt[k]; best = k; } o[y * iw + x] = best; } L = o; }
  // connected regions: colour zones cut by small edge-hugging superpixels, so a zone that spans a soft gradient can still split along it
  const S = Math.max(4, Math.round(Math.sqrt(minA) * 0.4)), sp = slic(A, iw, ih, S, new Uint8Array(N), 5, 5), key = new Int32Array(N); for (let p = 0; p < N; p++) key[p] = sp.R[p] * 64 + L[p]; // colour zones × edge-hugging superpixels = a fine start
  const E = sobelEdges(A, iw, ih), cc = components(key, iw, ih), n = cc.n, R = cc.R, area = new Float64Array(n), sum = new Float64Array(n * 3), adj = [...Array(n)].map(() => new Map()), eS = [...Array(n)].map(() => new Map());
  const link = (r, q, e) => { adj[r].set(q, (adj[r].get(q) || 0) + 1); adj[q].set(r, (adj[q].get(r) || 0) + 1); eS[r].set(q, (eS[r].get(q) || 0) + e); eS[q].set(r, (eS[q].get(r) || 0) + e); };
  for (let p = 0; p < N; p++) { const r = R[p]; area[r]++; sum[r * 3] += A[p * 3]; sum[r * 3 + 1] += A[p * 3 + 1]; sum[r * 3 + 2] += A[p * 3 + 2]; const x = p % iw;
    if (x < iw - 1 && R[p + 1] !== r) link(r, R[p + 1], Math.max(E[p], E[p + 1])); if (p + iw < N && R[p + iw] !== r) link(r, R[p + iw], Math.max(E[p], E[p + iw])); }
  const par = new Int32Array(n).map((_, i) => i), find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; }, ver = new Int32Array(n);
  const dE2 = (a, b) => { let d = 0; for (let k = 0; k < 3; k++) { const v = sum[a * 3 + k] / area[a] - sum[b * 3 + k] / area[b]; d += v * v; } return d; };
  const heap = [], hpush = e => { heap.push(e); let i = heap.length - 1; while (i) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const hpop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return t; };
  const merge = (a, b) => { if (adj[a].size < adj[b].size) [a, b] = [b, a]; par[b] = a; area[a] += area[b]; for (let k = 0; k < 3; k++) sum[a * 3 + k] += sum[b * 3 + k];
    for (const [t, c] of adj[b]) { if (t === a) continue; const e = eS[b].get(t); adj[a].set(t, (adj[a].get(t) || 0) + c); eS[a].set(t, (eS[a].get(t) || 0) + e); adj[t].delete(b); eS[t].delete(b); adj[t].set(a, adj[a].get(t)); eS[t].set(a, eS[a].get(t)); }
    adj[a].delete(b); eS[a].delete(b); adj[b] = new Map(); eS[b] = new Map(); ver[a]++; ver[b]++; return a; };
  const kept = new Uint8Array(n), mdE = r => { let m = Infinity; for (const q of adj[r].keys()) m = Math.min(m, Math.sqrt(dE2(r, q))); return m; };
  { // 1) grow: merge neighbours whose mean colours differ less than the Detail threshold (strong photo edges count extra)
    const gc = (a, b) => Math.sqrt(dE2(a, b)) * (1 + 1.5 * eS[a].get(b) / adj[a].get(b));
    heap.length = 0; for (let r = 0; r < n; r++) for (const q of adj[r].keys()) if (q > r) hpush([gc(r, q), r, q, 0, 0]);
    while (heap.length && heap[0][0] < rules.T) { const [, a, b, va, vb] = hpop(); if (par[a] !== a || par[b] !== b || ver[a] !== va || ver[b] !== vb || !adj[a].has(b)) continue;
      const m = merge(a, b); for (const t of adj[m].keys()) hpush([gc(m, t), m, t, ver[m], ver[t]]); }
    // 2) every piece cuttable: smallest first, into the most similar neighbour — unless it clearly differs from everything around it (kept, marked advanced)
    for (let it = 0; it < 6; it++) { let any = false; const list = []; for (let r = 0; r < n; r++) if (par[r] === r && area[r] < minA && !kept[r] && adj[r].size) list.push(r); list.sort((a, b) => area[a] - area[b]);
      for (const r of list) { if (par[r] !== r || area[r] >= minA || kept[r]) continue; if (area[r] >= keepA && mdE(r) >= rules.keepDE) { kept[r] = 1; continue; }
        let tot = 0; for (const c of adj[r].values()) tot += c; let best = -1, bs = Infinity; for (const [q, c] of adj[r]) { const sc = Math.sqrt(dE2(r, q)) * (1.25 - 0.5 * c / tot); if (sc < bs) { bs = sc; best = q; } }
        if (best >= 0) { const m = merge(r, best); if (kept[m] && area[m] >= minA) kept[m] = 0; any = true; } }
      if (!any) break; }
  }
  let out = new Int32Array(N); for (let p = 0; p < N; p++) out[p] = find(R[p]);
  // border relaxation: each border pixel joins the neighbouring region whose mean colour it matches best (with a smoothness term),
  // so a piece holds one tone of the photo and its lead line sits on the real edge (an iris loses its dark rim to the rim)
  out = traceRelax(out, A, iw, ih, rules.relax, rules.lam);
  const kp = new Set(); for (let r = 0; r < n; r++) if (kept[r]) kp.add(r);
  const c2 = traceCrumbs(out, A, iw, ih, keepA * 0.6), keptOut = c2.from.map(r => kp.has(r) ? 1 : 0), areaOut = new Float64Array(c2.n); for (let p = 0; p < N; p++) areaOut[c2.R[p]]++;
  return { R: c2.R, n: c2.n, n0: n, colors: C.length, adv: keptOut.map((v, r) => v && areaOut[r] < minA ? 1 : 0) };
}
function traceRelax(Lb, A, iw, ih, iters, lam) {
  const N = iw * ih; let L = Lb;
  for (let it = 0; it < iters; it++) { const M = new Map(); for (let p = 0; p < N; p++) { let m = M.get(L[p]); if (!m) M.set(L[p], m = [0, 0, 0, 0]); m[0] += A[p * 3]; m[1] += A[p * 3 + 1]; m[2] += A[p * 3 + 2]; m[3]++; }
    for (const m of M.values()) { m[0] /= m[3]; m[1] /= m[3]; m[2] /= m[3]; }
    const o = L.slice(); let moved = 0;
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const p = y * iw + x, own = L[p]; if (!((x > 0 && L[p - 1] !== own) || (x < iw - 1 && L[p + 1] !== own) || (y > 0 && L[p - iw] !== own) || (y < ih - 1 && L[p + iw] !== own))) continue;
      const cnt = new Map(); for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { if (!i && !j) continue; const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= iw || yy >= ih) continue; const l = L[yy * iw + xx]; cnt.set(l, (cnt.get(l) || 0) + 1); }
      let best = own, bc = Infinity; for (const [l, c] of cnt) { const m = M.get(l), d = Math.hypot(A[p * 3] - m[0], A[p * 3 + 1] - m[1], A[p * 3 + 2] - m[2]) - lam * c; if (d < bc) { bc = d; best = l; } }
      { const m = M.get(own), d = Math.hypot(A[p * 3] - m[0], A[p * 3 + 1] - m[1], A[p * 3 + 2] - m[2]) - lam * (cnt.get(own) || 0); if (d <= bc) best = own; }
      if (best !== own) { o[p] = best; moved++; } }
    L = o; if (!moved) break; }
  return L;
}
/* split into connected pieces; crumbs under minPx join the neighbour of most similar colour */
function traceCrumbs(L0, A, iw, ih, minPx) {
  let cc = components(L0, iw, ih);
  for (let round = 0; round < 4; round++) { const n = cc.n, area = new Float64Array(n), sm = new Float64Array(n * 3); for (let p = 0; p < iw * ih; p++) { const r = cc.R[p]; area[r]++; for (let k = 0; k < 3; k++) sm[r * 3 + k] += A[p * 3 + k]; }
    const nb = new Map(); for (let p = 0; p < iw * ih; p++) { const r = cc.R[p]; if (area[r] >= minPx) continue; const x = p % iw; for (const q of [x > 0 ? p - 1 : -1, x < iw - 1 ? p + 1 : -1, p - iw, p + iw]) { if (q < 0 || q >= iw * ih) continue; const t = cc.R[q]; if (t === r) continue; (nb.get(r) || nb.set(r, new Set()).get(r)).add(t); } }
    if (!nb.size) break; const to = new Int32Array(n).map((_, i) => i);
    for (const [r, ts] of nb) { let b = -1, bd = Infinity; for (const t of ts) { if (area[t] < minPx && area[t] <= area[r]) continue; let d = 0; for (let k = 0; k < 3; k++) { const v = sm[r * 3 + k] / area[r] - sm[t * 3 + k] / area[t]; d += v * v; } if (d < bd) { bd = d; b = t; } } if (b < 0) b = [...ts][0]; to[r] = b; }
    const f = i => { let k = 0; while (to[i] !== i && k++ < 50) i = to[i]; return i; }, L = new Int32Array(iw * ih); for (let p = 0; p < iw * ih; p++) L[p] = f(cc.R[p]); cc = components(L, iw, ih); }
  return cc;
}
