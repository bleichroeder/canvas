import { Hono } from 'hono';
import type { YtDlp } from '../lib/ytdlp';
import type { StreamSigner } from '../lib/yt-stream-sign';
import type { YtDash } from '../lib/yt-dash';
import { seekPointForTime } from '../lib/dash-sidx';
import { logger } from '../log';

// Public streaming routes for YouTube.
//
// Full-res seek works by computing the byte offset for the seek time from the
// DASH sidx (see lib/dash-sidx), then serving `init bytes + range-fetch from
// that offset` per stream via the internal /_dash route. ffmpeg fetches the
// video+audio /_dash streams, stream-copies them into a fragmented MP4, and
// rebases timestamps to ~0 (-avoid_negative_ts make_zero) so the player's seek
// model lines up. Videos without separate avc DASH fall back to the single
// progressive file (ffmpeg -ss, which works on a single seekable file).

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const PROGRESSIVE_SEL = 'b[protocol=https][vcodec^=avc1][acodec^=mp4a]/18/b[ext=mp4][vcodec^=avc1]';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface FfmpegProc {
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  errText: () => Promise<string>;
  kill: () => void;
}
export type SpawnFfmpeg = (args: string[], signal?: AbortSignal | undefined) => FfmpegProc;

function makeDefaultSpawnFfmpeg(ffmpegPath: string): SpawnFfmpeg {
  return (args, signal) => {
    const p = Bun.spawn([ffmpegPath, ...args], { stdout: 'pipe', stderr: 'pipe', ...(signal ? { signal } : {}) });
    let cache: string | undefined;
    return {
      stdout: p.stdout as ReadableStream<Uint8Array>,
      exited: p.exited,
      errText: async () => (cache ??= (await new Response(p.stderr).text().catch(() => '')).slice(-400)),
      kill: () => { try { p.kill(); } catch { /* gone */ } },
    };
  };
}

export interface MakeYtStreamRoutesOpts {
  yt: YtDlp;
  ytDash: YtDash;
  signer: StreamSigner;
  ytdlpPath: string;
  ffmpegPath: string;
  jsRuntime?: string | undefined;
  maxConcurrent: number;
  /** Base URL ffmpeg uses to reach the internal /_dash route, e.g. http://127.0.0.1:8787 */
  internalBase: string;
  spawnFfmpeg?: SpawnFfmpeg;
}

export function makeYtStreamRoutes(opts: MakeYtStreamRoutesOpts) {
  const spawnFfmpeg = opts.spawnFfmpeg ?? makeDefaultSpawnFfmpeg(opts.ffmpegPath);
  const r = new Hono();

  let active = 0;
  const tryAcquire = () => (active >= opts.maxConcurrent ? false : (active++, true));
  const release = () => { if (active > 0) active--; };

  const FRAG = ['-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'];

  // Internal: serves one DASH stream (video|audio) starting at the seek segment:
  // init bytes + a byte-range fetch from the computed offset. Public but signed;
  // ffmpeg (localhost) is the only caller.
  r.get('/_dash/:videoId', async (c) => {
    const videoId = c.req.param('videoId');
    const stream = c.req.query('stream');
    const ok = await opts.signer.verify(videoId, { from: c.req.query('from'), exp: c.req.query('exp'), sig: c.req.query('sig') });
    if (!ok) return c.json({ error: 'invalid signature' }, 403);
    if (stream !== 'v' && stream !== 'a') return c.json({ error: 'bad stream' }, 400);

    const sources = await opts.ytDash.resolve(videoId);
    if (!sources) return c.json({ error: 'no dash' }, 404);
    const s = stream === 'a' ? sources.audio : sources.video;
    const from = Number(c.req.query('from') ?? '0') || 0;
    const { byteOffset } = seekPointForTime(s.index, from);

    const signal = c.req.raw.signal;
    const upstream = await fetch(s.url, { headers: { Range: `bytes=${byteOffset}-`, 'user-agent': UA }, ...(signal ? { signal } : {}) });
    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 200) {
      return c.json({ error: `range fetch ${upstream.status}` }, 502);
    }
    const init = s.initBytes;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(init);
        const reader = upstream.body!.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
          controller.close();
        } catch {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() { upstream.body?.cancel().catch(() => {}); },
    });
    return new Response(body, { headers: { 'content-type': 'video/mp4', 'cache-control': 'no-store' } });
  });

  r.get('/stream/:videoId', async (c) => {
    const videoId = c.req.param('videoId');
    const ok = await opts.signer.verify(videoId, { from: c.req.query('from'), exp: c.req.query('exp'), sig: c.req.query('sig') });
    if (!ok) return c.json({ error: 'invalid or expired stream url' }, 403);
    if (!tryAcquire()) return c.json({ error: 'too many concurrent streams' }, 429);

    let released = false;
    const releaseOnce = () => { if (!released) { released = true; release(); } };

    try {
      const from = Number(c.req.query('from') ?? '0') || 0;
      const signal = c.req.raw.signal;
      const sources = await opts.ytDash.resolve(videoId);

      let args: string[];
      if (sources) {
        // Full-res DASH: ffmpeg muxes the two internal (sidx-seeked) streams.
        const q = await opts.signer.signQuery(videoId, from);
        const vUrl = `${opts.internalBase}/api/yt/_dash/${encodeURIComponent(videoId)}?stream=v&${q}`;
        const aUrl = `${opts.internalBase}/api/yt/_dash/${encodeURIComponent(videoId)}?stream=a&${q}`;
        args = ['-hide_banner', '-loglevel', 'error', '-i', vUrl, '-i', aUrl,
          '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-bsf:a', 'aac_adtstoasc',
          '-avoid_negative_ts', 'make_zero', ...FRAG];
      } else {
        // Fallback: single progressive file, ffmpeg -ss (seekable).
        const out = await opts.yt.text(['-f', PROGRESSIVE_SEL, '-g', watchUrl(videoId)]);
        const url = out.split('\n').map((s) => s.trim()).filter(Boolean)[0];
        if (!url) return c.json({ error: 'no playable stream' }, 502);
        const ss = from > 0 ? ['-ss', String(from)] : [];
        args = ['-hide_banner', '-loglevel', 'error', ...ss, '-user_agent', UA, '-i', url,
          '-c', 'copy', '-bsf:a', 'aac_adtstoasc', ...FRAG];
      }

      const proc = spawnFfmpeg(args, signal);
      proc.exited.then(async (code) => {
        releaseOnce();
        if (code) logger.warn({ videoId, code, dash: !!sources, err: await proc.errText() }, 'yt-stream ffmpeg exited nonzero');
      }).catch(releaseOnce);
      signal.addEventListener('abort', () => { proc.kill(); releaseOnce(); }, { once: true });

      return new Response(proc.stdout, { headers: { 'content-type': 'video/mp4', 'cache-control': 'no-store' } });
    } catch (err) {
      releaseOnce();
      throw err;
    }
  });

  // Caption proxy → VTT (authed via requireUser in app.ts).
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
    return c.body(await res.text(), 200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'public, max-age=3600' });
  });

  return r;
}
