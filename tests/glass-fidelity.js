/* Fidelity of a pattern P to the panel photo img (runs in the page):
   dE        mean colour error (CIE76, Lab) between the pattern filled with its piece colours and the photo, per pixel
   recall    share of the photo's main contours that lie within 2 px of a lead line
   precision share of lead-line pixels that lie within 2 px of a real photo edge (lead is not invented) */
window.__fidelity = async function (P, img, { fill = 'photo' } = {}) {
  const iw = img.width, ih = img.height, n0 = iw * ih, F = new Float32Array(n0 * 3); for (let i = 0; i < n0; i++) { F[i * 3] = img.data[i * 4]; F[i * 3 + 1] = img.data[i * 4 + 1]; F[i * 3 + 2] = img.data[i * 4 + 2]; }
  const A0 = toLab(F, n0), A = bilateral(A0, iw, ih, 2, 12, 2), E = sobelEdges(A, iw, ih), Cm = contourMap(A, E, iw, ih);
  const W = P.gridW, H = P.gridH, f = P.f, mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c.getContext('2d', { willReadFrequently: true }); };
  // 1) colours: every piece filled with its colour, no lead
  const g = mk(); for (const p of P.pieces) { const c = fill === 'photo' && p.src ? p.src : p.rgb; g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fill(new Path2D(p.segs.map(segsToD).join('')), 'evenodd'); }
  const d = g.getImageData(0, 0, W, H).data; let se = 0;
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) { const q = ((y + f) * W + x + f) * 4, l = gLab(d[q], d[q + 1], d[q + 2]), p = (y * iw + x) * 3; se += Math.hypot(l[0] - A0[p], l[1] - A0[p + 1], l[2] - A0[p + 2]); }
  // 2) lead: piece ids → boundary map
  const h = mk(); h.imageSmoothingEnabled = false; P.pieces.forEach((p, i) => { const id = i + 1; h.fillStyle = `rgb(${id & 255},${(id >> 8) & 255},0)`; h.fill(new Path2D(p.segs.map(segsToD).join('')), 'evenodd'); });
  const e = h.getImageData(0, 0, W, H).data, id = q => e[q * 4] + 256 * e[q * 4 + 1], B = new Uint8Array(n0);
  for (let y = 1; y < ih - 1; y++) for (let x = 1; x < iw - 1; x++) { const q = (y + f) * W + x + f; if (id(q) !== id(q + 1) || id(q) !== id(q + W)) B[y * iw + x] = 1; }
  const near = (M, x, y) => { for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < iw && yy < ih && M(yy * iw + xx)) return true; } return false; };
  let cAll = 0, cOn = 0, bAll = 0, bOn = 0;
  for (let y = 3; y < ih - 3; y++) for (let x = 3; x < iw - 3; x++) { const q = y * iw + x; if (Cm[q]) { cAll++; if (near(r => B[r], x, y)) cOn++; } if (B[q]) { bAll++; if (near(r => E[r] >= 0.25, x, y)) bOn++; } }
  return { dE: Math.round(se / n0 * 10) / 10, recall: cAll ? Math.round(cOn / cAll * 100) : 100, precision: bAll ? Math.round(bOn / bAll * 100) : 100, pieces: P.pieces.length };
};
