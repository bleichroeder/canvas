import { RangeFetcher } from './range-fetcher';

const status = document.getElementById('status');
const params = new URLSearchParams(location.search);
const testUrl = params.get('url');

if (testUrl) {
  let total = 0;
  const fetcher = new RangeFetcher({
    url: testUrl,
    chunkSize: 1 * 1024 * 1024,
    onChunk: (offset, bytes) => {
      total += bytes.length;
      if (status) status.textContent = `Fetched ${(total / 1024 / 1024).toFixed(2)} MiB at ${offset}`;
    },
    onError: (e) => { if (status) status.textContent = `Error: ${e.message}`; },
    onDone: () => { if (status) status.textContent = `Done. Total ${(total / 1024 / 1024).toFixed(2)} MiB`; },
  });
  fetcher.start();
  setTimeout(() => fetcher.abort(), 10_000);
} else {
  if (status) status.textContent = 'Player ready (pass ?url=... to test fetcher)';
}
