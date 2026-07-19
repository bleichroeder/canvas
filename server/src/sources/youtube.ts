import type {
  SourceAdapter, SourceContext, Item, ItemDetail, Episode,
  HomeRow, BrowseResult, BrowsePage, PlayResolution, SubtitleTrack,
} from './types';
import type { YtDlp } from '../lib/ytdlp';
import type { StreamSigner } from '../lib/yt-stream-sign';
import { BadRequestError } from '../errors';

// YouTube source adapter. Metadata comes from `yt-dlp -J` (no API key); the
// playable stream is a signed canvas-internal URL served by the yt-stream route
// (yt-dlp extract → ffmpeg mux). Public content only in v1 — no account auth.
//
// Constructed as a factory so tests inject a fake YtDlp + signer, and app.ts
// wires the real ones from config.

// ── Item id encoding ──────────────────────────────────────────────────────────
// YouTube has three navigable entity kinds; pack a prefix into the opaque
// canvas Item.id (colons never appear in YouTube video/playlist/channel ids).

export type YtKind = 'v' | 'p' | 'c';

export function encodeId(kind: YtKind, id: string): string {
  return `${kind}:${id}`;
}

export function decodeId(encoded: string): { kind: YtKind; id: string } {
  const i = encoded.indexOf(':');
  if (i < 0) return { kind: 'v', id: encoded }; // bare id = video
  const kind = encoded.slice(0, i);
  const id = encoded.slice(i + 1);
  if (kind === 'v' || kind === 'p' || kind === 'c') return { kind, id };
  return { kind: 'v', id: encoded };
}

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const playlistUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`;
const channelUrl = (id: string) =>
  id.startsWith('UC') ? `https://www.youtube.com/channel/${id}` : `https://www.youtube.com/${id}`;

// ── yt-dlp JSON shapes (only the fields we read) ───────────────────────────────

interface YtEntry {
  id?: string;
  title?: string;
  url?: string;
  duration?: number | null;
  channel?: string;
  uploader?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string }>;
  upload_date?: string; // YYYYMMDD
  ie_key?: string;      // 'Youtube' (video) | 'YoutubeTab' (channel/playlist)
  description?: string;
}

type CaptionMap = Record<string, Array<{ ext?: string; url?: string; name?: string }>>;

interface YtInfo extends YtEntry {
  entries?: YtEntry[];
  subtitles?: CaptionMap;
  automatic_captions?: CaptionMap;
}

// ── Mapping helpers ────────────────────────────────────────────────────────────

function pickThumb(e: YtEntry): string | undefined {
  if (e.thumbnail) return e.thumbnail;
  const last = e.thumbnails?.[e.thumbnails.length - 1];
  return last?.url;
}

// Keep only genuine video entries; drop channel/playlist rows a search or
// channel listing can interleave.
function isVideoEntry(e: YtEntry): boolean {
  if (!e.id) return false;
  if (e.ie_key === 'YoutubeTab') return false;
  if (e.id.startsWith('UC') || e.id.startsWith('PL')) return false;
  return true;
}

function mapVideo(e: YtEntry): Item {
  const poster = pickThumb(e);
  const year = e.upload_date ? Number(e.upload_date.slice(0, 4)) : undefined;
  return {
    id: encodeId('v', String(e.id)),
    type: 'movie',
    title: e.title ?? 'Untitled',
    ...(poster ? { poster } : {}),
    ...(e.duration != null ? { durationSec: e.duration } : {}),
    ...(year && Number.isFinite(year) ? { year } : {}),
  };
}

function buildSubtitleTracks(videoId: string, info: YtInfo): SubtitleTrack[] {
  const out: SubtitleTrack[] = [];
  const human = info.subtitles ?? {};
  const auto = info.automatic_captions ?? {};
  const subsPath = (lang: string, isAuto: boolean) =>
    `/api/yt/subs/${encodeURIComponent(videoId)}?lang=${encodeURIComponent(lang)}${isAuto ? '&auto=1' : ''}`;

  for (const lang of Object.keys(human)) {
    out.push({ id: `sub-${lang}`, language: lang, label: lang.toUpperCase(), url: subsPath(lang, false), format: 'vtt' });
  }
  // Auto-captions can list 100+ machine-translated languages. Cap to a useful
  // set — English variants plus any language that also has human subs — so the
  // player's subtitle menu stays sane.
  const preferred = new Set(['en', 'en-US', 'en-GB', 'en-orig', ...Object.keys(human)]);
  for (const lang of Object.keys(auto)) {
    if (human[lang]) continue;
    if (!preferred.has(lang)) continue;
    out.push({ id: `auto-${lang}`, language: lang, label: `${lang.toUpperCase()} (auto)`, url: subsPath(lang, true), format: 'vtt' });
  }
  return out;
}

// Playlists and channels both render as a canvas "show" whose videos are
// episodes (season 1, positional numbering) — this reuses the queue / Up-Next model.
function collectionAsShow(encodedId: string, info: YtInfo): ItemDetail {
  const videos = (info.entries ?? []).filter(isVideoEntry);
  const episodes: Episode[] = videos.map((e, i) => {
    const poster = pickThumb(e);
    return {
      id: encodeId('v', String(e.id)),
      title: e.title ?? `Video ${i + 1}`,
      season: 1,
      episode: i + 1,
      ...(e.duration != null ? { durationSec: e.duration } : {}),
      ...(poster ? { poster } : {}),
      ...(e.description ? { synopsis: e.description } : {}),
    };
  });
  const poster = pickThumb(videos[0] ?? {});
  return {
    id: encodedId,
    type: 'show',
    title: info.title ?? 'YouTube',
    ...(poster ? { poster } : {}),
    ...(info.description ? { synopsis: info.description } : {}),
    episodes,
  };
}

// ── Factory ────────────────────────────────────────────────────────────────────

export interface YoutubeAdapterDeps {
  yt: YtDlp;
  signer: StreamSigner;
  /** Streams-per-page ceiling for library/channel browse. */
  maxBrowse?: number;
}

export function makeYoutubeAdapter(deps: YoutubeAdapterDeps): SourceAdapter {
  const { yt, signer } = deps;
  const maxBrowse = deps.maxBrowse ?? 60;

  return {
    type: 'youtube',

    async startPair(): Promise<{ pairUrl: string; expiresAt: number }> {
      // YouTube is public — it's added via POST /api/sources, not the pair flow.
      throw new BadRequestError('YouTube sources are added without pairing');
    },

    // YouTube is its own destination (see 2026-07-18 addendum), not part of the
    // aggregated Home. It contributes no rails — browsing happens on its own page
    // via search + followed channels/playlists. (YouTube also killed /feed/trending,
    // so there is no reliable no-auth "trending" to surface here anyway.)
    async home(_ctx: SourceContext): Promise<HomeRow[]> {
      return [];
    },

    async search(_ctx: SourceContext, query: string): Promise<Item[]> {
      const q = query.trim();
      if (!q) return [];
      const info = (await yt.json(['-J', '--flat-playlist', '--playlist-end', '30', `ytsearch30:${q}`])) as YtInfo;
      return (info.entries ?? []).filter(isVideoEntry).map(mapVideo);
    },

    async library(_ctx: SourceContext, libraryId?: string, _path?: string, page?: BrowsePage): Promise<BrowseResult> {
      // No top-level sections — the YouTube page is search + followed rails. With
      // an id, browse a followed channel (c:) or playlist (p:) to populate a rail.
      if (!libraryId) return { breadcrumbs: [{ name: 'YouTube' }], items: [] };

      const { kind, id } = decodeId(libraryId);
      const url = kind === 'p' ? playlistUrl(id) : kind === 'c' ? channelUrl(id) : watchUrl(id);

      const start = (page?.offset ?? 0) + 1;
      const end = (page?.offset ?? 0) + (page?.limit ?? maxBrowse);
      const info = (await yt.json([
        '-J', '--flat-playlist', '--playlist-start', String(start), '--playlist-end', String(end), url,
      ])) as YtInfo;
      const items = (info.entries ?? []).filter(isVideoEntry).map(mapVideo);
      return {
        breadcrumbs: [{ name: 'YouTube' }, { name: info.title ?? libraryId, libraryId }],
        items,
        totalSize: items.length,
      };
    },

    async item(_ctx: SourceContext, id: string): Promise<ItemDetail> {
      const { kind, id: realId } = decodeId(id);

      if (kind === 'p' || kind === 'c') {
        const url = kind === 'p' ? playlistUrl(realId) : channelUrl(realId);
        const info = (await yt.json(['-J', '--flat-playlist', '--playlist-end', String(maxBrowse), url])) as YtInfo;
        return collectionAsShow(id, info);
      }

      // Single video.
      const info = (await yt.json(['-J', '--skip-download', watchUrl(realId)])) as YtInfo;
      const base = mapVideo({ ...info, id: realId });
      const backdrop = pickThumb(info);
      const hasCC = Object.keys(info.subtitles ?? {}).length > 0
        || Object.keys(info.automatic_captions ?? {}).length > 0;
      return {
        ...base,
        ...(backdrop ? { backdrop } : {}),
        ...(info.description ? { synopsis: info.description } : {}),
        ...(hasCC ? { hasCC: true } : {}),
      };
    },

    async resolveStream(_ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution> {
      const { id: videoId } = decodeId(id);
      const info = (await yt.json(['-J', '--skip-download', watchUrl(videoId)])) as YtInfo;
      const durationSec = Number(info.duration ?? 0);
      const subtitleTracks = buildSubtitleTracks(videoId, info);
      const query = await signer.signQuery(videoId, fromSec ?? 0);
      return {
        url: `/api/yt/stream/${encodeURIComponent(videoId)}?${query}`,
        durationSec,
        ...(subtitleTracks.length > 0 ? { subtitleTracks } : {}),
      };
    },

    async saveProgress(): Promise<void> {
      // YouTube (unauthenticated) has no server-side progress endpoint; canvas's
      // local NowPlaying record is the source of truth for resume, like Flixify.
    },
  };
}
