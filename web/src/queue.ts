import { getApiBase, authHeaders, getToken } from './config';

interface QueueItem {
  id: string;
  url: string;
  title: string;
  addedAt: number;
}

const root = document.getElementById('queue-root');

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

async function fetchQueue(): Promise<void> {
  const base = getApiBase();
  const token = getToken();
  if (!base || !token) { render({ kind: 'config-missing' }); return; }
  try {
    const res = await fetch(`${base}/api/queue`, { headers: authHeaders() });
    if (!res.ok) { render({ kind: 'error', message: `HTTP ${res.status}` }); return; }
    const items: QueueItem[] = await res.json();
    render({ kind: 'ok', items });
  } catch (e) {
    render({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

let timer: number | undefined;
function startPolling(): void {
  fetchQueue();
  timer = window.setInterval(fetchQueue, 3000);
}
function stopPolling(): void {
  if (timer !== undefined) { clearInterval(timer); timer = undefined; }
}

render({ kind: 'loading' });
startPolling();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling(); else startPolling();
});

