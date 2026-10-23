/* Scan Lab — runs the Stained Glass photo tracer off the main thread so the screen stays responsive on iPhone. */
importScripts('tracer.js');
self.onmessage = e => { const { id, img, o, env } = e.data; try { const P = self.PhotoTracer.trace(img, o, env); self.postMessage({ id, P }); } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); } };
