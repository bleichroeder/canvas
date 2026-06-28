import { getSupabase } from './supabase';
import { getSources, setSources, SOURCES_EVENT } from '../storage';
import type { StoredSource } from '../storage';

type SourcesMap = Record<string, StoredSource>;

interface SyncState {
  // True when a local-vs-cloud conflict needs the user to choose. UI reads
  // this and renders a Dialog; user resolution dispatches CONFLICT_EVENT.
  conflict: { local: SourcesMap; cloud: SourcesMap } | null;
  // True when the initial cloud hydration is in flight (used by Settings/UI
  // to hide stale state before the cloud overwrite lands).
  hydrating: boolean;
}

const state: SyncState = { conflict: null, hydrating: false };
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
 * Reconcile local + cloud sources on sign-in. Three branches:
 *   - cloud empty                → push local up (could also be empty; no-op)
 *   - cloud has data, local empty → adopt cloud (overwrites local)
 *   - both have data              → set conflict state; UI prompts user
 */
async function reconcileOnSignIn(userId: string): Promise<void> {
  state.hydrating = true;
  emitState();
  try {
    const cloud = await pullCloud(userId);
    const local = getSources();
    const localKeys = Object.keys(local);
    const cloudKeys = cloud ? Object.keys(cloud) : [];
    if (cloudKeys.length === 0) {
      if (localKeys.length > 0) await pushCloud(userId, local);
      return;
    }
    if (localKeys.length === 0) {
      setSources(cloud!);
      return;
    }
    // Both populated — keep both local + cloud snapshots, let UI ask.
    state.conflict = { local, cloud: cloud! };
  } finally {
    state.hydrating = false;
    emitState();
  }
}

export async function resolveConflictUseCloud(): Promise<void> {
  if (!state.conflict) return;
  setSources(state.conflict.cloud);
  state.conflict = null;
  emitState();
}

export async function resolveConflictUseLocal(): Promise<void> {
  if (!state.conflict || !currentUserId) return;
  await pushCloud(currentUserId, state.conflict.local);
  state.conflict = null;
  emitState();
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
      if (state.conflict) {
        state.conflict = null;
        emitState();
      }
      // Local sources belong to whichever user just signed out — leaving them
      // behind makes the next sign-in pop a conflict dialog comparing two
      // different accounts' libraries.
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
