// IndexedDB 封装:在 service worker / 管理页之间共享会话数据。
// 库: bug-recorder(sessions / actions / requests / logs / pinia,actions 等以 bySession 索引)

import type { LogEntry, PiniaEvent, RecordedAction, RecorderSession, RequestEntry } from './types';

const DB_NAME = 'bug-recorder';
const DB_VERSION = 2;

export type StoreName = 'sessions' | 'actions' | 'requests' | 'logs' | 'pinia';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('actions')) {
        db.createObjectStore('actions', { keyPath: 'id', autoIncrement: true }).createIndex('bySession', 'sessionId');
      }
      if (!db.objectStoreNames.contains('requests')) {
        db.createObjectStore('requests', { keyPath: 'id', autoIncrement: true }).createIndex('bySession', 'sessionId');
      }
      if (!db.objectStoreNames.contains('logs')) {
        db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true }).createIndex('bySession', 'sessionId');
      }
      if (!db.objectStoreNames.contains('pinia')) {
        db.createObjectStore('pinia', { keyPath: 'id', autoIncrement: true }).createIndex('bySession', 'sessionId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function dbAdd<T>(store: StoreName, value: T): Promise<number> {
  return openDb().then(
    (db) =>
      new Promise<number>((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        const req = t.objectStore(store).add(value);
        t.oncomplete = () => resolve(req.result as number);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export function dbPut<T>(store: StoreName, value: T): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        t.objectStore(store).put(value);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export function dbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      })
  );
}

export function dbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        t.objectStore(store).delete(key);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export function dbListByIndex<T>(store: StoreName, indexName: string, key: IDBValidKey): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).index(indexName).getAll(key);
        req.onsuccess = () => resolve((req.result as T[]) || []);
        req.onerror = () => reject(req.error);
      })
  );
}

export function dbCountByIndex(store: StoreName, indexName: string, key: IDBValidKey): Promise<number> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).index(indexName).count(key);
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
      })
  );
}

export function dbAll<T>(store: StoreName): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve((req.result as T[]) || []);
        req.onerror = () => reject(req.error);
      })
  );
}

export async function getSessionEntity(id: string): Promise<RecorderSession | undefined> {
  return dbGet<RecorderSession>('sessions', id);
}
export async function getActionEntity(id: number): Promise<RecordedAction | undefined> {
  return dbGet<RecordedAction>('actions', id);
}
export async function listActionsBySession(sessionId: string): Promise<RecordedAction[]> {
  return dbListByIndex<RecordedAction>('actions', 'bySession', sessionId);
}
export type { LogEntry, PiniaEvent, RecordedAction, RecorderSession, RequestEntry };
