import type { StoredSource } from '../storage';

export const SOURCE_TYPE_COLOR: Record<StoredSource['type'], string> = {
  plex: '#e5a00d',
  jellyfin: '#aa5cc3',
  flixify: '#cc3333',
  generic: '#6b7280',
  youtube: '#ff0000',
};

/**
 * 1-2 character glyph derived from a source's label, for color-coded badges.
 * Examples: "My Plex" → "MP", "Blackhawk" → "BL", "Plex" → "PL".
 * The badge color (from SOURCE_TYPE_COLOR) still conveys the type; the glyph
 * differentiates instances of the same type.
 */
export function sourceGlyph(label: string, maxChars: 1 | 2 = 2): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  if (maxChars === 1) {
    const c = (words[0] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return c.charAt(0) || '·';
  }
  if (words.length === 1) {
    const w = words[0]!.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return w.slice(0, 2) || '·';
  }
  const first = (words[0] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 1);
  const second = (words[1] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 1);
  return (first + second) || '·';
}
