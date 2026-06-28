export function stripPin(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function formatPin(stripped: string): string {
  if (stripped.length <= 3) return stripped;
  return `${stripped.slice(0, 3)}-${stripped.slice(3)}`;
}
