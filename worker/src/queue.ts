import { makeId } from './id';

export interface QueueItem {
  id: string;
  url: string;
  title: string;
  addedAt: number;
}

const KEY_PREFIX = 'queue:';
const TTL_SECONDS = 6 * 60 * 60;
const MAX_ITEMS = 50;

function key(id: string): string {
  return `${KEY_PREFIX}${id}`;
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
  await kv.put(key(item.id), JSON.stringify(item), {
    expirationTtl: TTL_SECONDS,
  });
  await trim(kv);
  return item;
}

export async function listItems(kv: KVNamespace): Promise<QueueItem[]> {
  const list = await kv.list({ prefix: KEY_PREFIX, limit: MAX_ITEMS + 10 });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const v = await kv.get(k.name, 'json');
      return v as QueueItem | null;
    }),
  );
  return items
    .filter((x): x is QueueItem => x !== null)
    .sort((a, b) => b.addedAt - a.addedAt);
}

export async function deleteItem(kv: KVNamespace, id: string): Promise<boolean> {
  const k = key(id);
  const existed = (await kv.get(k)) !== null;
  if (existed) await kv.delete(k);
  return existed;
}

async function trim(kv: KVNamespace): Promise<void> {
  const items = await listItems(kv);
  if (items.length <= MAX_ITEMS) return;
  const excess = items.slice(MAX_ITEMS);
  await Promise.all(excess.map((it) => kv.delete(key(it.id))));
}
