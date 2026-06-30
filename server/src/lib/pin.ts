const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PIN_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}$/;

export function generatePin(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}

export function isPinShape(s: string): boolean {
  return PIN_RE.test(s);
}

export function pinKvKey(pin: string): string {
  return `pair:${pin.replace('-', '')}`;
}
