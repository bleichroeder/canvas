import { Hono } from 'hono';
import type { YtDlp } from '../lib/ytdlp';
import type { StreamSigner } from '../lib/yt-stream-sign';
import { logger } from '../log';

// Public streaming route for YouTube.
//
// Both initial play and seek stream via:
//   yt-dlp --download-sections "*<from>-"  →  ffmpeg (remux)  →  fragmented MP4
// yt-dlp uses the DASH segment index (sidx) to byte-range-fetch starting at the
// requested time — so a seek to 40:00 transfers only from that point, never the
// preceding prefix or the whole file (measured: ~4MB, not ~344MB). ffmpeg alone
// can't do this (it reads a fragmented MP4 from byte 0 regardless of -ss). ffmpeg
// then remuxes yt-dlp's mpegts stream into the fragmented MP4 the player needs.
// Prefers 1080p H.264 (stream copy); progressive itag 18 as a last resort.

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const FORMAT = 'bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1]/18';

export interface StreamHandle {
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  /** Combined yt-dlp+ffmpeg stderr (tail), for logging on failure. */
  errText: () => Promise<string>;
  kill: () => void;
}
export interface StartStreamArgs { videoId: string; fromSec: number; signal?: AbortSignal | undefined }
export type StartStream = (a: StartStreamArgs) => StreamHandle;

export interface MakeYtStreamRoutesOpts {
  yt: YtDlp;                          // subs route: -J caption metadata
  signer: StreamSigner;
  ytdlpPath: string;
  ffmpegPath: string;
  jsRuntime?: string | undefined;     // --js-runtimes for signature solving
  maxConcurrent: number;
  startStream?: StartStream;          // injectable for tests
}

// yt-dlp (section download) piped into ffmpeg (remux to fragmented MP4).
function makeDefaultStartStream(ytdlpPath: string, ffmpegPath: string, jsRuntime: string): StartStream {
  return ({ videoId, fromSec, signal }) => {
    const rt = jsRuntime ? ['--js-runtimes', jsRuntime] : [];
    const from = Math.max(0, Math.floor(fromSec));
    const sig = signal ? { signal } : {};
    const yt = Bun.spawn(
      [ytdlpPath, ...rt, '-f', FORMAT, '--download-sections', `*${from}-`, '--quiet', '-o', '-', watchUrl(videoId)],
      { stdout: 'pipe', stderr: 'pipe', ...sig },
    );
    const ff = Bun.spawn(
      [ffmpegPath, '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
        '-c', 'copy', '-bsf:a', 'aac_adtstoasc',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'],
      { stdin: yt.stdout, stdout: 'pipe', stderr: 'pipe', ...sig },
    );
    let errCache: string | undefined;
    return {
      stdout: ff.stdout as ReadableStream<Uint8Array>,
      exited: ff.exited,
      errText: async () => {
        if (errCache === undefined) {
          const [a, b] = await Promise.all([
            new Response(yt.stderr).text().catch(() => ''),
            new Response(ff.stderr).text().catch(() => ''),
          ]);
          errCache = `yt-dlp: ${a.slice(-300)} | ffmpeg: ${b.slice(-300)}`;
        }
        return errCache;
      },
      kill: () => { try { yt.kill(); } catch { /* gone */ } try { ff.kill(); } catch { /* gone */ } },
    };
  };
}

export function makeYtStreamRoutes(opts: MakeYtStreamRoutesOpts) {
  const startStream = opts.startStream
    ?? makeDefaultStartStream(opts.ytdlpPath, opts.ffmpegPath, opts.jsRuntime ?? '');
  const r = new Hono();

  // In-process semaphore — each stream spawns yt-dlp + ffmpeg, so cap concurrency.
  let active = 0;
  const tryAcquire = () => (active >= opts.maxConcurrent ? false : (active++, true));
  const release = () => { if (active > 0) active--; };

  r.get('/stream/:videoId', async (c) => {
    const videoId = c.req.param('videoId');
    const ok = await opts.signer.verify(videoId, {
      from: c.req.query('from'), exp: c.req.query('exp'), sig: c.req.query('sig'),
    });
    if (!ok) return c.json({ error: 'invalid or expired stream url' }, 403);

    if (!tryAcquire()) return c.json({ error: 'too many concurrent streams' }, 429);
    let released = false;
    const releaseOnce = () => { if (!released) { released = true; release(); } };

    try {
      const from = Number(c.req.query('from') ?? '0') || 0;
      const signal = c.req.raw.signal;
      const h = startStream({ videoId, fromSec: from, signal });

      h.exited.then(async (code) => {
        releaseOnce();
        // 0 = clean, non-zero often means client disconnect (SIGTERM). Log real failures.
        if (code) logger.warn({ videoId, code, err: (await h.errText()).slice(-400) }, 'yt-stream pipeline exited nonzero');
      }).catch(releaseOnce);

      signal.addEventListener('abort', () => { h.kill(); releaseOnce(); }, { once: true });

      return new Response(h.stdout, {
        headers: { 'content-type': 'video/mp4', 'cache-control': 'no-store' },
      });
    } catch (err) {
      releaseOnce();
      throw err;
    }
  });

  // Caption proxy → VTT. Authed (client attaches bearer, like /api/subtitles).
  r.get('/subs/:videoId', async (c) => {
    const videoId = c.req.param('videoId');
    const lang = c.req.query('lang');
    const auto = c.req.query('auto') === '1';
    if (!lang) return c.json({ error: 'lang required' }, 400);

    const info = (await opts.yt.json(['-J', '--skip-download', watchUrl(videoId)])) as {
      subtitles?: Record<string, Array<{ ext?: string; url?: string }>>;
      automatic_captions?: Record<string, Array<{ ext?: string; url?: string }>>;
    };
    const tracks = (auto ? info.automatic_captions : info.subtitles)?.[lang] ?? [];
    const vtt = tracks.find((t) => t.ext === 'vtt') ?? tracks[0];
    if (!vtt?.url) return c.json({ error: 'no captions for lang' }, 404);
    const url = vtt.ext === 'vtt' ? vtt.url : `${vtt.url}${vtt.url.includes('?') ? '&' : '?'}fmt=vtt`;

    const res = await fetch(url);
    if (!res.ok) return c.json({ error: `caption fetch ${res.status}` }, 502);
    const body = await res.text();
    return c.body(body, 200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'public, max-age=3600' });
  });

  return r;
}
