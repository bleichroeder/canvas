import { getSupabase } from './supabase';
import { getSources, setSources, SOURCES_EVENT } from '../storage';
import type { StoredSource } from '../storage';

type SourcesMap = Record<string, StoredSource>;

interface SyncState {
  // True when the initial cloud hydration is in flight (used by Settings/UI
  // to hide stale state before the cloud overwrite lands).
  hydrating: boolean;
}

const state: SyncState = { hydrating: false };
const STATE_EVENT = 'canvas:cloudSyncState';

export function getCloudSyncState(): SyncState {
  return state;
}

export const CLOUD_SYNC_EVENT = STATE_EVENT;

function emitState() {
  window.dispatchEvent(new Event(STATE_EVENT));
}

async function pullCloud(userId: string): Promise<SourcesMap | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('user_sources')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('cloud-sync pull failed:', error.message);
    return null;
  }
  if (!data) return null;
  const blob = (data as { data?: unknown }).data;
  return blob && typeof blob === 'object' ? (blob as SourcesMap) : {};
}

async function pushCloud(userId: string, sources: SourcesMap): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from('user_sources')
    .upsert({ user_id: userId, data: sources }, { onConflict: 'user_id' });
  if (error) console.warn('cloud-sync push failed:', error.message);
}

let currentUserId: string | null = null;
let pushDebounce: number | undefined;

function schedulePush() {
  if (!currentUserId) return;
  if (pushDebounce) clearTimeout(pushDebounce);
  pushDebounce = window.setTimeout(() => {
    if (!currentUserId) return;
    void pushCloud(currentUserId, getSources());
  }, 400);
}

/**
 * Reconcile local + cloud sources on sign-in. Cloud always wins:
 *   - cloud has data → adopt cloud (overwrites local)
 *   - cloud empty, local has data → push local up (first-time migration)
 *   - both empty → no-op
 */
async function reconcileOnSignIn(userId: string): Promise<void> {
  state.hydrating = true;
  emitState();
  try {
    const cloud = await pullCloud(userId);
    const cloudKeys = cloud ? Object.keys(cloud) : [];
    if (cloudKeys.length > 0) {
      setSources(cloud!);
      return;
    }
    const local = getSources();
    if (Object.keys(local).length > 0) {
      await pushCloud(userId, local);
    }
  } finally {
    state.hydrating = false;
    emitState();
  }
}

/**
 * Wires the cloud-sync lifecycle. Call once at app boot.
 *   - Subscribes to Supabase auth changes
 *   - On sign-in: reconciles local vs cloud (see reconcileOnSignIn)
 *   - On sign-out: clears the active user (local sources untouched)
 *   - On SOURCES_EVENT while signed-in: pushes updated map to cloud (debounced)
 */
export function startCloudSync(): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  const onSources = () => schedulePush();
  window.addEventListener(SOURCES_EVENT, onSources);
  const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
    const nextUserId = session?.user?.id ?? null;
    if (nextUserId && nextUserId !== currentUserId) {
      currentUserId = nextUserId;
      // SIGNED_IN fires both on fresh sign-in and on session restore; reconcile
      // in either case so a returning device picks up the latest cloud state.
      // CRITICAL: do NOT await supabase calls inside this callback — supabase-js
      // holds an internal auth lock while the callback runs, and any sb.*() call
      // here (PostgREST query, getSession, signOut, etc.) queues behind that lock
      // and deadlocks the entire client. Defer the reconcile to a microtask so
      // the callback returns first and the lock is released.
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        setTimeout(() => void reconcileOnSignIn(nextUserId), 0);
      }
    } else if (!nextUserId) {
      const wasSignedIn = currentUserId !== null;
      // Null currentUserId BEFORE clearing local sources so the SOURCES_EVENT
      // that fires from setSources() doesn't try to push the empty map up.
      currentUserId = null;
      // Local sources belong to whichever user just signed out — clear them
      // so the next sign-in starts from a clean slate (cloud will hydrate).
      if (wasSignedIn && Object.keys(getSources()).length > 0) {
        setSources({});
      }
    }
  });
  // Cover the case where session is already present at boot — onAuthStateChange
  // doesn't always fire INITIAL_SESSION on hot reloads.
  sb.auth.getSession().then(({ data }) => {
    if (data.session?.user && !currentUserId) {
      currentUserId = data.session.user.id;
      void reconcileOnSignIn(currentUserId);
    }
  });
  return () => {
    window.removeEventListener(SOURCES_EVENT, onSources);
    sub.subscription.unsubscribe();
  };
}
