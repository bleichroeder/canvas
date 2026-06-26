import { RangeFetcher } from './range-fetcher';
import { Demuxer } from './demux';

const status = document.getElementById('status');
const params = new URLSearchParams(location.search);
const testUrl = params.get('url');

function log(msg: string): void {
  if (status) status.textContent = msg;
  console.log('[passenger]', msg);
}

if (testUrl) {
  let videoCount = 0;
  let audioCount = 0;
  const demuxer = new Demuxer({
    onReady: (info) => {
      log(`Ready: ${info.duration.toFixed(1)}s, video=${info.videoConfig?.codec}, audio=${info.audioConfig?.codec}`);
      console.log('demux info', info);
    },
    onVideoSample: () => { videoCount++; },
    onAudioSample: () => { audioCount++; },
    onError: (e) => { log(`Demux error: ${e.message}`); },
  });
  const fetcher = new RangeFetcher({
    url: testUrl,
    chunkSize: 2 * 1024 * 1024,
    onChunk: (offset, bytes) => { demuxer.appendChunk(offset, bytes); },
    onError: (e) => { log(`Fetch error: ${e.message}`); },
    onDone: () => { log(`Done. video samples=${videoCount}, audio samples=${audioCount}`); demuxer.flush(); },
  });
  fetcher.start();
  setInterval(() => {
    log(`Samples: video=${videoCount}, audio=${audioCount}`);
  }, 1000);
} else {
  log('Player ready (pass ?url=... to test)');
}
