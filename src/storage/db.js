/**
 * Thin promise wrapper over IndexedDB. Two stores:
 *   projects — one record per editable project (document + blobs)
 *   meta     — key/value for session pointers and preferences
 */
const DB_NAME = 'folio';
const DB_VERSION = 1;
export const STORE_PROJECTS = 'projects';
export const STORE_META = 'meta';

let dbPromise = null;

export function isSupported() {
  return typeof indexedDB !== 'undefined';
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!isSupported()) {
      reject(new Error('IndexedDB no está disponible en este navegador'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la base local'));
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    tx.onabort = () => reject(tx.error ?? new Error('Transacción cancelada'));
    tx.onerror = () => reject(tx.error ?? new Error('Error de almacenamiento'));
  }));
}

export const dbGet = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const dbPut = (store, value) => run(store, 'readwrite', (s) => s.put(value));
export const dbDelete = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const dbGetAll = (store) => run(store, 'readonly', (s) => s.getAll());

export async function metaGet(key, fallback = null) {
  try {
    const record = await dbGet(STORE_META, key);
    return record ? record.value : fallback;
  } catch {
    return fallback;
  }
}

export async function metaSet(key, value) {
  return dbPut(STORE_META, { key, value });
}

/** Best-effort quota report, used to warn before autosave starts failing. */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, ratio: quota ? usage / quota : 0 };
  } catch {
    return null;
  }
}

export function isQuotaError(error) {
  return Boolean(error) && (
    error.name === 'QuotaExceededError'
    || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || /quota|space/i.test(error.message ?? '')
  );
}
