/**
 * UUID v4 generator with graceful degradation across secure and non-secure
 * contexts. `crypto.randomUUID` is a secure-context-only API — a phone
 * loading canvas over http:// (LAN access without a tunnel, or a
 * misconfigured deployment) will crash with "randomUUID is not a function"
 * if used unguarded. `crypto.getRandomValues` is broadly available on both
 * http and https origins. Math.random is the last-resort fallback for
 * environments without a `crypto` global at all.
 *
 * The Plex client identifier and telemetry session ID don't need
 * cryptographic strength — just stable per-install / per-session uniqueness.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;  // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;  // variant 10x
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  // Math.random fallback. Non-cryptographic but sufficient for a stable id.
  const r = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${r()}${r()}-${r()}-4${r().slice(1)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${r().slice(1)}-${r()}${r()}${r()}`;
}
