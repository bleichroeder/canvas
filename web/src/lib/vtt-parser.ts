export interface Cue {
  startSec: number;
  endSec: number;
  text: string;
}

function parseTimestamp(s: string): number {
  // Accepts "HH:MM:SS.mmm" or "MM:SS.mmm".
  const trimmed = s.trim();
  const parts = trimmed.split(':');
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const sec = Number(parts[2]);
    return h * 3600 + m * 60 + sec;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const sec = Number(parts[1]);
    return m * 60 + sec;
  }
  return Number(trimmed);
}

// Strip WebVTT inline tags (<v Name>, <c.classname>, <i>, etc.) leaving plain text.
function stripTags(s: string): string {
  return s.replace(/<\/?[^>]+>/g, '');
}

// Decode HTML entities. YouTube's VTT text is entity-encoded (&gt; &#39; &amp; …),
// so without this the raw entities show up literally in captions. Run AFTER
// stripTags so a decoded "<" can't be mistaken for a tag.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  // Normalize newlines, then split on blank lines.
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx < 0) continue;
    const timing = lines[timingIdx]!;
    const arrow = timing.indexOf('-->');
    if (arrow < 0) continue;
    const startStr = timing.slice(0, arrow).trim();
    // Strip optional cue-settings appended after the end timestamp.
    const endStr = timing.slice(arrow + 3).trim().split(/\s+/)[0] ?? '';
    const startSec = parseTimestamp(startStr);
    const endSec = parseTimestamp(endStr);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
    const textLines = lines.slice(timingIdx + 1).map((l) => decodeEntities(stripTags(l))).filter((l) => l.length > 0);
    if (textLines.length === 0) continue;
    cues.push({ startSec, endSec, text: textLines.join('\n') });
  }
  cues.sort((a, b) => a.startSec - b.startSec);
  return cues;
}

/**
 * Binary-search the cue active at posSec (inclusive). Returns null when no
 * cue is active — i.e. we're in a gap between cues or outside the range.
 */
export function findCue(cues: Cue[], posSec: number): Cue | null {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid]!;
    if (posSec < c.startSec) hi = mid - 1;
    else if (posSec >= c.endSec) lo = mid + 1;
    else return c;
  }
  return null;
}
