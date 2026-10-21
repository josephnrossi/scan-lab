/* Scan Lab — minimal dependency-free PDF writer (vector paths, Helvetica text, JPEG images). Uncompressed so it stays simple and inspectable. */
class PDFDoc {
  constructor() { this.pages = []; this.images = []; }
  page(w = 612, h = 792) { const p = new PDFPage(this, w, h); this.pages.push(p); return p; }
  addJPEG(dataURL) {
    const b64 = dataURL.split(',')[1], bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    let i = 2, w = 0, h = 0; while (i < u.length) { if (u[i] !== 0xFF) { i++; continue; } const m = u[i + 1], len = (u[i + 2] << 8) | u[i + 3]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { h = (u[i + 5] << 8) | u[i + 6]; w = (u[i + 7] << 8) | u[i + 8]; break; } i += 2 + len; }
    const img = { name: 'Im' + (this.images.length + 1), data: u, w, h }; this.images.push(img); return img;
  }
  output() {
    const enc = new TextEncoder(), chunks = [], offs = []; let len = 0;
    const push = x => { const b = typeof x === 'string' ? latin1(x) : x; chunks.push(b); len += b.length; };
    const objs = []; const obj = (body) => { objs.push(body); return objs.length; }; // returns object number (1-based)
    // reserve: 1 catalog, 2 pages, 3 font, 4 bold font
    objs.push(null, null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgNums = this.images.map(im => obj({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>`, bin: im.data }));
    const xo = this.images.length ? '/XObject << ' + this.images.map((im, i) => `/${im.name} ${imgNums[i]} 0 R`).join(' ') + ' >>' : '';
    const kids = [];
    for (const p of this.pages) {
      const s = p.ops.join('\n'); const cs = obj({ dict: `<< /Length ${latin1(s).length} >>`, bin: latin1(s) });
      kids.push(obj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xo} >> /Contents ${cs} 0 R >>`));
    }
    objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    objs.forEach((o, i) => { offs[i] = len; push(`${i + 1} 0 obj\n`); if (typeof o === 'string') push(o + '\n'); else { push(o.dict + '\nstream\n'); push(o.bin); push('\nendstream\n'); } push('endobj\n'); });
    const xref = len; push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
    push(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info << /Producer (Scan Lab) >> >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
  }
  blob() { return new Blob([this.output()], { type: 'application/pdf' }); }
}
const WIN = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80, '×': 0xD7, '°': 0xB0, '½': 0xBD, '¼': 0xBC, '¾': 0xBE, '″': 0x22, '′': 0x27, '≈': 0x7E, '·': 0xB7 };
function latin1(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); u[i] = c < 256 ? c : (WIN[s[i]] || 0x3F); } return u; }
const pdfStr = s => '(' + String(s).replace(/[\\()]/g, m => '\\' + m).replace(/[\r\n]+/g, ' ') + ')';
const f2 = n => (Math.round(n * 1000) / 1000).toString();
class PDFPage {
  constructor(doc, w, h) { this.doc = doc; this.w = w; this.h = h; this.ops = []; }
  op(s) { this.ops.push(s); return this; }
  fill(r, g, b) { return this.op(`${f2(r / 255)} ${f2(g / 255)} ${f2(b / 255)} rg`); }
  stroke(r, g, b) { return this.op(`${f2(r / 255)} ${f2(g / 255)} ${f2(b / 255)} RG`); }
  lw(w) { return this.op(f2(w) + ' w'); }
  rect(x, y, w, h, mode = 'S') { return this.op(`${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re ${mode}`); }
  line(x1, y1, x2, y2) { return this.op(`${f2(x1)} ${f2(y1)} m ${f2(x2)} ${f2(y2)} l S`); }
  /* top-left based text helper: y measured from page top */
  text(x, yTop, size, s, bold = false, rgb = [0, 0, 0]) { return this.op(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${f2(rgb[0] / 255)} ${f2(rgb[1] / 255)} ${f2(rgb[2] / 255)} rg 1 0 0 1 ${f2(x)} ${f2(this.h - yTop - size)} Tm ${pdfStr(s)} Tj ET`); }
  textAt(x, y, size, s, bold = false, rgb = [0, 0, 0]) { return this.op(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${f2(rgb[0] / 255)} ${f2(rgb[1] / 255)} ${f2(rgb[2] / 255)} rg 1 0 0 1 ${f2(x)} ${f2(y)} Tm ${pdfStr(s)} Tj ET`); }
  /* wraps text into width; returns new yTop */
  para(x, yTop, width, size, s, bold = false, rgb) { const words = String(s).split(/\s+/), max = Math.max(8, Math.floor(width / (size * 0.5))); let line = ''; for (const w of words) { if ((line + ' ' + w).trim().length > max) { this.text(x, yTop, size, line.trim(), bold, rgb); yTop += size * 1.3; line = w; } else line += ' ' + w; } if (line.trim()) { this.text(x, yTop, size, line.trim(), bold, rgb); yTop += size * 1.3; } return yTop; }
  image(img, x, y, w, h) { return this.op(`q ${f2(w)} 0 0 ${f2(h)} ${f2(x)} ${f2(y)} cm /${img.name} Do Q`); }
  /* segment path (M/L/Q/C/Z in user coords) */
  path(segs) { let cur = [0, 0]; const o = []; for (const s of segs) { if (s[0] === 'M') { o.push(`${f2(s[1])} ${f2(s[2])} m`); cur = [s[1], s[2]]; } else if (s[0] === 'L') { o.push(`${f2(s[1])} ${f2(s[2])} l`); cur = [s[1], s[2]]; } else if (s[0] === 'Q') { const [cx, cy, x, y] = s.slice(1); const c1x = cur[0] + 2 / 3 * (cx - cur[0]), c1y = cur[1] + 2 / 3 * (cy - cur[1]), c2x = x + 2 / 3 * (cx - x), c2y = y + 2 / 3 * (cy - y); o.push(`${f2(c1x)} ${f2(c1y)} ${f2(c2x)} ${f2(c2y)} ${f2(x)} ${f2(y)} c`); cur = [x, y]; } else if (s[0] === 'Z') o.push('h'); } return this.op(o.join(' ')); }
}
