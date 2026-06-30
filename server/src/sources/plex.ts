import { PlexHttpError } from '../errors';
import { plexFetch, mapMetadata, transcodeImage, PLEX_BACKDROP_WIDTH, PLEX_POSTER_WIDTH, type PlexMetadata, type PlexSection } from './plex-api';
import type { SourceAdapter, SourceContext, HomeRow, Item, ItemDetail, BrowseResult, PlayResolution } from './types';

interface MediaContainer<T> {
  MediaContainer: {
    size: number;
    Metadata?: T[];
    Directory?: T[];
  };
}

export const plexAdapter: SourceAdapter = {
  type: 'plex',

  async startPair(code: string) {
    return {
      pairUrl: `/pair?code=${encodeURIComponent(code)}&type=plex`,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
  },

  async home(ctx: SourceContext): Promise<HomeRow[]> {
    const [onDeck, recent] = await Promise.all([
      plexFetch<MediaContainer<PlexMetadata>>(ctx, '/library/onDeck?X-Plex-Container-Size=20&includeStreams=1'),
      plexFetch<MediaContainer<PlexMetadata>>(ctx, '/library/recentlyAdded?X-Plex-Container-Size=20&includeStreams=1'),
    ]);
    const rows: HomeRow[] = [];
    const onDeckItems = (onDeck.MediaContainer.Metadata ?? []).map((m) => mapMetadata(ctx, m));
    if (onDeckItems.length) rows.push({ kind: 'continue', title: 'Continue Watching', items: onDeckItems });
    const recentItems = (recent.MediaContainer.Metadata ?? []).map((m) => mapMetadata(ctx, m));
    if (recentItems.length) rows.push({ kind: 'recent', title: 'Recently Added', items: recentItems });
    return rows;
  },

  async search(ctx: SourceContext, query: string): Promise<Item[]> {
    const res = await plexFetch<MediaContainer<{ Metadata?: PlexMetadata[] } & PlexMetadata>>(
      ctx,
      `/hubs/search?query=${encodeURIComponent(query)}&limit=20&includeStreams=1`,
    );
    // hubs/search returns a Hub[] each containing Metadata. The shape: MediaContainer.Hub[].Metadata[]
    const hubs = (res.MediaContainer as unknown as { Hub?: { Metadata?: PlexMetadata[]; type?: string }[] }).Hub ?? [];
    const items: Item[] = [];
    for (const hub of hubs) {
      if (!hub.Metadata) continue;
      for (const m of hub.Metadata) {
        if (m.type === 'movie' || m.type === 'show' || m.type === 'episode') {
          items.push(mapMetadata(ctx, m));
        }
      }
    }
    return items;
  },

  async library(ctx: SourceContext, libraryId?: string, _path?: string, page?: { offset: number; limit: number }): Promise<BrowseResult> {
    if (!libraryId) {
      // List sections as folder items.
      const sections = await plexFetch<MediaContainer<PlexSection>>(ctx, '/library/sections');
      const items: Item[] = (sections.MediaContainer.Directory ?? []).map((s) => {
        const poster = transcodeImage(ctx, s.composite, PLEX_POSTER_WIDTH);
        return {
          id: s.key,
          type: 'folder' as const,
          title: s.title,
          ...(poster !== undefined ? { poster } : {}),
          librarySectionType: s.type,
        };
      });
      return { breadcrumbs: [{ name: 'Libraries' }], items, totalSize: items.length };
    }
    // Browse one section, paged.
    const offset = page?.offset ?? 0;
    const limit = page?.limit ?? 60;
    const baseParams: Record<string, string> = {
      'X-Plex-Container-Start': String(offset),
      'X-Plex-Container-Size': String(limit),
    };
    type AllResponse = MediaContainer<PlexMetadata & { librarySectionTitle?: string; parentTitle?: string }> & {
      MediaContainer: { totalSize?: number; title1?: string; title2?: string; librarySectionTitle?: string };
    };
    const tryFetch = async (subpath: string, extra?: Record<string, string>): Promise<AllResponse> => {
      const params = new URLSearchParams(extra ? { ...baseParams, ...extra } : baseParams);
      return plexFetch<AllResponse>(
        ctx,
        `/library/sections/${encodeURIComponent(libraryId)}/${subpath}?${params.toString()}`,
      );
    };
    const tryMetadataChildren = async (): Promise<AllResponse> => {
      const params = new URLSearchParams(baseParams);
      return plexFetch<AllResponse>(
        ctx,
        `/library/metadata/${encodeURIComponent(libraryId)}/children?${params.toString()}`,
      );
    };
    // Try /library/sections/X/all first (the section-browse path). On 404,
    // retry without includeStreams. Still 404 → the id likely isn't a section
    // at all but a ratingKey for a metadata item (album, artist, etc., which
    // happen when music items appear on Home from /library/recentlyAdded).
    // In that case browse children via /library/metadata/X/children.
    let all: AllResponse;
    try {
      all = await tryFetch('all', { includeStreams: '1' });
    } catch (e) {
      if (!(e instanceof PlexHttpError) || e.upstreamStatus !== 404) throw e;
      try {
        all = await tryFetch('all');
      } catch (e2) {
        if (!(e2 instanceof PlexHttpError) || e2.upstreamStatus !== 404) throw e2;
        // Not a section — check if it's a metadata id we can drill into.
        const sections = await plexFetch<MediaContainer<PlexSection>>(ctx, '/library/sections').catch(() => null);
        const directory = sections?.MediaContainer.Directory ?? [];
        const target = directory.find((s) => s.key === libraryId);
        if (!target) {
          // Not in sections — try metadata/children before giving up.
          try {
            all = await tryMetadataChildren();
          } catch (e3) {
            if (!(e3 instanceof PlexHttpError) || e3.upstreamStatus !== 404) throw e3;
            const availableList = directory.map((s) => `${s.key} (${s.title})`).join(', ') || '(none)';
            throw new Error(
              `Plex id "${libraryId}" isn't a section or a browsable metadata item on this server. ` +
              `Available sections: ${availableList}`,
            );
          }
        } else if (target.type === 'artist' || target.type === 'music' || target.type === 'audio') {
          // Section exists and is music — try /albums for the music-section quirk.
          try {
            all = await tryFetch('albums');
          } catch (musicErr) {
            if (musicErr instanceof PlexHttpError && musicErr.upstreamStatus === 404) {
              throw new Error(
                `Plex music section "${target.title}" (id ${libraryId}): both /all and /albums return 404. ` +
                `Server may not have music browse enabled for this section.`,
              );
            }
            throw musicErr;
          }
        } else {
          throw new Error(
            `Plex section "${target.title}" (id ${libraryId}, type ${target.type}) ` +
            `returns 404 on /all. May be a Plex Cloud or shared section the local server can't serve.`,
          );
        }
      }
    }
    const items = (all.MediaContainer.Metadata ?? []).map((m) => mapMetadata(ctx, m));
    const sectionTitle = all.MediaContainer.Metadata?.[0]?.librarySectionTitle ?? 'Library';
    const totalSize = all.MediaContainer.totalSize ?? items.length;
    // Album-detail: every item is a track and they all share the same album.
    // Pull album-level metadata from the first track (parentTitle/parentThumb/
    // grandparentTitle live on each track per Plex's children response).
    let albumDetail: BrowseResult['albumDetail'] | undefined;
    if (items.length > 0 && items.every((it) => it.kind === 'music-track')) {
      const first = (all.MediaContainer.Metadata ?? [])[0];
      if (first) {
        const albumCover = first.parentThumb ? transcodeImage(ctx, first.parentThumb, PLEX_BACKDROP_WIDTH) : undefined;
        albumDetail = {
          title: first.parentTitle ?? 'Album',
          ...(first.grandparentTitle ? { artist: first.grandparentTitle } : {}),
          ...(albumCover !== undefined ? { cover: albumCover } : {}),
          ...(first.parentYear !== undefined ? { year: first.parentYear } : {}),
        };
      }
    }
    return {
      breadcrumbs: [
        { name: 'Libraries' },
        { name: sectionTitle, libraryId },
      ],
      items,
      totalSize,
      ...(albumDetail ? { albumDetail } : {}),
    };
  },

  async item(ctx: SourceContext, id: string): Promise<ItemDetail> {
    const res = await plexFetch<MediaContainer<PlexMetadata>>(
      ctx,
      `/library/metadata/${encodeURIComponent(id)}`,
    );
    const m = res.MediaContainer.Metadata?.[0];
    if (!m) throw new Error(`Plex item ${id} not found`);
    const base = mapMetadata(ctx, m);
    const backdrop = transcodeImage(ctx, m.art, PLEX_BACKDROP_WIDTH);
    const detail: ItemDetail = {
      ...base,
      ...(backdrop !== undefined ? { backdrop } : {}),
      ...(m.summary !== undefined ? { synopsis: m.summary } : {}),
      ...(m.rating !== undefined ? { rating: m.rating } : {}),
    };
    if (m.type === 'show') {
      const leaves = await plexFetch<MediaContainer<PlexMetadata & {
        parentIndex?: number; index?: number;
      }>>(ctx, `/library/metadata/${encodeURIComponent(id)}/allLeaves`);
      detail.episodes = (leaves.MediaContainer.Metadata ?? []).map((e) => {
        const epDurationSec = e.duration ? Math.round(e.duration / 1000) : undefined;
        const epViewOffsetSec = e.viewOffset ? Math.round(e.viewOffset / 1000) : undefined;
        const epPoster = transcodeImage(ctx, e.thumb, PLEX_POSTER_WIDTH);
        return {
          id: e.ratingKey,
          title: e.title,
          season: (e as { parentIndex?: number }).parentIndex ?? 0,
          episode: (e as { index?: number }).index ?? 0,
          ...(epDurationSec !== undefined ? { durationSec: epDurationSec } : {}),
          ...(epViewOffsetSec !== undefined ? { viewOffsetSec: epViewOffsetSec } : {}),
          ...(e.summary !== undefined ? { synopsis: e.summary } : {}),
          ...(epPoster !== undefined ? { poster: epPoster } : {}),
        };
      });
    }
    return detail;
  },

  async resolveStream(ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution> {
    // Plex's direct-play hands us the original container — typically MKV with
    // arbitrary codecs (HEVC, AC3, DTS). The canvas pipeline only handles
    // H.264 + AAC|MP3. Route through Plex's transcoder forcing those codecs.
    const meta = await plexFetch<MediaContainer<PlexMetadata & {
      Media?: { duration?: number; Part?: {
        id?: number;
        key: string;
        Stream?: {
          id?: number;
          streamType?: number;
          format?: string;
          codec?: string;
          language?: string;
          languageTag?: string;
          displayTitle?: string;
          title?: string;
          selected?: boolean;
        }[];
      }[] }[];
    }>>(ctx, `/library/metadata/${encodeURIComponent(id)}`);
    const m = meta.MediaContainer.Metadata?.[0];
    if (!m) throw new Error(`Plex item ${id} not found`);
    const durationMs = m.duration ?? m.Media?.[0]?.duration ?? 0;
    const partId = m.Media?.[0]?.Part?.[0]?.id;
    const streams = m.Media?.[0]?.Part?.[0]?.Stream ?? [];
    const subtitleTracks = partId !== undefined
      ? streams
          .filter((s) => s.streamType === 3 && s.id !== undefined)
          .map((s) => {
            const lang = s.languageTag ?? s.language;
            return {
              id: String(s.id),
              ...(lang !== undefined ? { language: lang } : {}),
              label: s.displayTitle ?? s.title ?? s.language ?? `Subtitle ${s.id}`,
              // Relative path; frontend prefixes with API_BASE. Worker proxies
              // the actual Plex VTT fetch (Plex doesn't send CORS headers).
              url: `/api/subtitles?partId=${partId}&streamId=${s.id}`,
              format: 'vtt' as const,
            };
          })
      : [];

    const session = crypto.randomUUID();
    const params = new URLSearchParams({
      'protocol': 'http',
      'path': `/library/metadata/${id}`,
      'mediaIndex': '0',
      'partIndex': '0',
      'directPlay': '0',
      'directStream': '0',
      'videoCodec': 'h264',
      'audioCodec': 'aac',
      'videoQuality': '80',
      'videoResolution': '1920x1080',
      'maxVideoBitrate': '8000',
      'fastSeek': '1',
      'session': session,
      'X-Plex-Token': ctx.token,
      'X-Plex-Client-Identifier': 'canvas',
      'X-Plex-Product': 'Canvas',
      'X-Plex-Platform': 'Web',
    });
    if (typeof fromSec === 'number' && fromSec > 0) {
      params.set('offset', String(Math.floor(fromSec)));
    }
    const url = `${ctx.baseUrl}/video/:/transcode/universal/start.mp4?${params.toString()}`;

    const thumbnailUrlTemplate = partId !== undefined
      ? `${ctx.baseUrl}/library/parts/${partId}/indexes/sd/{ms}?X-Plex-Token=${encodeURIComponent(ctx.token)}`
      : undefined;

    return {
      url,
      durationSec: Math.round(durationMs / 1000),
      ...(subtitleTracks.length > 0 ? { subtitleTracks } : {}),
      ...(thumbnailUrlTemplate ? { thumbnailUrlTemplate } : {}),
    };
  },

  async saveProgress(ctx: SourceContext, id: string, posSec: number, completed: boolean): Promise<void> {
    const state = completed ? 'stopped' : 'playing';
    const timeMs = Math.round(posSec * 1000);
    // Plex /:/timeline requires `duration` and `identifier` query params plus the
    // X-Plex-Client-Identifier header (the latter is set globally in plexFetch).
    const meta = await plexFetch<MediaContainer<PlexMetadata & {
      Media?: { duration?: number }[];
    }>>(ctx, `/library/metadata/${encodeURIComponent(id)}`);
    const m = meta.MediaContainer.Metadata?.[0];
    const durationMs = m?.duration ?? m?.Media?.[0]?.duration ?? 0;
    const url =
      `/:/timeline` +
      `?ratingKey=${encodeURIComponent(id)}` +
      `&key=/library/metadata/${encodeURIComponent(id)}` +
      `&identifier=com.plexapp.plugins.library` +
      `&state=${state}` +
      `&time=${timeMs}` +
      `&duration=${durationMs}`;
    await plexFetch(ctx, url);
  },
};
