import { YtDlpError } from '../errors';
import { logger } from '../log';

// Thin, injectable wrapper around the yt-dlp binary. All process spawning goes
// through the `exec` dependency so adapter/route tests never touch a real
// subprocess (mirrors the makeWatchtowerClient injection pattern).

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run a command to completion, capturing stdout/stderr/exit code. */
export type Exec = (
  cmd: string[],
  opts?: { timeoutMs?: number | undefined; signal?: AbortSignal | undefined },
) => Promise<ExecResult>;

/** Default exec backed by Bun.spawn. Kills the child on timeout or caller abort. */
export const defaultExec: Exec = async (cmd, opts) => {
  const signals: AbortSignal[] = [];
  if (opts?.signal) signals.push(opts.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts?.timeoutMs && opts.timeoutMs > 0) {
    const ac = new AbortController();
    timer = setTimeout(() => ac.abort(new Error('timeout')), opts.timeoutMs);
    signals.push(ac.signal);
  }
  const signal = signals.length ? AbortSignal.any(signals) : undefined;
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', ...(signal ? { signal } : {}) });
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export interface MakeYtDlpOpts {
  /** Path to the yt-dlp binary (config.YTDLP_PATH). */
  ytdlpPath: string;
  /** Injected for tests; defaults to a Bun.spawn-backed exec. */
  exec?: Exec;
  /** Per-invocation timeout for metadata calls. */
  timeoutMs?: number;
  /** JS runtime for signature solving, passed as `--js-runtimes` (RUNTIME[:PATH]). */
  jsRuntime?: string;
}

// Shape of the bits of yt-dlp's `-J` output we consume. yt-dlp emits far more;
// we type only what we read and treat the rest as unknown.
export interface YtFormat {
  format_id: string;
  url?: string;
  vcodec?: string;   // 'none' for audio-only
  acodec?: string;   // 'none' for video-only
  ext?: string;
  height?: number | null;
  tbr?: number | null;   // total bitrate
  abr?: number | null;   // audio bitrate
}

export interface PickedFormats {
  /** URL to feed ffmpeg as the (video) input. */
  videoUrl: string;
  /** Separate audio input URL; undefined when the video input is already muxed. */
  audioUrl?: string | undefined;
  /** True when the chosen video is not H.264 and must be re-encoded for the player. */
  needsTranscode: boolean;
  height?: number | undefined;
  videoCodec?: string | undefined;
  audioCodec?: string | undefined;
}

export interface YtDlp {
  /** Run yt-dlp and parse stdout as a single JSON document (`-J`). */
  json(args: string[], opts?: { timeoutMs?: number | undefined; signal?: AbortSignal | undefined }): Promise<unknown>;
  /** Run yt-dlp and return raw stdout (e.g. `-g` direct-URL output). */
  text(args: string[], opts?: { timeoutMs?: number | undefined; signal?: AbortSignal | undefined }): Promise<string>;
}

export function makeYtDlp(opts: MakeYtDlpOpts): YtDlp {
  const exec = opts.exec ?? defaultExec;
  const defaultTimeoutMs = opts.timeoutMs ?? 45_000;
  // Prefix applied to every invocation so signature solving works.
  const runtimeArgs = opts.jsRuntime ? ['--js-runtimes', opts.jsRuntime] : [];

  async function run(
    args: string[],
    callOpts?: { timeoutMs?: number | undefined; signal?: AbortSignal | undefined },
  ): Promise<string> {
    const cmd = [opts.ytdlpPath, ...runtimeArgs, ...args];
    let res: ExecResult;
    try {
      res = await exec(cmd, { timeoutMs: callOpts?.timeoutMs ?? defaultTimeoutMs, signal: callOpts?.signal });
    } catch (err) {
      throw new YtDlpError(err instanceof Error ? err.message : 'spawn failed');
    }
    if (res.exitCode !== 0) {
      const stderr = res.stderr.slice(0, 800);
      logger.warn({ ytArgs: cmd.slice(1), exitCode: res.exitCode, stderr }, 'yt-dlp failed');
      throw new YtDlpError(`exited ${res.exitCode}`, stderr);
    }
    return res.stdout;
  }

  return {
    async json(args, callOpts) {
      const stdout = await run(args, callOpts);
      try {
        return JSON.parse(stdout);
      } catch {
        throw new YtDlpError('could not parse JSON output');
      }
    },
    async text(args, callOpts) {
      return run(args, callOpts);
    },
  };
}

const isAvc = (codec?: string) => !!codec && codec.startsWith('avc1');
const isAac = (codec?: string) => !!codec && (codec.startsWith('mp4a') || codec === 'aac');
const isVideoOnly = (f: YtFormat) => !!f.vcodec && f.vcodec !== 'none' && (f.acodec === 'none' || !f.acodec);
const isAudioOnly = (f: YtFormat) => (f.vcodec === 'none' || !f.vcodec) && !!f.acodec && f.acodec !== 'none';
const isMuxed = (f: YtFormat) => !!f.vcodec && f.vcodec !== 'none' && !!f.acodec && f.acodec !== 'none';

function bestBy<T>(items: T[], score: (t: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const it of items) {
    const s = score(it);
    if (s > bestScore) { bestScore = s; best = it; }
  }
  return best;
}

/**
 * Choose ffmpeg inputs from a yt-dlp format list, preferring a cheap remux.
 *
 * Preference order, capped at `maxHeight`:
 *   1. H.264 video-only + AAC audio-only  → copy both, mux (common case)
 *   2. Progressive muxed H.264+AAC        → copy single input
 *   3. Best video-only + best audio-only  → transcode video to H.264
 *
 * Throws YtDlpError when no usable video stream exists at all.
 */
export function pickFormats(formats: YtFormat[], maxHeight = 1080): PickedFormats {
  const withUrl = formats.filter((f) => !!f.url);
  const underCap = (f: YtFormat) => (f.height ?? 0) <= maxHeight;

  const avcVideo = withUrl.filter((f) => isVideoOnly(f) && isAvc(f.vcodec) && underCap(f));
  const aacAudio = withUrl.filter((f) => isAudioOnly(f) && isAac(f.acodec));

  const video = bestBy(avcVideo, (f) => (f.height ?? 0) * 1e6 + (f.tbr ?? 0));
  const audio = bestBy(aacAudio, (f) => f.abr ?? f.tbr ?? 0);

  // 1. avc1 video-only + aac audio-only → remux.
  if (video?.url && audio?.url) {
    return {
      videoUrl: video.url,
      audioUrl: audio.url,
      needsTranscode: false,
      height: video.height ?? undefined,
      videoCodec: video.vcodec,
      audioCodec: audio.acodec,
    };
  }

  // 2. progressive muxed avc1+aac → single input, copy.
  const muxedAvc = bestBy(
    withUrl.filter((f) => isMuxed(f) && isAvc(f.vcodec) && underCap(f)),
    (f) => (f.height ?? 0) * 1e6 + (f.tbr ?? 0),
  );
  if (muxedAvc?.url) {
    return {
      videoUrl: muxedAvc.url,
      needsTranscode: false,
      height: muxedAvc.height ?? undefined,
      videoCodec: muxedAvc.vcodec,
      audioCodec: muxedAvc.acodec,
    };
  }

  // 3. no H.264 available → best video-only (any codec) + best audio, transcode.
  const anyVideo = bestBy(
    withUrl.filter((f) => isVideoOnly(f) && underCap(f)),
    (f) => (f.height ?? 0) * 1e6 + (f.tbr ?? 0),
  );
  const anyAudio = bestBy(withUrl.filter(isAudioOnly), (f) => f.abr ?? f.tbr ?? 0);
  if (anyVideo?.url) {
    return {
      videoUrl: anyVideo.url,
      audioUrl: anyAudio?.url,
      needsTranscode: true,
      height: anyVideo.height ?? undefined,
      videoCodec: anyVideo.vcodec,
      audioCodec: anyAudio?.acodec,
    };
  }

  throw new YtDlpError('no usable video stream in formats');
}
