import { getApiBase, authHeaders, getToken } from './config';

interface QueueItem {
  id: string;
  url: string;
  title: string;
  addedAt: number;
}

const root = document.getElementById('queue-root');

const POLL_OK_MS = 3000;
const POLL_BACKOFF_MAX_MS = 60_000;

function relativeTime(t: number): string {
  const seconds = Math.floor((Date.now() - t) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
  );
}

function render(state:
  | { kind: 'config-missing' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; items: QueueItem[] }): void {
  if (!root) return;
  if (state.kind === 'config-missing') {
    root.innerHTML = `<p>No Worker URL or token configured. <a href="/settings.html">Open Settings</a>.</p>`;
    return;
  }
  if (state.kind === 'loading') {
    root.innerHTML = `<p class="muted">Loading…</p>`;
    return;
  }
  if (state.kind === 'error') {
    root.innerHTML = `<p style="color:var(--danger)">Error: ${escapeHtml(state.message)}</p>`;
    return;
  }
  if (state.items.length === 0) {
    root.innerHTML = `<p class="muted">Queue is empty. Use the bookmarklet to add something.</p>`;
    return;
  }
  root.innerHTML = state.items
    .map(
      (it) => `
      <a href="/player.html?id=${encodeURIComponent(it.id)}"
         style="display:block;background:var(--row);padding:14px 16px;border-radius:8px;margin-bottom:8px;color:var(--fg);">
        <div style="font-weight:600">${escapeHtml(it.title)}</div>
        <div class="muted" style="font-size:13px;margin-top:4px">${relativeTime(it.addedAt)}</div>
      </a>`,
    )
    .join('');
}

let consecutiveErrors = 0;

async function fetchQueueOnce(): Promise<boolean> {
  const base = getApiBase();
  const token = getToken();
  if (!base || !token) { render({ kind: 'config-missing' }); return false; }
  try {
    const res = await fetch(`${base}/api/queue`, { headers: authHeaders() });
    if (!res.ok) {
      let detail = '';
      try { detail = ' — ' + (await res.text()).slice(0, 200); } catch { /* ignore */ }
      render({ kind: 'error', message: `HTTP ${res.status}${detail}` });
      return false;
    }
    const items: QueueItem[] = await res.json();
    render({ kind: 'ok', items });
    return true;
  } catch (e) {
    render({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

let timer: number | undefined;
let stopped = false;

function scheduleNext(delayMs: number): void {
  if (stopped) return;
  timer = window.setTimeout(tick, delayMs);
}

async function tick(): Promise<void> {
  const ok = await fetchQueueOnce();
  if (ok) {
    consecutiveErrors = 0;
    scheduleNext(POLL_OK_MS);
  } else {
    consecutiveErrors++;
    const backoff = Math.min(POLL_BACKOFF_MAX_MS, POLL_OK_MS * 2 ** Math.min(consecutiveErrors - 1, 5));
    scheduleNext(backoff);
  }
}

function startPolling(): void {
  if (timer !== undefined) return;
  stopped = false;
  void tick();
}
function stopPolling(): void {
  stopped = true;
  if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
}

render({ kind: 'loading' });
startPolling();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling(); else startPolling();
});
