import { describe, expect, test } from 'bun:test';
import { makeYoutubeAdapter, encodeId, decodeId } from './youtube';
import { makeStreamSigner } from '../lib/yt-stream-sign';
import type { YtDlp } from '../lib/ytdlp';
import type { SourceContext } from './types';

const CTX: SourceContext = { baseUrl: '', token: '' };
const signer = makeStreamSigner('test-secret', { now: () => 1000 });

function fakeYt(handler: (args: string[]) => unknown): YtDlp {
  return { async json(args) { return handler(args); } };
}

// A search/trending flat-playlist payload mixing a video, a channel, and a playlist.
const MIXED_ENTRIES = {
  title: 'results',
  entries: [
    { id: 'dQw4w9WgXcQ', title: 'A Video', duration: 212, thumbnail: 't://vid', ie_key: 'Youtube', upload_date: '20091025' },
    { id: 'UCabc', title: 'A Channel', ie_key: 'YoutubeTab' },
    { id: 'PLxyz', title: 'A Playlist', ie_key: 'YoutubeTab' },
  ],
};

describe('id encoding', () => {
  test('round-trips each kind', () => {
    expect(decodeId(encodeId('v', 'abc'))).toEqual({ kind: 'v', id: 'abc' });
    expect(decodeId(encodeId('p', 'PL1'))).toEqual({ kind: 'p', id: 'PL1' });
    expect(decodeId(encodeId('c', 'UC1'))).toEqual({ kind: 'c', id: 'UC1' });
  });
  test('treats a bare/unknown id as a video', () => {
    expect(decodeId('rawId')).toEqual({ kind: 'v', id: 'rawId' });
    expect(decodeId('x:weird')).toEqual({ kind: 'v', id: 'x:weird' });
  });
});

describe('search', () => {
  test('maps only video entries, dropping channels/playlists', async () => {
    const yt = makeYoutubeAdapter({ yt: fakeYt(() => MIXED_ENTRIES), signer });
    const items = await yt.search(CTX, 'rick astley');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'v:dQw4w9WgXcQ', type: 'movie', title: 'A Video', durationSec: 212, poster: 't://vid', year: 2009 });
  });

  test('returns [] for a blank query without calling yt-dlp', async () => {
    let called = false;
    const yt = makeYoutubeAdapter({ yt: fakeYt(() => { called = true; return {}; }), signer });
    expect(await yt.search(CTX, '   ')).toEqual([]);
    expect(called).toBe(false);
  });
});

describe('home', () => {
  test('contributes no rows to the aggregated Home (own destination)', async () => {
    const yt = makeYoutubeAdapter({ yt: fakeYt(() => MIXED_ENTRIES), signer });
    expect(await yt.home(CTX)).toEqual([]);
  });
});

describe('library', () => {
  test('no id → empty (no top-level sections)', async () => {
    const yt = makeYoutubeAdapter({ yt: fakeYt(() => ({})), signer });
    const res = await yt.library(CTX);
    expect(res.items).toEqual([]);
  });

  test('channel id → mapped video items + breadcrumb', async () => {
    const yt = makeYoutubeAdapter({ yt: fakeYt(() => MIXED_ENTRIES), signer });
    const res = await yt.library(CTX, encodeId('c', 'UCabc'));
    expect(res.items).toHaveLength(1);
    expect(res.breadcrumbs).toEqual([{ name: 'YouTube' }, { name: 'results', libraryId: 'c:UCabc' }]);
  });

  test('channel browse targets the /videos tab (uploads), not the channel root', async () => {
    let captured: string[] = [];
    const yt = makeYoutubeAdapter({ yt: fakeYt((args) => { captured = args; return { entries: [] }; }), signer });
    await yt.library(CTX, encodeId('c', 'UCabc'));
    expect(captured.some((a) => a === 'https://www.youtube.com/channel/UCabc/videos')).toBe(true);
  });

  test('paging maps offset/limit to yt-dlp playlist-start/end', async () => {
    let captured: string[] = [];
    const yt = makeYoutubeAdapter({ yt: fakeYt((args) => { captured = args; return { entries: [] }; }), signer });
    await yt.library(CTX, encodeId('p', 'PL1'), undefined, { offset: 60, limit: 60 });
    expect(captured).toContain('--playlist-start');
    expect(captured[captured.indexOf('--playlist-start') + 1]).toBe('61');
    expect(captured[captured.indexOf('--playlist-end') + 1]).toBe('120');
  });
});

describe('item', () => {
  test('playlist → show whose videos are season-1 episodes', async () => {
    const playlist = {
      title: 'My Playlist',
      entries: [
        { id: 'aaa', title: 'Ep A', duration: 100, thumbnail: 't://a', ie_key: 'Youtube' },
        { id: 'bbb', title: 'Ep B', duration: 200, thumbnail: 't://b', ie_key: 'Youtube' },
      ],
    };
    const yt = makeYoutubeAdapter({ yt: fakeYt(() => playlist), signer });
    const detail = await yt.item(CTX, encodeId('p', 'PL1'));
    expect(detail).toMatchObject({ id: 'p:PL1', type: 'show', title: 'My Playlist', poster: 't://a' });
    expect(detail.episodes).toEqual([
      { id: 'v:aaa', title: 'Ep A', season: 1, episode: 1, durationSec: 100, poster: 't://a' },
      { id: 'v:bbb', title: 'Ep B', season: 1, episode: 2, durationSec: 200, poster: 't://b' },
    ]);
  });

  test('video → movie detail with synopsis, backdrop, hasCC', async () => {
    const info = { id: 'vid', title: 'V', duration: 300, thumbnail: 't://v', description: 'desc', subtitles: { en: [{ url: 'u' }] } };
    const yt = makeYoutubeAdapter({ yt: fakeYt(() => info), signer });
    const detail = await yt.item(CTX, encodeId('v', 'vid'));
    expect(detail).toMatchObject({ id: 'v:vid', type: 'movie', title: 'V', synopsis: 'desc', backdrop: 't://v', hasCC: true });
  });
});

describe('resolveStream', () => {
  test('returns a signed internal URL, duration, and capped subtitle tracks', async () => {
    const info = {
      id: 'vid', duration: 421,
      subtitles: { en: [{ url: 'h' }] },
      automatic_captions: { en: [{ url: 'a-en' }], fr: [{ url: 'a-fr' }], de: [{ url: 'a-de' }] },
    };
    const yt = makeYoutubeAdapter({ yt: fakeYt(() => info), signer });
    const res = await yt.resolveStream(CTX, encodeId('v', 'vid'), 30);

    expect(res.durationSec).toBe(421);
    expect(res.url.startsWith('/api/yt/stream/vid?')).toBe(true);

    // Human 'en' kept; auto 'en' dropped (human wins); auto 'fr'/'de' not preferred → dropped.
    const langs = (res.subtitleTracks ?? []).map((t) => t.id);
    expect(langs).toEqual(['sub-en']);

    // The signed query the adapter produced must verify.
    const query = res.url.split('?')[1]!;
    const p = new URLSearchParams(query);
    const ok = await signer.verify('vid', { from: p.get('from')!, exp: p.get('exp')!, sig: p.get('sig')! });
    expect(ok).toBe(true);
    expect(p.get('from')).toBe('30');
  });

  test('includes a preferred auto-caption when no human subs exist', async () => {
    const info = { id: 'vid', duration: 10, automatic_captions: { en: [{ url: 'a-en' }], fr: [{ url: 'a-fr' }] } };
    const yt = makeYoutubeAdapter({ yt: fakeYt(() => info), signer });
    const res = await yt.resolveStream(CTX, 'vid');
    const ids = (res.subtitleTracks ?? []).map((t) => t.id);
    expect(ids).toEqual(['auto-en']); // fr excluded, en (auto) included
  });
});
