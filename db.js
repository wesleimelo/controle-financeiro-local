/* Armazenamento: IndexedDB (principal). Se o navegador bloquear, cai para localStorage e avisa. */
(function (root) {
  'use strict';
  const NAME = 'financas-pessoais', STORE = 'kv';
  let dbp = null;
  const DB = { degraded: false, persisted: null };

  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('sem indexedDB'));
        const r = indexedDB.open(NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error || new Error('erro ao abrir o banco'));
        r.onblocked = () => reject(new Error('banco bloqueado'));
      });
    }
    return dbp;
  }

  async function idbGet(key) {
    const db = await open();
    return new Promise((res, rej) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function idbSet(key, value) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('gravação cancelada'));
    });
  }

  DB.get = async function (key) {
    if (!DB.degraded) {
      try { return await idbGet(key); } catch (e) { DB.degraded = true; }
    }
    try { const t = localStorage.getItem('fin:' + key); return t ? JSON.parse(t) : undefined; } catch (e) { return undefined; }
  };
  DB.set = async function (key, value) {
    if (!DB.degraded) {
      try { return await idbSet(key, value); } catch (e) { DB.degraded = true; }
    }
    localStorage.setItem('fin:' + key, JSON.stringify(value));
  };

  // pede ao navegador para não apagar os dados quando faltar espaço
  DB.requestPersistence = async function () {
    try {
      if (navigator.storage && navigator.storage.persist) {
        DB.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
      }
    } catch (e) { /* sem suporte: segue sem */ }
    return DB.persisted;
  };

  root.DB = DB;
})(typeof self !== 'undefined' ? self : this);
