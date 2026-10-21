/* Scan Lab — 3D viewer & model tools (three.js, vendored, works offline). Units inside the scene: millimetres. */
import * as THREE from './vendor/three-bundle.js';
const { OrbitControls, GLTFExporter, GLTFLoader, DRACOLoader, MeshoptDecoder, OBJLoader, STLLoader, PLYLoader, USDLoader, mergeVertices } = THREE;
const UNIT_MM = { mm: 1, cm: 10, m: 1000, in: 25.4 };
const fmtLen = mm => `${(mm / 25.4).toFixed(mm < 254 ? 2 : 1)} in · ${(mm / 10).toFixed(1)} cm`;

function labelSprite(text, size) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 44; g.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 28; c.width = w; c.height = fs + 22;
  g.font = `600 ${fs}px -apple-system, system-ui, sans-serif`; g.fillStyle = 'rgba(10,12,16,.85)'; g.beginPath(); g.roundRect ? g.roundRect(0, 0, w, c.height, 14) : g.rect(0, 0, w, c.height); g.fill();
  g.fillStyle = '#6ff0c4'; g.textBaseline = 'middle'; g.fillText(text, 14, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.renderOrder = 10;
  s.scale.set(size * w / c.height, size, 1); return s;
}
function triStats(root) { // surface area, signed volume, watertight (closed 2-manifold) across all meshes, in world mm
  let area = 0, vol = 0, closed = true, tris = 0; root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    let g = new THREE.BufferGeometry(); g.setAttribute('position', o.geometry.attributes.position.clone()); if (o.geometry.index) g.setIndex(o.geometry.index.clone());
    g.applyMatrix4(o.matrixWorld); g = mergeVertices(g, 1e-4 * Math.max(1, g.boundingSphere ? g.boundingSphere.radius : 1));
    const p = g.attributes.position, idx = g.index ? g.index.array : [...Array(p.count).keys()], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), edges = new Map();
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const i0 = idx[i], i1 = idx[i + 1], i2 = idx[i + 2]; a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
      area += new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2; vol += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6; tris++;
      for (const [u, v] of [[i0, i1], [i1, i2], [i2, i0]]) { const k = u < v ? u + '_' + v : v + '_' + u; edges.set(k, (edges.get(k) || 0) + 1); }
    }
    for (const n of edges.values()) if (n !== 2) { closed = false; break; }
  });
  return { area, volume: Math.abs(vol), watertight: closed && tris > 3, tris };
}

export function createViewer(host, { onPick } = {}) {
  const W = () => host.clientWidth || 320, H = () => Math.round(W() * 0.85);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setSize(W(), H());
  renderer.outputColorSpace = THREE.SRGBColorSpace; host.appendChild(renderer.domElement); renderer.domElement.style.cssText = 'width:100%;height:auto;display:block;border-radius:12px;touch-action:none';
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x15171c);
  const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.1, 1e7);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 2.2)); const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(1, 2, 1.5); scene.add(dl);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.12;
  const model = new THREE.Group(), dims = new THREE.Group(), picks = new THREE.Group(); scene.add(model, dims, picks);
  let wire = false, raf = 0, alive = true, pickOn = false, pickPts = [];
  const loop = () => { if (!alive) return; controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); }; loop();
  const ro = new ResizeObserver(() => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); }); ro.observe(host);
  const clear = g => { while (g.children.length) { const c = g.children.pop(); c.traverse(o => { o.geometry && o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => { m.map && m.map.dispose(); m.dispose(); }); }); } };
  const bbox = () => new THREE.Box3().setFromObject(model);
  function fit() { const b = bbox(); if (b.isEmpty()) return; const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3()), r = s.length() / 2 || 1; controls.target.copy(c); camera.position.set(c.x + r * 1.6, c.y + r * 1.1, c.z + r * 2.0); camera.near = r / 100; camera.far = r * 100; camera.updateProjectionMatrix(); controls.update(); }
  function drawDims() {
    clear(dims); const b = bbox(); if (b.isEmpty()) return; const s = b.getSize(new THREE.Vector3()), mx = Math.max(s.x, s.y, s.z), off = mx * 0.08, tick = mx * 0.03, lab = mx * 0.07;
    const mat = new THREE.LineBasicMaterial({ color: 0x6ff0c4, depthTest: false }), seg = (a, c) => { const g = new THREE.BufferGeometry().setFromPoints([a, c]); const l = new THREE.Line(g, mat); l.renderOrder = 9; dims.add(l); };
    const dimLine = (a, c, tdir, text) => { seg(a, c); seg(a.clone().addScaledVector(tdir, -tick), a.clone().addScaledVector(tdir, tick)); seg(c.clone().addScaledVector(tdir, -tick), c.clone().addScaledVector(tdir, tick)); const sp = labelSprite(text, lab); sp.position.copy(a.clone().add(c).multiplyScalar(0.5)).addScaledVector(tdir, lab * 0.9); dims.add(sp); };
    const { min: m, max: M } = b;
    dimLine(new THREE.Vector3(m.x, m.y, M.z + off), new THREE.Vector3(M.x, m.y, M.z + off), new THREE.Vector3(0, -1, 0), 'L ' + fmtLen(s.x));
    dimLine(new THREE.Vector3(M.x + off, m.y, M.z), new THREE.Vector3(M.x + off, M.y, M.z), new THREE.Vector3(1, 0, 0), 'H ' + fmtLen(s.y));
    dimLine(new THREE.Vector3(M.x + off, m.y, m.z), new THREE.Vector3(M.x + off, m.y, M.z), new THREE.Vector3(1, -0.4, 0).normalize(), 'W ' + fmtLen(s.z));
    const bh = new THREE.Box3Helper(b, 0x3a6b5c); bh.material.depthTest = false; bh.material.transparent = true; bh.material.opacity = 0.5; dims.add(bh);
  }
  const texOf = (url, rot) => { if (!url) return null; const t = new THREE.TextureLoader().load(url); t.colorSpace = THREE.SRGBColorSpace; return t; };
  function setShape({ shape = 'box', L = 100, W: Wd = 60, H: Ht = 40, textures = {} }) {
    clear(model); clear(picks); pickPts = [];
    const m = t => new THREE.MeshStandardMaterial({ color: t ? 0xffffff : 0x8fb7c9, map: t, roughness: 0.75, metalness: 0.05, wireframe: wire });
    const f = texOf(textures.front), sd = texOf(textures.side), tp = texOf(textures.top); let mesh;
    if (shape === 'cylinder') { const r = (L + Wd) / 4; mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Ht, 64), [m(f), m(tp), m(tp)]); }
    else if (shape === 'sphere') { const d = (L + Wd + Ht) / 3; mesh = new THREE.Mesh(new THREE.SphereGeometry(d / 2, 64, 40), m(f)); }
    else mesh = new THREE.Mesh(new THREE.BoxGeometry(L, Ht, Wd), [m(sd), m(sd), m(tp), m(null), m(f), m(f)]);
    mesh.position.y = 0; model.add(mesh); drawDims(); fit();
  }
  function setObject(obj, mmPerUnit = 1) {
    clear(model); clear(picks); pickPts = []; const g = new THREE.Group(); g.add(obj); g.scale.setScalar(mmPerUnit); model.add(g);
    obj.traverse(o => { if (o.isMesh && o.material) [].concat(o.material).forEach(mt => { mt.side = THREE.DoubleSide; }); });
    const b = new THREE.Box3().setFromObject(model), c = b.getCenter(new THREE.Vector3()); g.position.sub(c); drawDims(); fit();
  }
  function rescale(k) { const g = model.children[0]; if (!g) return; g.scale.multiplyScalar(k); g.position.multiplyScalar(k); pickPts = pickPts.map(p => p.multiplyScalar(k)); redrawPicks(); drawDims(); fit(); }
  function setWire(v) { wire = v; model.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(mt => { mt.wireframe = v; }); }); }
  function redrawPicks() { clear(picks); const s = bbox().getSize(new THREE.Vector3()), r = Math.max(s.x, s.y, s.z) * 0.012; for (const p of pickPts) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff9a5a, depthTest: false })); m.renderOrder = 11; m.position.copy(p); picks.add(m); } if (pickPts.length === 2) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pickPts), new THREE.LineBasicMaterial({ color: 0xff9a5a, depthTest: false })); l.renderOrder = 11; picks.add(l); const sp = labelSprite(fmtLen(pickPts[0].distanceTo(pickPts[1])), Math.max(s.x, s.y, s.z) * 0.06); sp.position.copy(pickPts[0].clone().add(pickPts[1]).multiplyScalar(0.5)); picks.add(sp); } }
  let down = null; const ray = new THREE.Raycaster();
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!pickOn || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return; const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera); ray.params.Points = { threshold: bbox().getSize(new THREE.Vector3()).length() * 0.01 };
    const hit = ray.intersectObjects(model.children, true)[0]; if (!hit) return; pickAt(hit.point);
  });
  function pickAt(p) { if (pickPts.length >= 2) pickPts = []; pickPts.push(p.clone()); redrawPicks(); onPick && onPick(pickPts.length, pickPts.length === 2 ? pickPts[0].distanceTo(pickPts[1]) : 0); }
  function size() { const s = bbox().getSize(new THREE.Vector3()); return { L: s.x, H: s.y, W: s.z }; }
  function exportOBJ() { let out = '# Scan Lab approximate model, units: millimetres\n', base = 1; model.updateMatrixWorld(true); model.traverse(o => { if (!o.isMesh) return; const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, p = g.attributes.position, v = new THREE.Vector3(); out += `o part${base}\n`; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); out += `v ${v.x.toFixed(3)} ${v.y.toFixed(3)} ${v.z.toFixed(3)}\n`; } for (let i = 0; i < p.count; i += 3) out += `f ${base + i} ${base + i + 1} ${base + i + 2}\n`; base += p.count; }); return out; }
  function exportSTL() { const tris = []; model.updateMatrixWorld(true); model.traverse(o => { if (!o.isMesh) return; const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, p = g.attributes.position; for (let i = 0; i + 2 < p.count; i += 3) tris.push([0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, i + k).applyMatrix4(o.matrixWorld))); });
    const buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf); const hdr = 'Scan Lab approximate model (mm)'; for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i)); dv.setUint32(80, tris.length, true);
    tris.forEach((t, i) => { const o = 84 + i * 50, n = new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).normalize(); [n, ...t].forEach((v, j) => { dv.setFloat32(o + j * 12, v.x, true); dv.setFloat32(o + j * 12 + 4, v.y, true); dv.setFloat32(o + j * 12 + 8, v.z, true); }); dv.setUint16(o + 48, 0, true); }); return new Uint8Array(buf); }
  function exportGLB() { return new Promise((res, rej) => { const g = model.clone(true); g.scale.multiplyScalar(0.001); /* glTF is metres */ new GLTFExporter().parse(g, r => res(new Uint8Array(r)), rej, { binary: true }); }); }
  function png() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); }
  function jpeg() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.9); }
  function view(dir) { const b = bbox(), c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() * 1.4; const d = { front: [0, 0, 1], side: [1, 0, 0], top: [0, 1, 0.0001], iso: [1, 0.7, 1.25] }[dir] || [1, 0.7, 1.25]; camera.position.copy(c).add(new THREE.Vector3(...d).normalize().multiplyScalar(r)); controls.target.copy(c); controls.update(); }
  function dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); clear(model); clear(dims); clear(picks); renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); renderer.domElement.remove(); }
  return { setShape, setObject, rescale, setWire, size, stats: () => triStats(model), setPick: v => { pickOn = v; if (!v) { pickPts = []; redrawPicks(); } }, pickAt, exportOBJ, exportSTL, exportGLB, png, jpeg, view, dispose, THREE };
}

export async function loadModelFile(file, unit = 'mm') {
  const name = (file.name || '').toLowerCase(), ext = name.split('.').pop(), buf = await file.arrayBuffer();
  if (ext === 'glb' || ext === 'gltf') {
    const l = new GLTFLoader(); const d = new DRACOLoader(); d.setDecoderPath(new URL('vendor/draco/', location.href).href); l.setDRACOLoader(d); l.setMeshoptDecoder(MeshoptDecoder);
    const g = await new Promise((res, rej) => l.parse(ext === 'gltf' ? new TextDecoder().decode(buf) : buf, '', res, e => rej(new Error(ext === 'gltf' && /buffer|uri|load/i.test(String(e && e.message)) ? 'This .gltf points to separate files. Export a single .glb instead.' : 'Couldn’t read this glTF/GLB: ' + (e && e.message || e)))));
    return { object: g.scene, mmPerUnit: 1000, unitsKnown: true, format: 'GLB/glTF (metres)' };
  }
  const mm = UNIT_MM[unit] || 1;
  if (ext === 'obj') return { object: new OBJLoader().parse(new TextDecoder().decode(buf)), mmPerUnit: mm, unitsKnown: false, format: 'OBJ' };
  if (ext === 'stl') { const g = new STLLoader().parse(buf); g.computeVertexNormals(); return { object: new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9cc2d3, roughness: 0.7 })), mmPerUnit: mm, unitsKnown: false, format: 'STL' }; }
  if (ext === 'ply') { const g = new PLYLoader().parse(buf); const col = !!g.attributes.color; if (g.index || g.attributes.position.count % 3 === 0 && !col && false) {} if (g.index) { g.computeVertexNormals(); return { object: new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col ? 0xffffff : 0x9cc2d3, vertexColors: col })), mmPerUnit: mm, unitsKnown: false, format: 'PLY' }; } return { object: new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: col, color: col ? 0xffffff : 0x9cc2d3 })), mmPerUnit: mm, unitsKnown: false, format: 'PLY point cloud', points: true }; }
  if (ext === 'usdz' || ext === 'usda' || ext === 'usdc' || ext === 'usd') {
    try { const o = new USDLoader().parse(buf); let n = 0; o.traverse(x => { if (x.isMesh) n++; }); if (!n) throw new Error('no meshes'); return { object: o, mmPerUnit: 1000, unitsKnown: true, format: 'USDZ (metres, experimental)' }; }
    catch (e) { throw new Error('This USDZ couldn’t be read in the browser (' + (e.message || e) + '). In your scanner app, export as GLB (best) or OBJ, then open that file.'); }
  }
  throw new Error('Unsupported file type .' + ext + ' — use GLB, glTF, OBJ, STL, PLY or USDZ.');
}
export { UNIT_MM, fmtLen, triStats };
