import { RangeFetcher } from './range-fetcher';
import { Demuxer } from './demux';
import { VideoSink } from './video';
import { AudioSink } from './audio';
import { getApiBase, authHeaders } from '../config';

interface QueueItem { id: string; url: string; title: string; addedAt: number; }

const status = document.getElementById('status');
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const errorEl = document.getElementById('error');
const playPauseBtn = document.getElementById('play-pause') as HTMLButtonElement | null;
const seekEl = document.getElementById('seek') as HTMLInputElement | null;
const timeEl = document.getElementById('time');
const volumeBtn = document.getElementById('volume-toggle') as HTMLButtonElement | null;
const controls = document.getElementById('controls');

function log(msg: string): void {
  if (status) status.textContent = msg;
  console.log('[passenger]', msg);
}

function showError(msg: string): void {
  if (errorEl) {
    errorEl.style.display = 'flex';
    errorEl.textContent = msg;
  }
  if (status) status.textContent = msg;
}

function fmt(sec: number): string {
  if (!isFinite(sec)) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

async function getItemById(id: string): Promise<QueueItem | null> {
  const base = getApiBase();
  if (!base) return null;
  const res = await fetch(`${base}/api/queue`, { headers: authHeaders() });
  if (!res.ok) return null;
  const items: QueueItem[] = await res.json();
  return items.find((it) => it.id === id) ?? null;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const directUrl = params.get('url');

  let mediaUrl: string;
  let title = 'Untitled';

  if (directUrl) {
    mediaUrl = directUrl;
  } else if (id) {
    log('Looking up queue item…');
    const item = await getItemById(id);
    if (!item) { showError('Queue item not found or expired.'); return; }
    mediaUrl = item.url;
    title = item.title;
  } else {
    showError('No id or url specified.');
    return;
  }

  log(`Loading: ${title} — tap Play to start`);
  if (controls) controls.classList.remove('hidden');

  let video: VideoSink | null = null;
  let audio: AudioSink | null = null;
  let duration = 0;
  let pendingVideo: EncodedVideoChunk[] = [];
  let pendingAudio: EncodedAudioChunk[] = [];
  let started = false;
  let paused = false;
  let muted = false;
  let seekingByUser = false;

  function getTimeSec(): number {
    if (audio) return audio.currentTime();
    return 0;
  }

  const demuxer = new Demuxer({
    onReady: (info) => {
      if (!info.videoConfig) { showError('No video track found.'); return; }
      duration = info.duration;
      log(`Ready: ${fmt(duration)} — tap Play`);
      video = new VideoSink({
        canvas,
        config: info.videoConfig,
        clock: () => getTimeSec(),
        onError: (e) => showError(`Video decode error: ${e.message}`),
      });
      if (info.audioConfig) {
        audio = new AudioSink({
          config: info.audioConfig,
          onError: (e) => showError(`Audio decode error: ${e.message}`),
        });
      }
    },
    onVideoSample: (chunk) => {
      if (started && video) video.feed(chunk);
      else pendingVideo.push(chunk);
    },
    onAudioSample: (chunk) => {
      if (started && audio) audio.feed(chunk);
      else pendingAudio.push(chunk);
    },
    onError: (e) => showError(`Demux error: ${e.message}`),
  });

  const fetcher = new RangeFetcher({
    url: mediaUrl,
    chunkSize: 4 * 1024 * 1024,
    onChunk: (offset, bytes) => { demuxer.appendChunk(offset, bytes); },
    onError: (e) => showError(`Fetch error: ${e.message}`),
    onDone: () => { demuxer.flush(); video?.flush().catch(() => {}); },
  });
  fetcher.start();

  playPauseBtn?.addEventListener('click', async () => {
    if (!started) {
      if (audio) await audio.start();
      if (video) video.start();
      for (const c of pendingVideo) video?.feed(c);
      for (const c of pendingAudio) audio?.feed(c);
      pendingVideo = [];
      pendingAudio = [];
      started = true;
      if (playPauseBtn) playPauseBtn.textContent = 'Pause';
      log('Playing');
      return;
    }
    // Toggle pause: stop visual clock (audio resume/suspend handles audio).
    paused = !paused;
    if (paused) {
      video?.stop();
      if (audio) await audio.ctx.suspend();
      if (playPauseBtn) playPauseBtn.textContent = 'Play';
    } else {
      if (audio) await audio.ctx.resume();
      video?.start();
      if (playPauseBtn) playPauseBtn.textContent = 'Pause';
    }
  });

  volumeBtn?.addEventListener('click', () => {
    muted = !muted;
    if (audio) {
      const ctx = audio.ctx;
      const worklet = audio.worklet;
      if (worklet) {
        if (muted) worklet.disconnect();
        else worklet.connect(ctx.destination);
      }
    }
    if (volumeBtn) volumeBtn.textContent = muted ? '🔇' : '🔊';
  });

  seekEl?.addEventListener('input', () => { seekingByUser = true; });
  seekEl?.addEventListener('change', () => {
    if (!seekEl || duration <= 0) { seekingByUser = false; return; }
    const target = (Number(seekEl.value) / 1000) * duration;
    const { videoByteOffset } = demuxer.seek(target);
    video?.reset();
    fetcher.seek(videoByteOffset);
    seekingByUser = false;
  });

  // Time/seek update loop
  setInterval(() => {
    if (!started) return;
    const t = getTimeSec();
    if (timeEl) timeEl.textContent = `${fmt(t)} / ${fmt(duration)}`;
    if (seekEl && !seekingByUser && duration > 0) {
      seekEl.value = String(Math.round((t / duration) * 1000));
    }
  }, 250);
}

main().catch((e) => showError(e instanceof Error ? e.message : String(e)));
