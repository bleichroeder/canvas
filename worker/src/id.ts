// Time-prefixed random id. Newer ids sort after older ids lexicographically.
export function makeId(): string {
  const ts = Date.now().toString(36).padStart(8, '0');
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${ts}-${rand}`;
}
