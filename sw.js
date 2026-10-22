/* Scan Lab service worker — versioned offline shell. */
const CACHE = 'scan-lab-v3';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.json', 'db.js', 'ai.js', 'glass.js', 'pdf.js', 'glass-ui.js', 'measure.js', 'measure3d.js', 'docs.js', 'voice.js', 'vendor/palettes.js', 'color.js', 'count.js', 'defect.js', 'compare.js', 'app.js',
  'vendor/three-bundle.js', 'vendor/draco/draco_decoder.js', 'vendor/draco/draco_decoder.wasm', 'vendor/draco/draco_wasm_wrapper.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('scan-lab-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith(new URL('./', location.href).pathname)) return; // API calls and other apps pass straight through
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => { if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(CACHE).then(cc => cc.put(e.request, c)); } return r; }).catch(() => e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
