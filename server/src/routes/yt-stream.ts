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

  // frag_duration caps fragments at 0.5s so the two tracks stay finely
  // interleaved — otherwise a ~5s keyframe fragment puts all its video bytes
  // ahead of its audio bytes, and the player's audio buffer drains before the
  // next fragment arrives (audioDepth 0 → clock stalls → fetch deadlock).
  const FRAG = ['-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000', '-f', 'mp4', 'pipe:1'];
  // googlevideo throttles open-ended reads to ~1x real-time but serves bounded
  // byte ranges at full speed (this is why yt-dlp downloads in chunks). We proxy
  // in chunks this size to defeat the throttle.
  const DASH_CHUNK = 4_000_000;

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
    const init = s.initBytes;
    // ffmpeg opens the URL open-ended, which googlevideo throttles to ~real-time
    // (video buffer never fills → audio starves → freeze). So we proxy it as
    // sequential bounded-range fetches instead. Pull-based so we only fetch the
    // next chunk when ffmpeg has drained the previous one (no unbounded memory).
    let pos = byteOffset;
    let ended = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(init); },
      async pull(controller) {
        if (ended) { controller.close(); return; }
        try {
          const resp = await fetch(s.url, {
            headers: { Range: `bytes=${pos}-${pos + DASH_CHUNK - 1}`, 'user-agent': UA },
            ...(signal ? { signal } : {}),
          });
          if (resp.status !== 206 && resp.status !== 200) { ended = true; controller.close(); return; }
          const buf = new Uint8Array(await resp.arrayBuffer());
          if (buf.length === 0) { ended = true; controller.close(); return; }
          controller.enqueue(buf);
          pos += buf.length;
          if (buf.length < DASH_CHUNK) ended = true; // short read → EOF
        } catch {
          ended = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() { ended = true; },
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
        // Full-res DASH: ffmpeg muxes the two internal (sidx-seeked) streams,
        // reading each as a fresh 0-based timeline (it does NOT treat the
        // segment tfdt as absolute). The video /_dash starts exactly at its
        // keyframe, but the audio /_dash starts at its own (earlier) segment
        // boundary — so audio plays ~one segment ahead of the picture. Trim just
        // that lead off the audio input with -ss (a few seconds), leaving video
        // untouched, so both tracks' time 0 is the same instant.
        const aligned = seekPointForTime(sources.video.index, from).segStartSec;
        const audioLead = Math.max(0, aligned - seekPointForTime(sources.audio.index, aligned).segStartSec);
        const q = await opts.signer.signQuery(videoId, aligned);
        const vUrl = `${opts.internalBase}/api/yt/_dash/${encodeURIComponent(videoId)}?stream=v&${q}`;
        const aUrl = `${opts.internalBase}/api/yt/_dash/${encodeURIComponent(videoId)}?stream=a&${q}`;
        args = ['-hide_banner', '-loglevel', 'error',
          '-i', vUrl,
          '-ss', String(audioLead), '-i', aUrl,
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
