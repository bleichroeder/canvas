const IP_LITERAL_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const PLEX_DIRECT_RE = /^(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.[^.]+\.plex\.direct$/i;

function rangeMatches(a: number, b: number, c: number): boolean {
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  // c, d unused — RFC1918 ranges are determined by a and b.
  void c;
  return false;
}

function parseOctets(s: string): [number, number, number, number] | null {
  const m = IP_LITERAL_RE.exec(s);
  if (!m) return null;
  const a = Number(m[1]); const b = Number(m[2]);
  const c = Number(m[3]); const d = Number(m[4]);
  if ([a, b, c, d].some((n) => n < 0 || n > 255)) return null;
  return [a, b, c, d];
}

export function isRfc1918Host(host: string): boolean {
  if (!host) return false;
  // 1. Bare IP literal
  const direct = parseOctets(host);
  if (direct) {
    return rangeMatches(direct[0], direct[1], direct[2]);
  }
  // 2. plex.direct subdomain encoding
  const plex = PLEX_DIRECT_RE.exec(host);
  if (plex) {
    const a = Number(plex[1]); const b = Number(plex[2]);
    const c = Number(plex[3]); const d = Number(plex[4]);
    if ([a, b, c, d].some((n) => n < 0 || n > 255)) return false;
    return rangeMatches(a, b, c);
  }
  return false;
}
