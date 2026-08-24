import type { YtDlp } from './ytdlp';
import { parseDashIndex, type DashIndex } from './dash-sidx';
import { logger } from '../log';

// Resolves a YouTube video into its separate DASH video+audio streams (H.264 +
// AAC), each with a parsed sidx (time→byte map). Cached per video so seeks reuse
// the URLs + index instead of re-extracting. Returns null when the video has no
// separate avc DASH (e.g. only a muxed progressive file) — the caller falls back.

const VIDEO_SEL = 'bv*[vcodec^=avc1][height<=1080]';
const AUDIO_SEL = 'ba[ext=m4a]';
const CACHE_TTL_MS = 5 * 60_000;       // googlevideo URLs last ~6h; refresh well within that
const CACHE_MAX = 40;
// ftyp+moov+sidx live near the front: the sidx ends within ~3.4KB even on a
// 23-minute video, and grows only ~2.4 bytes per second of media (12 bytes per
// segment reference), so this covers ~60 hours. Kept deliberately small because
// googlevideo serves only a prefix of each stream over plain byte ranges — an
// oversized init request is refused outright (403) rather than truncated.
const INIT_FETCH_BYTES = 512_000;

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export interface DashStream {
  url: string;
  index: DashIndex;
  /** The init segment bytes (ftyp+moov+sidx), prepended to any seeked segment. */
  initBytes: Uint8Array;
}
export interface DashSources { video: DashStream; audio: DashStream; at: number }

export interface YtDash {
  /**
   * Resolve video+audio DASH streams, or null if the video isn't separate-avc
   * DASH. Pass `{ forceRefresh: true }` to bypass (and replace) the cache — used
   * when googlevideo poisons a URL with a 403 and we need fresh signed URLs.
   */
  resolve(videoId: string, opts?: { forceRefresh?: boolean }): Promise<DashSources | null>;
  clearCache(): void;
}

export interface MakeYtDashOpts {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function makeYtDash(yt: YtDlp, opts: MakeYtDashOpts = {}): YtDash {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, DashSources>();

  async function fetchStream(url: string): Promise<DashStream> {
    const res = await doFetch(url, { headers: { Range: `bytes=0-${INIT_FETCH_BYTES}` } });
    // googlevideo rejects a signed URL with an empty 403 body often enough that
    // this must be checked: parsing that body as an init segment reports a
    // bogus "no sidx box found" and hides the real (transient, retryable) cause.
    if (!res.ok) throw new Error(`init fetch ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const index = parseDashIndex(buf);
    return { url, index, initBytes: buf.slice(0, index.initEnd) };
  }

  return {
    clearCache() { cache.clear(); },
    async resolve(videoId, opts) {
      if (opts?.forceRefresh) {
        cache.delete(videoId);
      } else {
        const hit = cache.get(videoId);
        if (hit && now() - hit.at < CACHE_TTL_MS) return hit;
      }

      // Two attempts: a signed URL can come back already poisoned (403), and a
      // fresh extraction usually hands back one that works. If both attempts
      // fail we return null like any other non-DASH video, so the caller falls
      // back to the progressive file rather than failing the request outright.
      for (let attempt = 0; attempt < 2; attempt++) {
        const out = await yt.text(['-f', `${VIDEO_SEL}+${AUDIO_SEL}`, '-g', watchUrl(videoId)]).catch(() => '');
        const urls = out.split('\n').map((s) => s.trim()).filter(Boolean);
        if (urls.length < 2 || !urls[0] || !urls[1]) return null; // no separate avc DASH

        let video: DashStream;
        let audio: DashStream;
        try {
          [video, audio] = await Promise.all([fetchStream(urls[0]), fetchStream(urls[1])]);
        } catch (err) {
          logger.warn({ videoId, attempt, err: (err as Error).message }, 'yt-dash init fetch failed');
          continue;
        }

        const sources: DashSources = { video, audio, at: now() };
        cache.set(videoId, sources);
        if (cache.size > CACHE_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        return sources;
      }
      logger.warn({ videoId }, 'yt-dash unavailable, falling back to progressive');
      return null;
    },
  };
}
