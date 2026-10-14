export interface Rec { id: number; date: string; transcript: string; memo: string }
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('jinryo-memo', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('h', { keyPath: 'id' })
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
})
const tx = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
  const d = await open()
  return new Promise((res, rej) => { const q = f(d.transaction('h', mode).objectStore('h')); q.onsuccess = () => res(q.result as T); q.onerror = () => rej(q.error) })
}
export const saveRec = (r: Rec) => tx('readwrite', s => s.put(r))
export const delRec = (id: number) => tx('readwrite', s => s.delete(id))
export const allRecs = async () => (await tx<Rec[]>('readonly', s => s.getAll())).sort((a, b) => b.id - a.id)
