/* Outline-kept metric for any pattern P on the same panel image: share of the photo's main subject contours (detected with the
   v3 contour detector) that lie within 2 px of a lead line. Runs in the page. */
window.__outlineKept = function (P, img) {
  const iw = img.width, ih = img.height, n0 = iw * ih, F = new Float32Array(n0 * 3); for (let i = 0; i < n0; i++) { F[i * 3] = img.data[i * 4]; F[i * 3 + 1] = img.data[i * 4 + 1]; F[i * 3 + 2] = img.data[i * 4 + 2]; }
  const A = bilateral(toLab(F, n0), iw, ih, 2, 12, 2), E = sobelEdges(A, iw, ih), Cm = contourMap(A, E, iw, ih), sm = subjectMask(F, A, E, iw, ih, {}, []);
  const c = document.createElement('canvas'); c.width = P.gridW; c.height = P.gridH; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false;
  P.pieces.forEach((p, i) => { const id = i + 1; g.fillStyle = `rgb(${id & 255},${(id >> 8) & 255},0)`; g.fill(new Path2D(p.segs.map(segsToD).join('')), 'evenodd'); });
  const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, f = Math.round((P.gridW - iw) / 2), lab = q => d[q * 4] + 256 * d[q * 4 + 1];
  let on = 0, all = 0;
  for (let y = 2; y < ih - 2; y++) for (let x = 2; x < iw - 2; x++) { const q = y * iw + x; if (!Cm[q] || !sm.mask[q]) continue; all++; const gq = (y + f) * W + x + f, r = lab(gq); let hit = false; for (let j = -2; j <= 2 && !hit; j++) for (let i = -2; i <= 2; i++) if (lab(gq + j * W + i) !== r) { hit = true; break; } if (hit) on++; }
  return all ? Math.round(on / all * 100) : 100;
};
