import { PlayerInstance } from '../views/Player';
import { usePlayerSession, sessionKey } from '../lib/player-session';

// Renders the one persistent player from the global session store. Mounted once,
// above the router, so playback survives navigation. Keying on the session's
// item (source/id/nonce) gives clean per-item boot/teardown, while mode changes
// (full ↔ mini ↔ embed) reposition the SAME instance without re-mounting.
export function PlayerHost() {
  const session = usePlayerSession();
  if (!session) return null;
  return (
    <PlayerInstance
      key={sessionKey(session)}
      source={session.source}
      id={session.id}
      fromSec={session.fromSec}
      mode={session.mode}
    />
  );
}
