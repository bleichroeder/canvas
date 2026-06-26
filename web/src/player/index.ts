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
  let pendingVideo: EncodedVideoChunk[] = [];
  let pendingAudio: EncodedAudioChunk[] = [];
  let started = false;

  const demuxer = new Demuxer({
    onReady: (info) => {
      if (!info.videoConfig) { showError('No video track found.'); return; }
      log(`Ready: ${info.duration.toFixed(1)}s — tap Play`);
      video = new VideoSink({
        canvas,
        config: info.videoConfig,
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
    if (started) return;
    if (audio) await audio.start();
    if (video) video.start();
    for (const c of pendingVideo) video?.feed(c);
    for (const c of pendingAudio) audio?.feed(c);
    pendingVideo = [];
    pendingAudio = [];
    started = true;
    if (playPauseBtn) playPauseBtn.textContent = 'Pause';
    log('Playing');
  });
}

main().catch((e) => showError(e instanceof Error ? e.message : String(e)));
