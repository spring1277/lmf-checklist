/* Lightweight IndexedDB wrapper for storing checklist answers.
   Store key: `${year}|${field}|${code}` -> { year, field, code, answer, done, updatedAt } */
(function (global) {
  const DB_NAME = 'lmf-checklist';
  const STORE = 'answers';
  const VERSION = 1;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'key' });
          os.createIndex('byField', ['year', 'field'], { unique: false });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(mode) { return open().then((db) => db.transaction(STORE, mode).objectStore(STORE)); }
  const keyOf = (year, field, code) => `${year}|${field}|${code}`;

  const DB = {
    async get(year, field, code) {
      const store = await tx('readonly');
      return new Promise((res, rej) => {
        const r = store.get(keyOf(year, field, code));
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => rej(r.error);
      });
    },
    async put(rec) {
      rec.key = keyOf(rec.year, rec.field, rec.code);
      rec.updatedAt = Date.now();
      const store = await tx('readwrite');
      return new Promise((res, rej) => {
        const r = store.put(rec);
        r.onsuccess = () => res(rec);
        r.onerror = () => rej(r.error);
      });
    },
    /* all records for a given year (optionally field) */
    async byYear(year, field) {
      const store = await tx('readonly');
      return new Promise((res, rej) => {
        const out = [];
        const r = store.openCursor();
        r.onsuccess = (e) => {
          const c = e.target.result;
          if (c) {
            const v = c.value;
            if (v.year == year && (!field || v.field === field)) out.push(v);
            c.continue();
          } else res(out);
        };
        r.onerror = () => rej(r.error);
      });
    },
    async all() {
      const store = await tx('readonly');
      return new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => rej(r.error);
      });
    },
    async clearYear(year) {
      const recs = await this.byYear(year);
      const store = await tx('readwrite');
      await Promise.all(recs.map((v) => new Promise((res) => {
        const d = store.delete(v.key); d.onsuccess = res; d.onerror = res;
      })));
    },
    async importMany(records) {
      const store = await tx('readwrite');
      await Promise.all(records.map((rec) => new Promise((res) => {
        if (!rec.key) rec.key = keyOf(rec.year, rec.field, rec.code);
        const r = store.put(rec); r.onsuccess = res; r.onerror = res;
      })));
    },
  };

  global.DB = DB;
})(window);
