const DB_NAME = 'ges_omr';
const DB_VERSION = 1;
const STORE = 'exams';
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const store = d.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: true });
      }
    };
    req.onsuccess = e => {
      db = e.target.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function ensureDB() {
  if (db) return Promise.resolve(db);
  return openDB();
}

function dbGet(id) {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  }));
}

function dbGetByName(name) {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).index('name').get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  }));
}

function dbPut(exam) {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readwrite').objectStore(STORE).put(exam);
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  }));
}

function dbDelete(id) {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror  = () => reject(req.error);
  }));
}

function dbGetAll() {
  return ensureDB().then(d => new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  }));
}