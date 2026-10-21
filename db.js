/* Scan Lab — tiny IndexedDB wrapper. Stores: scans (history incl. receipts/patterns/measurements), log (food log). */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('scanlab', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('scans')) d.createObjectStore('scans', { keyPath: 'id' }).createIndex('at', 'at');
      if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: 'id' }).createIndex('rec', 'rec');
      if (!d.objectStoreNames.contains('log')) d.createObjectStore('log', { keyPath: 'id' }).createIndex('date', 'date');
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode), s = t.objectStore(store); let out; const r = fn(s); if (r) r.onsuccess = () => { out = r.result; }; t.oncomplete = () => res(out); t.onerror = () => rej(t.error || new Error('Storage error')); t.onabort = () => rej(t.error || new Error('Storage aborted (device may be full)')); }); };
  return {
    put: (store, v) => tx(store, 'readwrite', s => s.put(v)),
    get: (store, k) => tx(store, 'readonly', s => s.get(k)),
    del: (store, k) => tx(store, 'readwrite', s => s.delete(k)),
    all: (store) => tx(store, 'readonly', s => s.getAll()),
    clear: (store) => tx(store, 'readwrite', s => s.clear()),
  };
})();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
