import { makeId } from './id';

export interface QueueItem {
  id: string;
  url: string;
  title: string;
  addedAt: number;
}

const BLOB_KEY = 'queue:items';
const MAX_ITEMS = 50;

async function readBlob(kv: KVNamespace): Promise<QueueItem[]> {
  const v = await kv.get(BLOB_KEY, 'json');
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is QueueItem =>
      x !== null &&
      typeof x === 'object' &&
      typeof (x as QueueItem).id === 'string' &&
      typeof (x as QueueItem).url === 'string',
  );
}

async function writeBlob(kv: KVNamespace, items: QueueItem[]): Promise<void> {
  await kv.put(BLOB_KEY, JSON.stringify(items));
}

export async function addItem(
  kv: KVNamespace,
  url: string,
  title: string,
): Promise<QueueItem> {
  const item: QueueItem = {
    id: makeId(),
    url,
    title,
    addedAt: Date.now(),
  };
  const items = await readBlob(kv);
  const next = [item, ...items].slice(0, MAX_ITEMS);
  await writeBlob(kv, next);
  return item;
}

export async function listItems(kv: KVNamespace): Promise<QueueItem[]> {
  const items = await readBlob(kv);
  return items.sort((a, b) => b.addedAt - a.addedAt);
}

export async function deleteItem(kv: KVNamespace, id: string): Promise<boolean> {
  const items = await readBlob(kv);
  const next = items.filter((it) => it.id !== id);
  if (next.length === items.length) return false;
  await writeBlob(kv, next);
  return true;
}
