# Self-Host Passwords Implementation Plan (sub-project B.1)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Add password-based sign-in to sub-project B. Sign out becomes reversible via `label + password`. Claim tokens narrow to bootstrap + admin-invite paths.

**Architecture:** One migration (`password_hash TEXT` on `users`). Four new/modified server endpoints. Two new frontend views (SignIn, SetPassword) + modifications to Claim, Users, Account. `Bun.password.hash/verify` — no new deps.

**Tech stack:** Bun 1.1+ built-in argon2 via `Bun.password.*`. Everything else inherited from sub-project B.

## Global Constraints

- **Branch:** `self-host-auth` (already current, tip `6a6d5f3`). Lands BEFORE the merge into `self-host-server-port`.
- **B's tests stay green:** every sub-project-B test file continues passing. New tests get added; none removed.
- **Password hashing:** `Bun.password.hash(pw)` for storage. `Bun.password.verify(pw, hash)` for verification. Both async. Default algorithm is argon2id.
- **Password never logged.** No `logger` call may include the plaintext or the hash.
- **Minimum password length: 8 chars.** Enforced client + server.
- **`user.hasPassword`** derived from `users.password_hash IS NOT NULL`. Returned in `/me` and `/claim` responses. Frontend uses it to route.
- Existing users have `password_hash = NULL` after the migration — they will need to reclaim (admin via bootstrap-recovery, members via admin-reset). Manual acceptable for the current test DB.

## File Structure

**Server (`server/`):**
- Modify: `src/db/schema.ts` — add `password_hash` column
- Create: `drizzle/0002_*.sql` (generated migration)
- Modify: `src/storage/users.ts` — add `setPasswordHash`, `getPasswordHash`
- Modify: `src/routes/auth.ts` — add `/login`, `/set-password`, `/change-password`; extend `/me` + `/claim` response with `hasPassword`
- Modify: `src/routes/admin.ts` — accept optional `password` in `POST /users`; add `POST /users/:id/reset-password`

**Frontend (`web/`):**
- Create: `src/views/SignIn.tsx`, `src/views/SetPassword.tsx`
- Modify: `src/views/Claim.tsx` — post-claim routing based on `hasPassword`
- Modify: `src/views/Users.tsx` — Add User modal gains password field; per-row Reset password
- Modify: `src/views/AccountTab.tsx` (or wherever "Account" lives) — Change password form
- Modify: `src/api.ts` — add `authLogin`, `authSetPassword`, `authChangePassword`, `adminResetPassword`; update `authClaim` + `authMe` return types with `hasPassword`; update `adminCreateUser` to accept optional password
- Modify: `src/lib/session.ts` — `SessionUser` gains `hasPassword: boolean`
- Modify: `src/main.tsx` — unauthenticated default route becomes `/#/sign-in`; `/#/set-password` route added

---

## Task 1: Server — password_hash schema + storage + auth endpoints

**Files:**
- Modify: `server/src/db/schema.ts`
- Create: `server/drizzle/0002_*.sql` (generated)
- Modify: `server/src/storage/users.ts` (+ its test)
- Modify: `server/src/routes/auth.ts` (+ its test)
- Modify: `server/src/routes/admin.ts` (+ its test)

**Interfaces produced:**
- Storage: `setPasswordHash(db, userId, hash)`, `getPasswordHash(db, userId): string | null`
- Routes: `POST /api/auth/login`, `POST /api/auth/set-password`, `POST /api/auth/change-password`, `POST /api/admin/users/:id/reset-password`
- Response shape change: `/api/auth/me` and `/api/auth/claim` include `user.hasPassword: boolean`
- `POST /api/admin/users` accepts optional `password`; response omits `claimToken` when password is provided

- [ ] **Step 1: Schema — add `password_hash` column**

In `server/src/db/schema.ts`, extend the `users` table definition:

```ts
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    label: text('label').notNull(),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    passwordHash: text('password_hash'),      // <-- NEW; nullable
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    adminSingleton: uniqueIndex('users_admin_singleton')
      .on(t.role)
      .where(sql`${t.role} = 'admin'`),
  }),
);
```

Run:
```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
bun run db:generate
```

Confirm the generated `drizzle/0002_*.sql` contains `ALTER TABLE users ADD COLUMN password_hash TEXT;` and nothing else destructive.

- [ ] **Step 2: Storage helpers**

Add to `server/src/storage/users.ts`:

```ts
export function setPasswordHash(db: Db, userId: number, hash: string): void {
  db.update(users).set({ passwordHash: hash }).where(eq(users.id, userId)).run();
}

export function getPasswordHash(db: Db, userId: number): string | null {
  const row = db.select({ h: users.passwordHash }).from(users).where(eq(users.id, userId)).get();
  return row?.h ?? null;
}
```

Add to `server/src/storage/users.test.ts`:

```ts
test('setPasswordHash + getPasswordHash round trip', () => {
  const u = createUser(db, { label: 'X', role: 'member' });
  expect(getPasswordHash(db, u.id)).toBeNull();
  setPasswordHash(db, u.id, 'argon2-hash-here');
  expect(getPasswordHash(db, u.id)).toBe('argon2-hash-here');
});
```

- [ ] **Step 3: Auth routes — add `hasPassword`, `login`, `set-password`, `change-password`**

Open `server/src/routes/auth.ts`.

Add imports:
```ts
import { setPasswordHash, getPasswordHash } from '../storage/users';
import { deleteUserDeviceSessions } from '../storage/device-sessions';
```

Modify the existing `/claim` handler's success response to include `hasPassword`:
```ts
const passwordHash = getPasswordHash(getDb(), user.id);
return c.json({
  bearer,
  user: { id: user.id, label: user.label, role: user.role, hasPassword: passwordHash !== null },
});
```

Modify the existing `/me` handler similarly:
```ts
const passwordHash = getPasswordHash(getDb(), user.id);
return c.json({
  user: { id: user.id, label: user.label, role: user.role, hasPassword: passwordHash !== null },
  devices: [...],
});
```

Add new endpoints in the `authed` sub-app (they require `requireUser`):

```ts
// POST /set-password  body: { newPassword }  → 204
authed.post('/set-password', async (c) => {
  const body = await c.req.json().catch(() => null) as { newPassword?: unknown } | null;
  if (!body || typeof body.newPassword !== 'string' || body.newPassword.length < 8) {
    return c.json({ error: 'password must be at least 8 characters' }, 400);
  }
  const auth = getAuthContext(c);
  const existing = getPasswordHash(getDb(), auth.userId);
  if (existing !== null) {
    return c.json({ error: 'password already set; use /change-password' }, 409);
  }
  const hash = await Bun.password.hash(body.newPassword);
  setPasswordHash(getDb(), auth.userId, hash);
  logger.info({ userId: auth.userId }, 'password set (first-time)');
  return c.body(null, 204);
});

// POST /change-password  body: { currentPassword, newPassword }  → 204
// Revokes all OTHER device_sessions; keeps current.
authed.post('/change-password', async (c) => {
  const body = await c.req.json().catch(() => null) as { currentPassword?: unknown; newPassword?: unknown } | null;
  if (!body || typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string' || body.newPassword.length < 8) {
    return c.json({ error: 'currentPassword required and newPassword must be at least 8 characters' }, 400);
  }
  const auth = getAuthContext(c);
  const currentHash = getPasswordHash(getDb(), auth.userId);
  if (currentHash === null) {
    return c.json({ error: 'no password set; use /set-password' }, 409);
  }
  const ok = await Bun.password.verify(body.currentPassword, currentHash);
  if (!ok) return c.json({ error: 'incorrect current password' }, 401);
  const newHash = await Bun.password.hash(body.newPassword);
  setPasswordHash(getDb(), auth.userId, newHash);
  // Revoke other devices — delete all sessions for this user, then leave the current one intact.
  // Simplest correct approach: delete all, then... actually, we need to keep the CURRENT one alive
  // so the calling client doesn't get 401 on its next request. Query for the current row's tokenHash
  // (from auth context), delete all others.
  const currentTokenHash = auth.deviceTokenHash;
  getDb().$client.prepare(
    'DELETE FROM device_sessions WHERE user_id = ? AND token_hash != ?',
  ).run(auth.userId, currentTokenHash);
  logger.info({ userId: auth.userId }, 'password changed; other devices revoked');
  return c.body(null, 204);
});
```

Add the public `/login` endpoint at the top of `makeAuthRoutes` (BEFORE `r.route('/', authed)`):

```ts
// POST /login  body: { label, password, deviceLabel }
r.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null) as { label?: unknown; password?: unknown; deviceLabel?: unknown } | null;
  if (!body || typeof body.label !== 'string' || typeof body.password !== 'string' || typeof body.deviceLabel !== 'string' || body.deviceLabel.length === 0) {
    return c.json({ error: 'label, password, deviceLabel required' }, 400);
  }
  // Look up user by label
  const targetUser = getUserByLabel(getDb(), body.label);
  if (!targetUser) return c.json({ error: 'invalid credentials' }, 401);
  const hash = getPasswordHash(getDb(), targetUser.id);
  if (hash === null) return c.json({ error: 'password not set for this user; use claim flow or ask admin to reset' }, 400);
  const ok = await Bun.password.verify(body.password, hash);
  if (!ok) return c.json({ error: 'invalid credentials' }, 401);
  const bearer = generateBearer();
  const tokenHash = await hashBearer(bearer);
  createDeviceSession(getDb(), { userId: targetUser.id, deviceLabel: body.deviceLabel, tokenHash });
  logger.info({ userId: targetUser.id, deviceLabel: body.deviceLabel }, 'user logged in');
  return c.json({
    bearer,
    user: { id: targetUser.id, label: targetUser.label, role: targetUser.role, hasPassword: true },
  });
});
```

Add `import { getUserByLabel } from '../storage/users';` at the top of the file.

**Constant-time note:** Return the same `'invalid credentials'` message for both "unknown label" and "wrong password" to avoid revealing user existence. `Bun.password.verify` on a real hash is intrinsically slow (~10-100ms), which mitigates timing side channels for the wrong-password case. The unknown-label case returns instantly — technically a timing distinguisher. For the household threat model this is acceptable; if we ever need to harden, run a dummy verify on unknown-label.

- [ ] **Step 4: Auth route tests**

Add to `server/src/routes/auth.test.ts` (extend the existing `describe('auth routes', ...)`):

```ts
test('POST /login with correct credentials returns bearer', async () => {
  const { app, db } = makeApp();
  const u = createUser(db, { label: 'Alice', role: 'admin' });
  setPasswordHash(db, u.id, await Bun.password.hash('correct-horse'));
  const res = await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'correct-horse', deviceLabel: 'Desk' });
  expect(res.status).toBe(200);
  const body = await res.json() as { bearer: string; user: { hasPassword: boolean } };
  expect(body.bearer).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-/);
  expect(body.user.hasPassword).toBe(true);
});

test('POST /login with wrong password returns 401', async () => {
  const { app, db } = makeApp();
  const u = createUser(db, { label: 'Alice', role: 'admin' });
  setPasswordHash(db, u.id, await Bun.password.hash('correct-horse'));
  const res = await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'nope', deviceLabel: 'Desk' });
  expect(res.status).toBe(401);
});

test('POST /login with unknown label returns 401', async () => {
  const { app } = makeApp();
  const res = await jsonPost(app, '/api/auth/login', { label: 'nobody', password: 'x', deviceLabel: 'Desk' });
  expect(res.status).toBe(401);
});

test('POST /login when user has no password returns 400', async () => {
  const { app, db } = makeApp();
  createUser(db, { label: 'Alice', role: 'admin' });
  const res = await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'x', deviceLabel: 'Desk' });
  expect(res.status).toBe(400);
});

test('POST /set-password sets initial password; second call returns 409', async () => {
  const { app, db } = makeApp();
  const u = createUser(db, { label: 'Alice', role: 'admin' });
  const t = createClaimToken(db, u.id, 3600);
  const claim = await (await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'D' })).json() as { bearer: string };
  const res1 = await jsonPost(app, '/api/auth/set-password', { newPassword: 'longenough' }, { authorization: `Bearer ${claim.bearer}` });
  expect(res1.status).toBe(204);
  const res2 = await jsonPost(app, '/api/auth/set-password', { newPassword: 'anotherlongone' }, { authorization: `Bearer ${claim.bearer}` });
  expect(res2.status).toBe(409);
});

test('POST /set-password rejects short passwords', async () => {
  const { app, db } = makeApp();
  const u = createUser(db, { label: 'Alice', role: 'admin' });
  const t = createClaimToken(db, u.id, 3600);
  const claim = await (await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'D' })).json() as { bearer: string };
  const res = await jsonPost(app, '/api/auth/set-password', { newPassword: 'short' }, { authorization: `Bearer ${claim.bearer}` });
  expect(res.status).toBe(400);
});

test('POST /change-password verifies current + revokes other devices', async () => {
  const { app, db } = makeApp();
  const u = createUser(db, { label: 'Alice', role: 'admin' });
  setPasswordHash(db, u.id, await Bun.password.hash('oldpassword'));

  // Sign in twice — two different bearers on two "devices"
  const loginA = await (await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'oldpassword', deviceLabel: 'A' })).json() as { bearer: string };
  const loginB = await (await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'oldpassword', deviceLabel: 'B' })).json() as { bearer: string };

  // Change password from device A
  const chRes = await jsonPost(app, '/api/auth/change-password', { currentPassword: 'oldpassword', newPassword: 'newerpassword' }, { authorization: `Bearer ${loginA.bearer}` });
  expect(chRes.status).toBe(204);

  // Device A's bearer still works
  const meA = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${loginA.bearer}` } }));
  expect(meA.status).toBe(200);
  // Device B is revoked
  const meB = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${loginB.bearer}` } }));
  expect(meB.status).toBe(401);

  // Old password no longer works
  const loginOld = await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'oldpassword', deviceLabel: 'C' });
  expect(loginOld.status).toBe(401);
  // New password works
  const loginNew = await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'newerpassword', deviceLabel: 'C' });
  expect(loginNew.status).toBe(200);
});

test('GET /me includes hasPassword', async () => {
  const { app, db } = makeApp();
  const u = createUser(db, { label: 'Alice', role: 'admin' });
  const t = createClaimToken(db, u.id, 3600);
  const claim = await (await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'D' })).json() as { bearer: string };
  const meRes1 = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${claim.bearer}` } }));
  const me1 = await meRes1.json() as { user: { hasPassword: boolean } };
  expect(me1.user.hasPassword).toBe(false);
  await jsonPost(app, '/api/auth/set-password', { newPassword: 'longenough' }, { authorization: `Bearer ${claim.bearer}` });
  const meRes2 = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${claim.bearer}` } }));
  const me2 = await meRes2.json() as { user: { hasPassword: boolean } };
  expect(me2.user.hasPassword).toBe(true);
});
```

Add `import { setPasswordHash } from '../storage/users';` at the top of the test file.

- [ ] **Step 5: Admin routes — accept optional password + reset endpoint**

Open `server/src/routes/admin.ts`.

Modify the existing `POST /users` handler to accept optional `password`:

```ts
r.post('/users', async (c) => {
  const body = await c.req.json().catch(() => null) as { label?: unknown; password?: unknown } | null;
  if (!body || typeof body.label !== 'string' || body.label.length === 0 || body.label.length > 64) {
    return c.json({ error: 'invalid label' }, 400);
  }
  const hasPassword = typeof body.password === 'string';
  if (hasPassword && (body.password as string).length < 8) {
    return c.json({ error: 'password must be at least 8 characters' }, 400);
  }
  const db = getDb();
  const user = createUser(db, { label: body.label, role: 'member' });
  if (hasPassword) {
    const hash = await Bun.password.hash(body.password as string);
    setPasswordHash(db, user.id, hash);
    logger.info({ userId: user.id, label: user.label }, 'admin created user with password');
    return c.json({
      user: { id: user.id, label: user.label, role: user.role, createdAt: user.createdAt },
    });
  }
  const claim = createClaimToken(db, user.id, CLAIM_TTL_SEC);
  logger.info({ userId: user.id, label: user.label }, 'admin created user (invite via claim token)');
  return c.json({
    user: { id: user.id, label: user.label, role: user.role, createdAt: user.createdAt },
    claimToken: claim.token,
  });
});
```

Add `import { setPasswordHash } from '../storage/users';` at the top.

Add new endpoint `POST /users/:id/reset-password`:

```ts
r.post('/users/:id/reset-password', async (c) => {
  const body = await c.req.json().catch(() => null) as { newPassword?: unknown } | null;
  if (!body || typeof body.newPassword !== 'string' || body.newPassword.length < 8) {
    return c.json({ error: 'newPassword must be at least 8 characters' }, 400);
  }
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  const db = getDb();
  const target = getUser(db, id);
  if (!target) return c.json({ error: 'user not found' }, 404);
  if (target.role === 'admin') return c.json({ error: 'admin cannot be reset via this endpoint; use /change-password' }, 409);
  const hash = await Bun.password.hash(body.newPassword);
  setPasswordHash(db, id, hash);
  deleteUserDeviceSessions(db, id);
  logger.info({ userId: id }, 'admin reset user password; all sessions revoked');
  return c.body(null, 204);
});
```

Add `import { deleteUserDeviceSessions } from '../storage/device-sessions';` at the top.

- [ ] **Step 6: Admin route tests**

Extend `server/src/routes/admin.test.ts`:

```ts
test('POST /users with password creates user + no claim token', async () => {
  const { app, adminBearer } = await makeAuthedFixture();
  const res = await app.fetch(jsonReq('/api/admin/users', 'POST', { label: 'Kid', password: 'kidpassword' }, adminBearer));
  expect(res.status).toBe(200);
  const body = await res.json() as { user: { label: string }; claimToken?: string };
  expect(body.user.label).toBe('Kid');
  expect(body.claimToken).toBeUndefined();
});

test('POST /users rejects short password', async () => {
  const { app, adminBearer } = await makeAuthedFixture();
  const res = await app.fetch(jsonReq('/api/admin/users', 'POST', { label: 'Kid', password: 'short' }, adminBearer));
  expect(res.status).toBe(400);
});

test('POST /users without password still emits claimToken', async () => {
  const { app, adminBearer } = await makeAuthedFixture();
  const res = await app.fetch(jsonReq('/api/admin/users', 'POST', { label: 'Kid' }, adminBearer));
  const body = await res.json() as { claimToken?: string };
  expect(body.claimToken).toMatch(/^[A-Z0-9]{4}-/);
});

test('POST /users/:id/reset-password sets new password + revokes sessions', async () => {
  const { app, db, adminBearer } = await makeAuthedFixture();
  const kid = createUser(db, { label: 'Kid', role: 'member' });
  setPasswordHash(db, kid.id, await Bun.password.hash('oldpass'));
  // Give Kid a device session
  createDeviceSession(db, { userId: kid.id, deviceLabel: 'phone', tokenHash: 'kid-hash-1' });

  const res = await app.fetch(jsonReq(`/api/admin/users/${kid.id}/reset-password`, 'POST', { newPassword: 'newpassword' }, adminBearer));
  expect(res.status).toBe(204);
  expect(listUserDevices(db, kid.id).length).toBe(0);
  // Kid's new password works
  const login = await jsonPost(app, '/api/auth/login', { label: 'Kid', password: 'newpassword', deviceLabel: 'x' });
  expect(login.status).toBe(200);
});

test('POST /users/:id/reset-password on admin returns 409', async () => {
  const { app, admin, adminBearer } = await makeAuthedFixture();
  const res = await app.fetch(jsonReq(`/api/admin/users/${admin.id}/reset-password`, 'POST', { newPassword: 'newpassword' }, adminBearer));
  expect(res.status).toBe(409);
});
```

Add necessary imports:
```ts
import { setPasswordHash } from '../storage/users';
import { listUserDevices, createDeviceSession } from '../storage/device-sessions';
```

The `jsonPost` helper may need to be exported from `auth.test.ts` OR duplicated inline — check the existing `admin.test.ts` for its pattern.

- [ ] **Step 7: Run tests + typecheck + commit**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
bun test
bun run typecheck
```

Expected: ~185+ pass (170 baseline from B + ~15 new for password auth). All prior tests still green.

```bash
cd /c/github/passenger
git add server/drizzle/ server/src/db/schema.ts \
        server/src/storage/users.ts server/src/storage/users.test.ts \
        server/src/routes/auth.ts server/src/routes/auth.test.ts \
        server/src/routes/admin.ts server/src/routes/admin.test.ts
git commit -m "server: password auth — login, set-password, change-password, admin reset-password"
```

---

## Task 2: Frontend — SignIn + SetPassword views + routing

**Files:**
- Create: `web/src/views/SignIn.tsx`, `web/src/views/SetPassword.tsx`
- Modify: `web/src/views/Claim.tsx` — post-claim routing branch on `hasPassword`
- Modify: `web/src/api.ts` — add `authLogin`, `authSetPassword`, `authChangePassword`; update `authClaim`/`authMe` return types
- Modify: `web/src/lib/session.ts` — `SessionUser` gains `hasPassword`
- Modify: `web/src/main.tsx` — default unauth route becomes `/#/sign-in`; add `/#/set-password`

- [ ] **Step 1: Update `lib/session.ts`**

```ts
export interface SessionUser {
  id: number;
  label: string;
  role: 'admin' | 'member';
  hasPassword: boolean;    // <-- NEW
}
```

- [ ] **Step 2: Update `api.ts`**

Update the return types of the existing methods:
```ts
authClaim: (token: string, deviceLabel: string) =>
  request<{ bearer: string; user: SessionUser }>('/api/auth/claim', { ... }),

authMe: () =>
  request<{ user: SessionUser; devices: {...}[] }>('/api/auth/me'),
```

Add new methods:
```ts
authLogin: (label: string, password: string, deviceLabel: string) =>
  request<{ bearer: string; user: SessionUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ label, password, deviceLabel }),
  }),

authSetPassword: (newPassword: string) =>
  request<void>('/api/auth/set-password', {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  }),

authChangePassword: (currentPassword: string, newPassword: string) =>
  request<void>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  }),

adminResetPassword: (userId: number, newPassword: string) =>
  request<void>(`/api/admin/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  }),
```

Update `adminCreateUser` to accept optional password:
```ts
adminCreateUser: (label: string, password?: string) =>
  request<{ user: SessionUser; claimToken?: string }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(password ? { label, password } : { label }),
  }),
```

Import `SessionUser` from `./lib/session` at the top.

- [ ] **Step 3: Write `views/SignIn.tsx`**

Model closely on `Claim.tsx` (same wordmark, layout, autofill heuristic). Two fields (label + password) + device name. On submit → `api.authLogin` → `setSession` → `navigate('/')`.

Skeleton (adjust to match Claim.tsx's exact styling):

```tsx
import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Box, Button, TextField, Alert, Typography, Stack } from '@mui/material';
import { api } from '../api';
import { setSession } from '../lib/session';
import { navigate } from '../router';        // or wherever the navigate helper lives

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Tesla/i.test(ua)) return 'Tesla';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  return 'Web';
}

export default function SignIn() {
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [deviceLabel, setDeviceLabel] = useState(defaultDeviceName());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => { labelRef.current?.focus(); }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { bearer, user } = await api.authLogin(label.trim(), password, deviceLabel.trim() || 'Web');
      setSession(bearer, user);
      navigate('/');
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('401') || msg.includes('invalid credentials')) {
        setError('Invalid username or password.');
      } else if (msg.includes('400') || msg.includes('password not set')) {
        setError('This user has not set a password yet. Use a claim token or ask the admin to reset.');
      } else {
        setError('Sign in failed. Check the server is running.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ /* match Claim.tsx wordmark + centered card */ }}>
      {/* wordmark <canvas> */}
      <form onSubmit={onSubmit}>
        <Stack spacing={2} sx={{ width: 320 }}>
          <TextField label="Username" value={label} onChange={(e) => setLabel(e.target.value)} inputRef={labelRef} autoComplete="username" autoCapitalize="off" spellCheck={false} required />
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <TextField label="Device name" value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          <Button variant="text" size="small" onClick={() => navigate('/claim')}>I have a claim token</Button>
        </Stack>
      </form>
    </Box>
  );
}
```

The exact MUI structure should mirror Claim.tsx's — reuse the wordmark/logo block verbatim.

- [ ] **Step 4: Write `views/SetPassword.tsx`**

Used after claim redemption when `hasPassword: false`, and after admin resets a user's password (member is force-logged-out; on next sign-in via a re-issued claim OR via label+empty-password, they get routed here).

```tsx
import { useState, type FormEvent } from 'react';
import { Box, Button, TextField, Alert, Typography, Stack } from '@mui/material';
import { api } from '../api';
import { getUser, setSession, getBearer } from '../lib/session';
import { navigate } from '../router';

export default function SetPassword() {
  const user = getUser();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) { navigate('/sign-in'); return null; }
  if (user.hasPassword) { navigate('/'); return null; }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await api.authSetPassword(password);
      // Update local session to reflect hasPassword=true
      const bearer = getBearer()!;
      setSession(bearer, { ...user!, hasPassword: true });
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ /* centered card */ }}>
      <Typography variant="h5">Set your password</Typography>
      <Typography variant="body2" sx={{ mt: 1, mb: 3, color: 'text.secondary' }}>
        Welcome {user.label}. Choose a password to use for future sign-ins on any device.
      </Typography>
      <form onSubmit={onSubmit}>
        <Stack spacing={2} sx={{ width: 320 }}>
          <TextField label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus required />
          <TextField label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</Button>
        </Stack>
      </form>
    </Box>
  );
}
```

- [ ] **Step 5: Update `views/Claim.tsx`** — post-claim routing

Existing Claim.tsx handles submit success by `setSession` + `navigate('/')`. Change the navigate branch:

```ts
setSession(bearer, user);
if (!user.hasPassword) navigate('/set-password');
else navigate('/');
```

- [ ] **Step 6: Update `main.tsx` routing**

Find the current route table. Add `/#/sign-in` → `SignIn` and `/#/set-password` → `SetPassword`. Change the unauthenticated default from `/#/claim` to `/#/sign-in`.

`/#/claim` MUST still be reachable — for admin bootstrap, admin recovery, and invited members with no pre-set password. Add a "I have a claim token" link on `/#/sign-in` that routes to it (shown in Step 3's SignIn skeleton).

Also add a boot-time check: if user is authenticated but `!user.hasPassword`, redirect to `/#/set-password` regardless of the intended route. Otherwise a user who claimed but abandoned the flow could be stuck without a set password.

- [ ] **Step 7: Verify + commit**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/web
npm run build
```

Build must be clean. Grep `web/src/` for `hasPassword` — should appear in api.ts, session.ts, Claim.tsx, SignIn.tsx, SetPassword.tsx, main.tsx at minimum.

```bash
cd /c/github/passenger
git add web/src/views/SignIn.tsx web/src/views/SetPassword.tsx \
        web/src/views/Claim.tsx web/src/api.ts \
        web/src/lib/session.ts web/src/main.tsx
git commit -m "web: password sign-in view + set-password + hasPassword routing"
```

---

## Task 3: Users password mgmt + Account change password

**Files:**
- Modify: `web/src/views/Users.tsx` — Add User modal gains password field; per-row Reset password
- Modify: `web/src/views/AccountTab.tsx` (or wherever "Account" or "Sign out" currently lives) — add Change password section

- [ ] **Step 1: Users.tsx — Add User modal**

Current Add User modal has a `label` field only. Add a `password` field (optional per API design — allow blank to fall back to claim-token flow). Two-field form:

```tsx
<TextField label="Username (label)" ... />
<TextField label="Initial password (optional)" type="password" ... />
```

Small helper text below the password field: "Leave blank to send an invite via claim token instead."

On submit:
- If password non-empty: `api.adminCreateUser(label, password)` → response has `{ user }`, no claimToken. Show "User created. Share the username and password with them." success dialog.
- If password empty: existing flow — `api.adminCreateUser(label)` → response has `{ user, claimToken }`. Show the claim token as today.

- [ ] **Step 2: Users.tsx — per-row Reset password**

In the ManagePanel (or wherever per-user actions live), add a "Reset password" button. Opens a small dialog with:
- New password field (type="password", `autoComplete="new-password"`)
- Confirm field
- Cancel + Reset buttons

On confirm: `api.adminResetPassword(userId, newPassword)`. On success, show a confirmation ("Password reset. Give the new password to {label}. All their signed-in devices are now signed out."). Client-side length + match validation.

- [ ] **Step 3: AccountTab.tsx (or equivalent) — Change password**

Find wherever the current "Sign out" button lives (per B-T8 report it's `AccountTab.tsx`). Add a "Change password" section above or beside sign-out:

```tsx
<Stack spacing={2}>
  <TextField label="Current password" type="password" ... autoComplete="current-password" />
  <TextField label="New password" type="password" ... autoComplete="new-password" />
  <TextField label="Confirm new password" type="password" ... autoComplete="new-password" />
  {error && <Alert severity="error">{error}</Alert>}
  {success && <Alert severity="success">Password changed. Other devices have been signed out.</Alert>}
  <Button variant="contained" onClick={onChange} disabled={busy}>Change password</Button>
</Stack>
```

Client-side validation: new password ≥ 8 chars, matches confirm. On submit: `api.authChangePassword(current, newPassword)`. On success, clear the fields, show the alert.

- [ ] **Step 4: Verify + commit**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/web
npm run build
```

Clean.

```bash
cd /c/github/passenger
git add web/src/views/Users.tsx web/src/views/AccountTab.tsx
git commit -m "web: Users password field + reset-password action + Account change-password"
```

---

## Task 4: Verification + smoke walkthrough

- [ ] **Step 1: Full server test + typecheck + web build**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server && bun test && bun run typecheck
cd /c/github/passenger/web && npm run build
```

All must pass clean.

- [ ] **Step 2: Boot smoke — mechanical checks**

Kill any leftover dev server on 8787. Wipe `server/data/`. Boot the server:
```bash
cd /c/github/passenger/server && bun start
```
Confirm the admin claim token banner appears. Capture the token.

- [ ] **Step 3: End-to-end walkthrough (controller-executed in browser)**

Deferred to controller. Provide a checklist for the controller (David) to work through:

1. Fresh browser → `http://localhost:5173/` → lands at `/#/sign-in`.
2. Click "I have a claim token" → `/#/claim`. Paste admin claim token + device name → submit.
3. Redirected to `/#/set-password`. Set a strong password. Confirmed. Redirected to `/#/`.
4. Sign out from Settings. Redirected to `/#/sign-in`.
5. Enter admin label + password + device name. Successfully signed in.
6. Settings → Users → Add user "Kid" with password "kidpassword123" → success dialog, no claim token shown.
7. Private window → `/#/sign-in` → enter Kid + kidpassword123 + Phone. Signed in as Kid.
8. Kid → Settings → Account → Change password (current: kidpassword123, new: kidfullpower). Sign out. Sign back in with new. Works.
9. Admin → Users → Kid → Reset password → "kidreset123". Kid's other browser tab (still authenticated) will 401 on next request → bounce to /sign-in.
10. Kid signs in with kidreset123. Works.

- [ ] **Step 4: Commit + hand off**

```bash
cd /c/github/passenger
# Only if any docs need updating — otherwise skip this commit.
```

Report to the controller:
- All server tests pass
- Web build clean
- Boot smoke: banner + fresh admin claim token captured
- Deferred: manual end-to-end walkthrough listed above

---

## Out of scope

- Password reset via email (no SMTP)
- Password strength meters (v1: length-only)
- 2FA / passkeys
- Rate-limiting /api/auth/login
- Auto-signout after inactivity
- Admin recovery via anything other than boot-time claim banner
