// diagnostics.ts — client-side ring buffer, session context, and error reporting.
//
// Design constraints:
// - Must be safely evaluatable in Node/Bun (no DOM) for tests.
//   All DOM accesses (window, location, screen, navigator, localStorage) are guarded.
// - tsMs is monotonic since module load via performance.now(), NOT wall clock.
// - Kill switches: ?diag=off URL param OR localStorage.canvas.diag.disabled === '1'.
// - POST failures to /api/telemetry/error are swallowed silently.

// ---------------------------------------------------------------------------
// sanitizeMessage — strips URL-shaped substrings from error messages/stacks
// before emitting telemetry, so token-bearing or path-revealing URLs don't leak.
// ---------------------------------------------------------------------------
export function sanitizeMessage(s: string): string {
  return s.replace(/https?:\/\/[^\s"]+/gi, '[url]');
}

export class Ring<T> {
  private buf: T[] = [];
  constructor(private cap: number) {}

  push(v: T): void {
    this.buf.push(v);
    if (this.buf.length > this.cap) this.buf.shift();
  }

  snapshot(): T[] {
    return this.buf.slice();
  }

  get length(): number {
    return this.buf.length;
  }
}

export interface DiagEvent {
  tsMs: number;
  kind: string;
  data: Record<string, unknown>;
}

export interface SessionContext {
  userAgent: string;
  viewport: { w: number; h: number };
  screen: { w: number; h: number };
  connectionType?: string;
  canvasVersion: string;
  sourceType: string;
}

const RING_CAP = 500;
export const ring = new Ring<DiagEvent>(RING_CAP);

// Module-level session identifier — stable for the lifetime of this JS module
// (i.e. a single browser session / page load). Used by PlayerErrorDialog to
// surface a correlation handle in the error detail panel.
const sessionId: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export function getSessionId(): string {
  return sessionId;
}

// Monotonic offset since module load — safe against Tesla clock skew.
const sessionBootMark =
  typeof performance !== 'undefined' ? performance.now() : 0;

export function tsMs(): number {
  const now =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  return Math.round(now - sessionBootMark);
}

// ---------------------------------------------------------------------------
// Kill-switch check — ?diag=off in URL or localStorage flag.
// ---------------------------------------------------------------------------
function isEnabled(): boolean {
  try {
    if (
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('diag') === 'off'
    ) {
      return false;
    }
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('canvas.diag.disabled') === '1'
    ) {
      return false;
    }
  } catch {
    // Swallow SecurityError (cross-origin) or similar.
  }
  return true;
}

// ---------------------------------------------------------------------------
// Core emit — pushes to the ring buffer.
// ---------------------------------------------------------------------------
export function emit(
  kind: string,
  data: Record<string, unknown> = {},
): void {
  if (!isEnabled()) return;
  ring.push({ tsMs: tsMs(), kind, data });
}

// ---------------------------------------------------------------------------
// Session context snapshot — all DOM accesses guarded for Node/Bun safety.
// ---------------------------------------------------------------------------
export function getSessionContext(sourceType: string): SessionContext {
  const nav =
    typeof navigator !== 'undefined' ? navigator : undefined;
  const conn = (
    nav as unknown as { connection?: { effectiveType?: string } } | undefined
  )?.connection;

  // Vite replaces import.meta.env.VITE_CANVAS_VERSION at build time.
  // In Bun test env, import.meta.env is {} so this safely falls back to 'dev'.
  const canvasVersion: string =
    (typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: Record<string, string> }).env
        ?.VITE_CANVAS_VERSION) ||
    'dev';

  return {
    userAgent: nav?.userAgent ?? 'unknown',
    viewport: {
      w: typeof window !== 'undefined' ? window.innerWidth : 0,
      h: typeof window !== 'undefined' ? window.innerHeight : 0,
    },
    screen: {
      w: typeof screen !== 'undefined' ? screen.width : 0,
      h: typeof screen !== 'undefined' ? screen.height : 0,
    },
    connectionType: conn?.effectiveType,
    canvasVersion,
    sourceType,
  };
}

// ---------------------------------------------------------------------------
// reportFatal — POSTs the ring snapshot + session context to the server.
// ---------------------------------------------------------------------------
export async function reportFatal(
  err: { message: string; kind: string; stack?: string },
  sourceType: string,
): Promise<void> {
  if (!isEnabled()) return;
  const sanitizedErr = {
    ...err,
    message: sanitizeMessage(err.message),
    stack: err.stack !== undefined ? sanitizeMessage(err.stack) : undefined,
  };
  const payload = {
    events: ring.snapshot(),
    session: getSessionContext(sourceType),
    error: sanitizedErr,
  };
  try {
    await fetch('/api/telemetry/error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Never let a telemetry failure cascade to the calling code.
  }
}

// ---------------------------------------------------------------------------
// Test-only: allows tests to reset the module singleton between cases.
// Only zeroes the ring buffer — nothing else.
// ---------------------------------------------------------------------------
export function __resetForTests(): void {
  (ring as unknown as { buf: unknown[] }).buf = [];
}

// Module-level debounce for global fatal reports — prevents report storms from
// error loops. Only fires reportFatal if more than 5 s have elapsed since the
// last global-handler invocation.
let lastGlobalFatalMs = 0;

// ---------------------------------------------------------------------------
// installGlobalErrorHandlers — hooks window.onerror + unhandledrejection.
// No-op in non-DOM environments (Bun tests, SSR).
// ---------------------------------------------------------------------------
export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (ev) => {
    const msg = ev.message ?? 'unknown error';
    emit('browser_error', {
      message: msg,
      filename: ev.filename,
      lineno: ev.lineno,
    });
    const now = performance.now();
    if (now - lastGlobalFatalMs > 5000) {
      lastGlobalFatalMs = now;
      const sanitizedStack = ev.error?.stack
        ? sanitizeMessage(ev.error.stack)
        : undefined;
      reportFatal(
        { message: sanitizeMessage(msg), kind: 'browser', stack: sanitizedStack },
        'unknown',
      ).catch(() => {});
    }
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const msg =
      typeof reason === 'string'
        ? reason
        : reason instanceof Error
          ? reason.message
          : 'unhandled rejection';
    emit('browser_error', { message: msg, kind: 'unhandledrejection' });
    const now = performance.now();
    if (now - lastGlobalFatalMs > 5000) {
      lastGlobalFatalMs = now;
      const sanitizedStack =
        reason instanceof Error && reason.stack
          ? sanitizeMessage(reason.stack)
          : undefined;
      reportFatal(
        { message: sanitizeMessage(msg), kind: 'browser', stack: sanitizedStack },
        'unknown',
      ).catch(() => {});
    }
  });
}
