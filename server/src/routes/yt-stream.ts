import { Hono } from 'hono';
import { type PickedFormats, type YtDlp } from '../lib/ytdlp';
import type { StreamSigner } from '../lib/yt-stream-sign';
import { logger } from '../log';

// Public streaming route for YouTube. resolveStream (authed) mints a signed URL;
// this route verifies it, then runs yt-dlp (fresh format URLs — they're IP-bound
// and expire) → ffmpeg (remux to fragmented MP4) → HTTP pipe consumed by the
// player's RangeFetcher. A concurrency cap and abort-driven kill keep the
// ffmpeg fleet bounded.

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// ffmpeg's default UA is often rejected by googlevideo; reuse a browser UA.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function inputOpts(from: number): string[] {
  return [
    ...(from > 0 ? ['-ss', String(from)] : []),
    '-user_agent', UA,
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
  ];
}

/**
 * Build ffmpeg args (without the binary path) to mux the picked formats into a
 * fragmented MP4. Shared with the live-verify script. `output` is `pipe:1` for
 * streaming or a file path for offline checks.
 */
export function buildFfmpegArgs(picked: PickedFormats, fromSec = 0, output = 'pipe:1'): string[] {
  const from = Math.max(0, Math.floor(fromSec));
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  args.push(...inputOpts(from), '-i', picked.videoUrl);
  if (picked.audioUrl) {
    args.push(...inputOpts(from), '-i', picked.audioUrl, '-map', '0:v:0', '-map', '1:a:0');
  }
  // Remux (copy) is the common case; transcode only when the best video isn't H.264.
  if (picked.needsTranscode) args.push('-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac');
  else args.push('-c', 'copy');
  args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', output);
  return args;
}

// Minimal view of a spawned child so tests can inject a fake ffmpeg.
export interface Spawned {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}
export type Spawn = (cmd: string[], opts: { signal?: AbortSignal }) => Spawned;

const defaultSpawn: Spawn = (cmd, opts) => {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', ...(opts.signal ? { signal: opts.signal } : {}) });
  return {
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    exited: proc.exited,
    kill: () => { try { proc.kill(); } catch { /* already gone */ } },
  };
};

export interface MakeYtStreamRoutesOpts {
  yt: YtDlp;
  signer: StreamSigner;
  ffmpegPath: string;
  maxConcurrent: number;
  spawn?: Spawn;
}

export function makeYtStreamRoutes(opts: MakeYtStreamRoutesOpts) {
  const spawn = opts.spawn ?? defaultSpawn;
  const r = new Hono();

  // Simple in-process semaphore. Protects CPU/memory from a flood of ffmpeg
  // children; excess requests get a retryable 429.
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
      // Extract direct URLs with -g so yt-dlp fully processes them (signature +
      // n-param). The format.url fields from -J work in curl but 403 in ffmpeg;
      // -g output does not. Prefer H.264 (copy); no avc → 502 (rare).
      const selector = 'bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1]';
      const out = await opts.yt.text(['-f', selector, '-g', watchUrl(videoId)]);
      const urls = out.split('\n').map((s) => s.trim()).filter(Boolean);
      if (urls.length === 0) return c.json({ error: 'no playable H.264 stream for this video' }, 502);
      const picked: PickedFormats = urls.length >= 2
        ? { videoUrl: urls[0]!, audioUrl: urls[1]!, needsTranscode: false }
        : { videoUrl: urls[0]!, needsTranscode: false };
      const from = Number(c.req.query('from') ?? '0') || 0;

      const signal = c.req.raw.signal;
      const child = spawn([opts.ffmpegPath, ...buildFfmpegArgs(picked, from)], { ...(signal ? { signal } : {}) });

      // Drain stderr so ffmpeg never blocks on a full pipe; log on nonzero exit.
      const stderrText = new Response(child.stderr).text().catch(() => '');
      child.exited.then(async (code) => {
        releaseOnce();
        if (code) logger.warn({ videoId, code, stderr: (await stderrText).slice(-500) }, 'yt-stream ffmpeg exited nonzero');
      }).catch(releaseOnce);

      // Kill the child if the client goes away (disconnect / seek reboot).
      if (signal) signal.addEventListener('abort', () => { child.kill(); releaseOnce(); }, { once: true });

      return new Response(child.stdout, {
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
    // Prefer a native VTT track; else take the first and request fmt=vtt.
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
