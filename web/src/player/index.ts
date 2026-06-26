import { RangeFetcher } from './range-fetcher';
import { Demuxer } from './demux';
import { VideoSink } from './video';
import { getApiBase, authHeaders } from '../config';

interface QueueItem { id: string; url: string; title: string; addedAt: number; }

const status = document.getElementById('status');
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const errorEl = document.getElementById('error');

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

  log(`Loading: ${title}`);

  let video: VideoSink | null = null;

  const demuxer = new Demuxer({
    onReady: (info) => {
      if (!info.videoConfig) { showError('No video track found.'); return; }
      log(`Ready: ${info.duration.toFixed(1)}s — decoding…`);
      video = new VideoSink({
        canvas,
        config: info.videoConfig,
        onError: (e) => showError(`Video decode error: ${e.message}`),
      });
      video.start();
    },
    onVideoSample: (chunk) => { video?.feed(chunk); },
    onAudioSample: () => { /* audio in next task */ },
    onError: (e) => showError(`Demux error: ${e.message}`),
  });

  const fetcher = new RangeFetcher({
    url: mediaUrl,
    chunkSize: 4 * 1024 * 1024,
    onChunk: (offset, bytes) => { demuxer.appendChunk(offset, bytes); },
    onError: (e) => showError(`Fetch error: ${e.message}`),
    onDone: () => { demuxer.flush(); log('Stream complete'); },
  });
  fetcher.start();
}

main().catch((e) => showError(e instanceof Error ? e.message : String(e)));
