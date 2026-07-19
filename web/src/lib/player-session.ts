import { useSyncExternalStore } from 'react';

// Global playback session, deliberately OUTSIDE the router so the player
// survives navigation. PlayerHost (mounted once, above the routed tree) renders
// the actual player from this state; views open/close/resize it through the
// functions below instead of mounting the player themselves.
//
// mode:
//   'full'  — fullscreen player (the /play route)
//   'mini'  — docked corner player, keeps playing while the user browses
//   'embed' — sized into a host slot (the YouTube watch view)

export type PlayerMode = 'full' | 'mini' | 'embed';

export interface PlayerSession {
  source: string;
  id: string;
  fromSec: number;
  mode: PlayerMode;
  /** Bumped on every openPlayer so re-opening the SAME item forces a fresh boot. */
  nonce: number;
}

let session: PlayerSession | null = null;
const listeners = new Set<() => void>();
function emitChange(): void { for (const l of listeners) l(); }

/** Key that identifies one playable item's lifecycle; changing it re-boots the player. */
export function sessionKey(s: PlayerSession): string {
  return `${s.source}::${s.id}::${s.nonce}`;
}

export function getPlayerSession(): PlayerSession | null {
  return session;
}

/**
 * Start (or switch to) an item. If the same source+id is already open, this is
 * a no-op except for the requested mode — so expanding a mini-player back to
 * full doesn't tear down and re-boot the running stream.
 */
export function openPlayer(source: string, id: string, opts?: { fromSec?: number; mode?: PlayerMode }): void {
  const mode = opts?.mode ?? 'full';
  if (session && session.source === source && session.id === id) {
    if (session.mode !== mode) { session = { ...session, mode }; emitChange(); }
    return;
  }
  session = { source, id, fromSec: Math.max(0, Math.floor(opts?.fromSec ?? 0)), mode, nonce: (session?.nonce ?? 0) + 1 };
  emitChange();
}

/** Reposition the running player without touching the stream. */
export function setPlayerMode(mode: PlayerMode): void {
  if (session && session.mode !== mode) { session = { ...session, mode }; emitChange(); }
}

/** Tear the player down entirely. */
export function closePlayer(): void {
  if (session !== null) { session = null; emitChange(); }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function usePlayerSession(): PlayerSession | null {
  return useSyncExternalStore(subscribe, getPlayerSession, getPlayerSession);
}
