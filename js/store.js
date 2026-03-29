// store.js — IndexedDB persistence
// v2 adds the 'templates' object store

const DB_NAME    = 'ges_omr';
const DB_VERSION = 2;
const STORE_EXAMS     = 'exams';
const STORE_TEMPLATES = 'templates';
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const d = e.target.result;
      const oldVersion = e.oldVersion;

      // v1 — exams store
      if (oldVersion < 1) {
        const es = d.createObjectStore(STORE_EXAMS, { keyPath: 'id' });
        es.createIndex('name', 'name', { unique: true });
      }

      // v2 — templates store
      if (oldVersion < 2) {
        const ts = d.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
        ts.createIndex('isGlobal', 'isGlobal', { unique: false });
      }
    };

    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = () => reject(req.error);
  });
}

function ensureDB() {
  if (db) return Promise.resolve(db);
  return openDB();
}

// ── Exams ─────────────────────────────────────────────────────────

function dbGet(id) {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE_EXAMS, 'readonly').objectStore(STORE_EXAMS).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function dbGetByName(name) {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE_EXAMS, 'readonly')
                 .objectStore(STORE_EXAMS).index('name').get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function dbPut(exam) {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE_EXAMS, 'readwrite').objectStore(STORE_EXAMS).put(exam);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function dbDelete(id) {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE_EXAMS, 'readwrite').objectStore(STORE_EXAMS).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  }));
}

function dbGetAll() {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE_EXAMS, 'readonly').objectStore(STORE_EXAMS).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

// ── Templates ─────────────────────────────────────────────────────

function dbPutTemplate(template) {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE_TEMPLATES, 'readwrite')
                 .objectStore(STORE_TEMPLATES).put(template);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function dbGetTemplate(id) {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE_TEMPLATES, 'readonly')
                 .objectStore(STORE_TEMPLATES).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function dbDeleteTemplate(id) {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE_TEMPLATES, 'readwrite')
                 .objectStore(STORE_TEMPLATES).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  }));
}

function dbGetAllTemplates() {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE_TEMPLATES, 'readonly')
                 .objectStore(STORE_TEMPLATES).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}