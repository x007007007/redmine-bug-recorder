// IndexedDB 封装:在 service worker / 管理页之间共享会话数据。
// 库: bug-recorder
//   sessions  keyPath: id        会话元数据
//   actions   keyPath: id(auto)  UI 操作步骤(含截图 dataURL / Vue 信息),索引 bySession
//   requests  keyPath: id(auto)  API 请求记录,索引 bySession
//   logs      keyPath: id(auto)  Console 日志,索引 bySession
//   pinia     keyPath: id(auto)  Pinia 变更流($subscribe / $onAction),索引 bySession

const DB_NAME = 'bug-recorder';
const DB_VERSION = 2;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('actions')) {
        db.createObjectStore('actions', { keyPath: 'id', autoIncrement: true })
          .createIndex('bySession', 'sessionId');
      }
      if (!db.objectStoreNames.contains('requests')) {
        db.createObjectStore('requests', { keyPath: 'id', autoIncrement: true })
          .createIndex('bySession', 'sessionId');
      }
      if (!db.objectStoreNames.contains('logs')) {
        db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true })
          .createIndex('bySession', 'sessionId');
      }
      if (!db.objectStoreNames.contains('pinia')) {
        db.createObjectStore('pinia', { keyPath: 'id', autoIncrement: true })
          .createIndex('bySession', 'sessionId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const out = fn(s);
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export function dbAdd(store, value) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        const req = t.objectStore(store).add(value);
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export function dbPut(store, value) {
  return tx(store, 'readwrite', (s) => s.put(value));
}

export function dbGet(store, key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export function dbDelete(store, key) {
  return tx(store, 'readwrite', (s) => s.delete(key));
}

export function dbListByIndex(store, indexName, key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db
          .transaction(store, 'readonly')
          .objectStore(store)
          .index(indexName)
          .getAll(key);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      })
  );
}

export function dbCountByIndex(store, indexName, key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db
          .transaction(store, 'readonly')
          .objectStore(store)
          .index(indexName)
          .count(key);
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
      })
  );
}

export function dbAll(store) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      })
  );
}

// 删除一个会话的全部数据(步骤 / 请求 / 日志 / Pinia 流 + 会话本身)
export async function clearSessionData(sessionId) {
  for (const store of ['actions', 'requests', 'logs', 'pinia']) {
    const items = await dbListByIndex(store, 'bySession', sessionId);
    for (const item of items) {
      await dbDelete(store, item.id);
    }
  }
  await dbDelete('sessions', sessionId);
}
