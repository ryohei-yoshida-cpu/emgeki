// 取り込んだ PDF の保管（IndexedDB）。PDF は大きいので localStorage ではなくこちらに置く
const DB_NAME = 'emgeki-files';
const STORE = 'pdfs';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(result instanceof IDBRequest ? result.result : result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

// rec: { id, name, pages, size, addedAt, scriptId, data: ArrayBuffer }
export const savePdf = (rec) => run('readwrite', (s) => s.put(rec));
export const getPdf = (id) => run('readonly', (s) => s.get(id));
export const deletePdf = (id) => run('readwrite', (s) => s.delete(id));

// 一覧（中身のデータは除く）
export async function listPdfs() {
  const all = await run('readonly', (s) => s.getAll());
  return (all || []).map(({ data, ...meta }) => meta).sort((a, b) => b.addedAt - a.addedAt);
}
