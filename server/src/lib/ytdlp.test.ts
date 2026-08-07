import { describe, expect, test, mock } from 'bun:test';
import { makeYtDlp, pickFormats, type Exec, type YtFormat } from './ytdlp';
import { YtDlpError } from '../errors';

const okExec = (stdout: string): Exec =>
  mock(async () => ({ stdout, stderr: '', exitCode: 0 })) as unknown as Exec;

describe('makeYtDlp.json', () => {
  test('parses JSON stdout on exit 0', async () => {
    const yt = makeYtDlp({ ytdlpPath: 'yt-dlp', exec: okExec('{"id":"abc","title":"hi"}') });
    expect(await yt.json(['-J', 'abc'])).toEqual({ id: 'abc', title: 'hi' });
  });

  test('passes the binary path and args through to exec', async () => {
    let captured: string[] | undefined;
    const exec: Exec = async (cmd) => { captured = cmd; return { stdout: '{}', stderr: '', exitCode: 0 }; };
    const yt = makeYtDlp({ ytdlpPath: '/opt/yt-dlp', exec });
    await yt.json(['-J', '--flat-playlist', 'x']);
    expect(captured).toEqual(['/opt/yt-dlp', '-J', '--flat-playlist', 'x']);
  });

  test('prepends --js-runtimes when jsRuntime is configured', async () => {
    let captured: string[] | undefined;
    const exec: Exec = async (cmd) => { captured = cmd; return { stdout: '{}', stderr: '', exitCode: 0 }; };
    const yt = makeYtDlp({ ytdlpPath: 'yt-dlp', exec, jsRuntime: 'deno:/opt/deno' });
    await yt.json(['-J', 'abc']);
    expect(captured).toEqual(['yt-dlp', '--js-runtimes', 'deno:/opt/deno', '-J', 'abc']);
  });

  test('throws YtDlpError on non-zero exit, carrying stderr', async () => {
    const exec: Exec = async () => ({ stdout: '', stderr: 'ERROR: unavailable', exitCode: 1 });
    const yt = makeYtDlp({ ytdlpPath: 'yt-dlp', exec });
    const err = await yt.json(['-J', 'bad']).catch((e) => e);
    expect(err).toBeInstanceOf(YtDlpError);
    expect((err as YtDlpError).stderr).toContain('unavailable');
    expect((err as YtDlpError).status).toBe(502);
  });

  test('throws YtDlpError on unparseable stdout', async () => {
    const yt = makeYtDlp({ ytdlpPath: 'yt-dlp', exec: okExec('not json') });
    await expect(yt.json(['-J', 'x'])).rejects.toBeInstanceOf(YtDlpError);
  });

  test('throws YtDlpError when exec itself throws (spawn failure)', async () => {
    const exec: Exec = async () => { throw new Error('ENOENT'); };
    const yt = makeYtDlp({ ytdlpPath: 'yt-dlp', exec });
    await expect(yt.json(['-J', 'x'])).rejects.toBeInstanceOf(YtDlpError);
  });
});

describe('pickFormats', () => {
  const avcVideo = (id: string, height: number, tbr: number): YtFormat =>
    ({ format_id: id, url: `v://${id}`, vcodec: 'avc1.64001f', acodec: 'none', height, tbr, ext: 'mp4' });
  const aacAudio = (id: string, abr: number): YtFormat =>
    ({ format_id: id, url: `a://${id}`, vcodec: 'none', acodec: 'mp4a.40.2', abr, ext: 'm4a' });
  const av1Video = (id: string, height: number): YtFormat =>
    ({ format_id: id, url: `v://${id}`, vcodec: 'av01.0.08M.08', acodec: 'none', height, ext: 'webm' });

  test('prefers H.264 video-only + AAC audio-only and remuxes (no transcode)', () => {
    const picked = pickFormats([avcVideo('137', 1080, 4000), aacAudio('140', 128), av1Video('399', 1080)]);
    expect(picked.needsTranscode).toBe(false);
    expect(picked.videoUrl).toBe('v://137');
    expect(picked.audioUrl).toBe('a://140');
  });

  test('picks the highest H.264 rendition within the height cap', () => {
    const picked = pickFormats(
      [avcVideo('134', 480, 1000), avcVideo('137', 1080, 4000), avcVideo('266', 2160, 12000), aacAudio('140', 128)],
      1080,
    );
    expect(picked.videoUrl).toBe('v://137'); // 2160 excluded by cap, 1080 beats 480
    expect(picked.height).toBe(1080);
  });

  test('falls back to a progressive muxed H.264 stream as a single input', () => {
    const muxed: YtFormat = { format_id: '18', url: 'm://18', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, ext: 'mp4' };
    const picked = pickFormats([muxed, av1Video('399', 1080)]);
    expect(picked.needsTranscode).toBe(false);
    expect(picked.videoUrl).toBe('m://18');
    expect(picked.audioUrl).toBeUndefined();
  });

  test('marks needsTranscode when only non-H.264 video is available', () => {
    const picked = pickFormats([av1Video('399', 1080), aacAudio('140', 128)]);
    expect(picked.needsTranscode).toBe(true);
    expect(picked.videoUrl).toBe('v://399');
    expect(picked.audioUrl).toBe('a://140');
  });

  test('ignores formats without a URL', () => {
    const noUrl: YtFormat = { format_id: '137', vcodec: 'avc1.64001f', acodec: 'none', height: 1080 };
    const picked = pickFormats([noUrl, avcVideo('136', 720, 2000), aacAudio('140', 128)]);
    expect(picked.videoUrl).toBe('v://136');
  });

  test('throws when there is no usable video stream', () => {
    expect(() => pickFormats([aacAudio('140', 128)])).toThrow(YtDlpError);
  });
});
