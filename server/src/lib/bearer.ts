const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RAW_LEN = 19;

export function generateBearer(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RAW_LEN));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}-${chars.slice(16, 19)}`;
}

export async function hashBearer(bearer: string): Promise<string> {
  const buf = new TextEncoder().encode(bearer);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
