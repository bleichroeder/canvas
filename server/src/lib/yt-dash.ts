import type { YtDlp } from './ytdlp';
import { parseDashIndex, type DashIndex } from './dash-sidx';

// Resolves a YouTube video into its separate DASH video+audio streams (H.264 +
// AAC), each with a parsed sidx (time→byte map). Cached per video so seeks reuse
// the URLs + index instead of re-extracting. Returns null when the video has no
// separate avc DASH (e.g. only a muxed progressive file) — the caller falls back.

const VIDEO_SEL = 'bv*[vcodec^=avc1][height<=1080]';
const AUDIO_SEL = 'ba[ext=m4a]';
const CACHE_TTL_MS = 5 * 60_000;       // googlevideo URLs last ~6h; refresh well within that
const CACHE_MAX = 40;
const INIT_FETCH_BYTES = 2_000_000;    // ftyp+moov+sidx live near the front

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export interface DashStream {
  url: string;
  index: DashIndex;
  /** The init segment bytes (ftyp+moov+sidx), prepended to any seeked segment. */
  initBytes: Uint8Array;
}
export interface DashSources { video: DashStream; audio: DashStream; at: number }

export interface YtDash {
  /** Resolve video+audio DASH streams, or null if the video isn't separate-avc DASH. */
  resolve(videoId: string): Promise<DashSources | null>;
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
    const buf = new Uint8Array(await res.arrayBuffer());
    const index = parseDashIndex(buf);
    return { url, index, initBytes: buf.slice(0, index.initEnd) };
  }

  return {
    clearCache() { cache.clear(); },
    async resolve(videoId) {
      const hit = cache.get(videoId);
      if (hit && now() - hit.at < CACHE_TTL_MS) return hit;

      const out = await yt.text(['-f', `${VIDEO_SEL}+${AUDIO_SEL}`, '-g', watchUrl(videoId)]).catch(() => '');
      const urls = out.split('\n').map((s) => s.trim()).filter(Boolean);
      if (urls.length < 2 || !urls[0] || !urls[1]) return null; // no separate avc DASH

      const [video, audio] = await Promise.all([fetchStream(urls[0]), fetchStream(urls[1])]);
      const sources: DashSources = { video, audio, at: now() };
      cache.set(videoId, sources);
      if (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return sources;
    },
  };
}
