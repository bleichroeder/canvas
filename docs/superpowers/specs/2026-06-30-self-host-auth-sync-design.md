# Self-Host Auth + Sync Design (sub-project B)

**Status:** Approved 2026-06-30. Implementation lives on branch `self-host-auth` off `self-host-server-port`.

**Goal:** Replace Supabase (which currently handles both authentication and source-sync) with native server-managed auth + sync. After this lands, a self-hosted canvas instance is fully independent of any third-party cloud service except the upstream media providers (Plex, Flixify).

**Scope context:** Sub-project B of the self-host roadmap. Builds on sub-project A's Bun + Hono + Drizzle + SQLite server. Frontend continues to point at `VITE_CANVAS_API` (the local server URL); the Supabase project is decommissioned only after this sub-project's frontend changes ship.

## Architecture

**Auth model — claim tokens + device sessions.** Server boots with no users → generates a one-time admin claim token and prints it to stdout (also written to a sentinel file for non-tty installs). Whoever redeems that token becomes the sole admin. Admin creates additional users from a Settings → Users screen; each new user gets their own claim token. Devices redeem a claim token once to receive a long-lived **bearer** (random URL-safe ~16-byte string), stored in `localStorage`. Every authenticated request carries `Authorization: Bearer <token>`. No passwords, no emails, no OAuth, no third-party identity providers.

**Why this and not email+password:** Plex-style claim tokens are simpler for self-hosters (no SMTP setup, no password reset flow), Tesla-browser friendly (no autofill/keyboard issues), and the security model is tighter (no password-stuffing surface). The trade-off is admin-mediated user creation — there's no public sign-up. Since canvas is a personal household server, this is the right trade-off.

**Source model — server pool + per-user ACL.** Single server-wide pool of paired sources. ACL junction table grants per-user access. Admin has implicit access to all sources (not stored in ACL). Default-deny for new sources: when admin pairs Plex, only admin sees it until they explicitly grant via Settings → Users → grant. Members who pair their own sources auto-get access to what they paired. Admin sees all and can grant to or revoke from anyone.

**Big shift from sub-project A.** The `x-sources` HTTP header — the contract A established — goes away entirely. Auth middleware looks up the user from the bearer; route handlers load that user's accessible sources from DB and dispatch as before. Server becomes the source of truth for which sources a user can see; clients can no longer tamper with their own ACL by editing localStorage. Every sub-project-A route gets a small refactor: `parseXSources(c.req.raw)` → `getUserSources(db, ctx.userId)` returning the same `Record<srcKey, ParsedSource>` shape. Per-source dispatch logic (`callPerSource`, `callOneSource`) is unchanged. `srcKey` in path-based routes becomes `String(sources.id)`.

**Roles.** Exactly two: `admin` (singleton — the user who redeemed the bootstrap claim token) and `member` (any number). Admin can create/delete users, regenerate claim tokens, grant/revoke source access, see all devices, delete any source. Members can pair sources for themselves (auto-granted), browse/play their granted sources, manage their own device list, NOT modify users or other users' access. The admin role itself cannot be transferred or demoted in v1 — keeps the model simple; a future "rotate admin" admin flow is a follow-up.

**Admin protections.** Admin cannot delete themselves (`DELETE /api/admin/users/:id` returns 409 when `:id` is the calling admin's user_id). The admin row cannot be deleted by anyone (same 409 if a hypothetical second admin tried, but the partial unique index in the schema makes a second admin impossible anyway). Re-bootstrapping (e.g., if the admin's credentials are lost) requires editing the SQLite DB directly — accepted v1 limitation.

## Schema (5 new tables alongside sub-project-A's two)

```sql
-- Local user accounts on this canvas server.
CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,                       -- display name
  role       TEXT NOT NULL CHECK (role IN ('admin','member')),
  created_at INTEGER NOT NULL
);
-- DB-enforced singleton: at most one admin row. Insert-blocking guard rail
-- (the API enforces this too; defense in depth).
CREATE UNIQUE INDEX users_admin_singleton ON users(role) WHERE role = 'admin';

-- One-shot tokens that bind a device to a user. Admin creates one per
-- invited user; first-run server seeds one for the admin and logs it.
CREATE TABLE claim_tokens (
  token      TEXT PRIMARY KEY,                    -- random urlsafe ~16 bytes (the user types this)
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,                    -- typically created_at + 24h
  used_at    INTEGER                              -- NULL until redeemed; one-shot
);
CREATE INDEX claim_tokens_expires ON claim_tokens(expires_at);

-- One row per paired device. The bearer the client stores is the preimage of
-- token_hash; we never persist the bearer itself.
CREATE TABLE device_sessions (
  token_hash   TEXT PRIMARY KEY,                  -- sha256(bearer) hex
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label TEXT NOT NULL,                     -- "Tesla", "Phone", "Desktop"
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL                   -- bumped on every authenticated request
);
CREATE INDEX device_sessions_user ON device_sessions(user_id);

-- Server-wide source pool. Replaces both the localStorage source map and the
-- Supabase user_sources blob entirely.
CREATE TABLE sources (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  type              TEXT NOT NULL CHECK (type IN ('plex','flixify')),
  base_url          TEXT NOT NULL,
  token             TEXT NOT NULL,                -- upstream auth (Plex token / Flixify cookies)
  label             TEXT NOT NULL,
  paired_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- nullable so deleting a user doesn't take their sources with them
  created_at        INTEGER NOT NULL
);

-- ACL junction. Admin's access is implicit and NOT stored here.
CREATE TABLE user_source_access (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, source_id)
);
```

**Notes on the choices.** `sources.token` holds the upstream auth verbatim (same value Supabase had). Stored at rest in the SQLite file — not encrypted at this layer. Could add app-level encryption later. `paired_by_user_id` is informational and lets non-admins delete their own pairings without admin involvement. No admin row in ACL — admin role implies access in code; this keeps the grant/revoke API simple and avoids "demoted admin loses their own sources" edge cases (which can't happen in v1 anyway since admin can't be demoted, but the model survives future expansion). The reaper gets one extra sweep: `DELETE FROM claim_tokens WHERE expires_at < ? AND used_at IS NULL` so used tokens stay until the user is deleted. `srcKey` in path-based routes becomes `String(sources.id)` — an opaque-to-frontend integer.

## API surface

All endpoints are JSON unless noted. `/health` and `POST /api/auth/claim` are public; everything else requires `Authorization: Bearer <token>`. Admin-only endpoints are tagged.

```
# Auth
POST   /api/auth/claim                          { token, deviceLabel }
                                                → { bearer, user: { id, label, role } }
GET    /api/auth/me                             → { user, devices: [{ id, label, lastSeenAt, current }] }
POST   /api/auth/logout                         → 204  (revokes calling bearer)
DELETE /api/auth/devices/:id                    → 204  (revoke another of MY devices)

# Admin — gated by role='admin'
GET    /api/admin/users                         → [{ id, label, role, deviceCount, sourceAccessCount }]
POST   /api/admin/users          { label }      → { user, claimToken }
DELETE /api/admin/users/:id                     → 204
POST   /api/admin/users/:id/claim-token         → { claimToken }   (regenerate)
POST   /api/admin/users/:id/sources/:sourceId   → 204              (grant)
DELETE /api/admin/users/:id/sources/:sourceId   → 204              (revoke)

# Sources — authenticated; admin sees all, members see ACL-filtered
GET    /api/sources                             → [{ id, type, baseUrl, label, pairedBy }]
DELETE /api/sources/:id                         → 204  (admin OR original pairer)
```

The existing sub-project-A endpoints (`/api/pair/*`, `/api/home`, `/api/source-home`, `/api/library/*`, `/api/item/*`, `/api/search`, `/api/play/*`, `/api/progress/*`, `/api/source-status`, `/api/subtitles`) all stay; their input/output JSON shapes are unchanged. What changes is HOW they get the source map: instead of reading the `x-sources` request header, they read the authenticated user's accessible sources from DB.

## Auth middleware

A new `requireUser` Hono middleware runs before every `/api/*` route except `/api/auth/claim` and `/health`:

1. Read `Authorization: Bearer <token>` header. Missing → 401.
2. Compute `sha256(token)`.
3. SELECT user_id, device_id from `device_sessions` WHERE `token_hash` = ?. Miss → 401.
4. JOIN to `users` to fetch role.
5. Attach `{ userId, role, deviceId }` to the Hono context.
6. UPDATE `device_sessions` SET `last_seen_at` = nowSec() WHERE token_hash = ?. (Fire-and-forget — don't await; doesn't gate the response.)

Admin-only endpoints add a second middleware that checks `ctx.role === 'admin'` and 403s otherwise.

**Pair-flow auth.** `/api/pair/*` is authenticated too — the user pairing a source has to be identified so the new source can be `paired_by_user_id`'d to them. The pair endpoints stay as they are except `/api/pair/approve` (and the equivalent path in `/api/pair/flixify-poll`) now also INSERTs a row into `sources` with the calling user's id and a row into `user_source_access` granting that user access. `/api/pair/poll` returns the new source's `id` in the response so the frontend can immediately request it.

## Bootstrap UX

On first boot (no rows in `users`):
1. Server generates an admin user with `label = 'Admin'` and `role = 'admin'`.
2. Server generates a claim token for that user with `expires_at = created_at + 24h`.
3. Server prints the token prominently to stdout:
   ```
   ┌──────────────────────────────────────────────────────────┐
   │  FIRST-RUN ADMIN CLAIM TOKEN (expires in 24h):           │
   │                                                          │
   │      ABCD-EFGH-IJKL-MNOP                                 │
   │                                                          │
   │  Enter this token on your first device to become admin.  │
   └──────────────────────────────────────────────────────────┘
   ```
4. Server ALSO writes the token to `${CANVAS_DB_DIR}/admin-claim-token.txt` so non-tty installs (Docker logs etc.) can grep it out of a file mount.
5. If the token expires before redemption, next server boot detects the situation (admin user exists, no unused claim tokens, no device sessions for admin) and emits a fresh one.

After redemption, the admin lands in the canvas UI signed in. The Settings → Users screen lets them create additional users. Each newly-created user produces a claim token shown in the UI (with a "regenerate" button if it gets lost or expires).

## Frontend impact

- **Sign-in screen** — replaces the Supabase email/password + Google form. Just two fields: `Claim token: ____` + `Name this device: ____`. POSTs to `/api/auth/claim`, stores the returned bearer + `user` payload in localStorage. No password reset, no email confirmation.
- **API client (`web/src/api.ts`)** — drops the `x-sources` header construction entirely. Adds `Authorization: Bearer ${bearer}` from localStorage to every request. On 401, clears localStorage and bounces to sign-in.
- **Sources management UI** — the existing "Sources" tab in Settings stays but now fetches from `GET /api/sources` instead of reading localStorage. Pairing flow is unchanged from the user's perspective (QR + 6-digit code) — the only difference is that the source persists server-side instead of in `user_sources` blob.
- **New: Users management UI (admin only)** — Settings → Users screen with a table of users, "Add user" button (label only; server generates token), per-row "Manage" panel showing claim-token, paired devices, and source-access toggles (one row per source in the server pool, checkbox per user).
- **New: Devices section in Settings** — shows the current user's paired devices with last-seen timestamps and a revoke button per row.
- **Supabase removal** — `@supabase/supabase-js` dependency dropped from `web/package.json`. `lib/cloud-sync.ts`, `lib/auth.ts`, `views/SignIn.tsx`'s Supabase paths, `views/AuthCallback.tsx` all deleted. `.env.example` loses the Supabase vars.

## Out of scope

- **Real-time cross-device sync.** v1 has each device refetch `/api/sources` on focus and after pair-flow approval. WebSocket push for multi-device "source added on phone, instantly visible on Tesla" is a follow-up if the polling approach feels laggy in practice.
- **Migration from existing Supabase user_sources.** Self-host is greenfield per instance. Users transitioning from the hosted canvas re-pair their sources once. (David's own deployed canvas will still use Supabase until sub-project D's prod migration anyway.)
- **Per-folder access within a source.** A user with access to a Plex source sees everything in that Plex. Restricting kids to specific library sections within a paired Plex is a follow-up.
- **Demote-admin / rotate-admin flow.** v1 has a permanent singleton admin. Re-bootstrapping requires editing the DB directly. Acceptable for v1.
- **Magic-link / OAuth / passkey alternatives.** Claim tokens only.
- **Rate-limiting on claim-token attempts.** Claim tokens have enough entropy (~16 bytes ≈ 128 bits) that brute-forcing isn't realistic; we won't bother with rate-limit middleware. If we ever add weaker secondary auth, this changes.
- **Server-side encryption of source.token at rest.** Same posture as Supabase had — plaintext in DB. A future hardening pass can wrap with libsodium secretbox keyed by an env var.
- **Open-source release work.** Sub-project E.
- **TLS / Docker / domain.** Sub-projects C/D.

## Success criteria

1. Fresh server boot: admin claim token printed to stdout AND written to `admin-claim-token.txt`.
2. `POST /api/auth/claim` with the token returns a bearer; subsequent authenticated requests succeed.
3. Admin can create a second user from the UI; that user's claim token works for their devices but their bearer can't see admin endpoints (403).
4. Admin can pair a new Plex source; member user can't see it until admin grants access; after grant, member's `GET /api/sources` includes it and they can browse.
5. Member pairs their own source — they immediately see it; admin sees it in the admin source list.
6. All sub-project-A tests still pass after the x-sources → DB migration (the integration points change, but the response shapes don't).
7. Frontend `web/` runs without `@supabase/supabase-js` in `package.json`.
8. End-to-end smoke: claim → pair Plex → browse → play → progress → second device pairs same claim user → both devices see the same library on `/api/sources` after refresh.
