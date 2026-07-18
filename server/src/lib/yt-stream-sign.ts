import { nowSec } from './time';

// Signed URLs for the public YouTube stream route. RangeFetcher (the player's
// network layer) sends no Authorization header, so the stream endpoint can't use
// the bearer middleware — same constraint that makes Plex embed its token in the
// URL. Instead resolveStream (authed) mints a short-lived HMAC-signed URL that
// the stream route verifies, so an unauthenticated party can't drive arbitrary
// yt-dlp/ffmpeg work.

const DEFAULT_TTL_SEC = 6 * 60 * 60; // 6h — comfortably longer than any session.

export interface StreamSigParams {
  from?: string | undefined;
  exp?: string | undefined;
  sig?: string | undefined;
}

export interface StreamSigner {
  /** Build the signed `from=&exp=&sig=` query string for a video. */
  signQuery(videoId: string, fromSec: number, ttlSec?: number): Promise<string>;
  /** Verify query params against the videoId; false if tampered, expired, or missing. */
  verify(videoId: string, params: StreamSigParams): Promise<boolean>;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Payload is built from string parts so the bytes signed exactly match the bytes
// carried in the query — no number formatting can drift between sign and verify.
const payloadOf = (videoId: string, from: string, exp: string) => [videoId, from, exp].join('|');

export function makeStreamSigner(secret: string, deps?: { now?: () => number }): StreamSigner {
  const now = deps?.now ?? nowSec;

  return {
    async signQuery(videoId, fromSec, ttlSec = DEFAULT_TTL_SEC) {
      const from = String(Math.max(0, Math.floor(fromSec)));
      const exp = String(now() + ttlSec);
      const sig = await hmacHex(secret, payloadOf(videoId, from, exp));
      return `from=${from}&exp=${exp}&sig=${sig}`;
    },

    async verify(videoId, params) {
      const { from, exp, sig } = params;
      if (!from || !exp || !sig) return false;
      const expNum = Number(exp);
      if (!Number.isFinite(expNum) || expNum < now()) return false;
      const expected = await hmacHex(secret, payloadOf(videoId, from, exp));
      return timingSafeEqual(expected, sig);
    },
  };
}
