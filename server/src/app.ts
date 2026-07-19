import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { config } from './config';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { requestLog } from './middleware/request-log';
import { requireUser, requireAdmin } from './middleware/auth';
import { makeAuthRoutes } from './routes/auth';
import { makeAdminRoutes } from './routes/admin';
import { makePairRoutes } from './routes/pair';
import { makeHomeRoutes } from './routes/home';
import { makeSourceHomeRoutes } from './routes/source-home';
import { makeLibraryRoutes } from './routes/library';
import { makeItemRoutes } from './routes/item';
import { makeSearchRoutes } from './routes/search';
import { makePlayRoutes } from './routes/play';
import { makeProgressRoutes } from './routes/progress';
import { makeSourceStatusRoutes } from './routes/source-status';
import { makeSubtitlesRoutes } from './routes/subtitles';
import { makeSourcesMgmtRoutes } from './routes/sources-mgmt';
import { makeDeploymentRoutes } from './routes/deployment';
import { makeSetupRoutes } from './routes/setup';
import { makeTelemetryRoutes } from './routes/telemetry';
import { makeAdminTelemetryRoutes } from './routes/admin-telemetry';
import { makeAdminUpdatesRoutes } from './routes/admin-updates';
import { makeYtStreamRoutes } from './routes/yt-stream';
import { makeYoutubeRoutes } from './routes/youtube';
import { makeWatchtowerClient, type WatchtowerClient } from './lib/watchtower-client';
import { makeYtDlp } from './lib/ytdlp';
import { makeStreamSigner } from './lib/yt-stream-sign';
import { generateBearer } from './lib/bearer';
import { registerAdapter } from './sources/registry';
import { plexAdapter } from './sources/plex';
import { flixifyAdapter } from './sources/flixify';
import { makeYoutubeAdapter } from './sources/youtube';
import type { Db } from './db';

// Register source adapters at module scope so they are available before any
// request is served. Re-registration via Map.set is idempotent.
registerAdapter(plexAdapter);
registerAdapter(flixifyAdapter);

export function buildApp(
  db: Db,
  getServer: () => ReturnType<typeof Bun.serve> | null = () => null,
  watchtowerClient?: WatchtowerClient,
): Hono {
  const wtClient = watchtowerClient ?? makeWatchtowerClient({
    url: config.WATCHTOWER_URL,
    token: config.WATCHTOWER_TOKEN,
  });

  // Sub-project Q: YouTube source. The adapter and the public stream route
  // share one yt-dlp wrapper + URL signer. An empty YT_STREAM_SECRET yields an
  // ephemeral per-boot secret (fine single-instance; stream URLs are short-lived).
  const ytdlp = makeYtDlp({ ytdlpPath: config.YTDLP_PATH, jsRuntime: config.YT_JS_RUNTIME });
  const streamSigner = makeStreamSigner(config.YT_STREAM_SECRET || generateBearer());
  registerAdapter(makeYoutubeAdapter({ yt: ytdlp, signer: streamSigner }));

  const app = new Hono();
  app.use('*', corsMiddleware());
  app.use('*', requestLog());
  app.onError(errorHandler);
  app.get('/health', (c) => c.json({ ok: true, version: config.version }));

  // Auth routes — /claim is public; /me, /logout, /devices/* require auth
  // internally via requireUser applied inside makeAuthRoutes.
  app.route('/api/auth', makeAuthRoutes(() => db));

  // Public setup routes (unauthenticated; localhost guard is inside the route handler).
  // Mounted BEFORE the admin middleware block so /api/setup/* is not caught by it.
  app.route('/api', makeSetupRoutes(() => db, getServer));

  // Public deployment status (no auth required).
  // /api/deployment/status — mounted before admin middleware to avoid accidental auth catch.
  app.route('/api', makeDeploymentRoutes(() => db));

  // Public telemetry endpoint — no auth required, mounted before any auth middleware.
  app.route('/api', makeTelemetryRoutes(() => db, {
    enabled: config.TELEMETRY_ENABLED,
    retentionDays: config.TELEMETRY_RETENTION_DAYS,
    maxRows: config.TELEMETRY_MAX_ROWS,
  }));

  // YouTube: /api/yt/stream is public (RangeFetcher sends no bearer, like Plex's
  // token-in-URL); /api/yt/subs is authed (client attaches bearer, like /api/subtitles).
  app.use('/api/yt/subs', requireUser(() => db));
  app.route('/api/yt', makeYtStreamRoutes({
    yt: ytdlp,
    signer: streamSigner,
    ffmpegPath: config.FFMPEG_PATH,
    maxConcurrent: config.YT_MAX_CONCURRENT_STREAMS,
  }));

  // Followed channels/playlists (authed) — the YouTube page's curated feed.
  app.use('/api/youtube/*', requireUser(() => db));
  app.route('/api/youtube', makeYoutubeRoutes(() => db, ytdlp));

  // Everything else under /api/* requires a valid bearer token.
  app.use('/api/pair/*',        requireUser(() => db));
  app.use('/api/home',          requireUser(() => db));
  app.use('/api/source-home',   requireUser(() => db));
  app.use('/api/library/*',     requireUser(() => db));
  app.use('/api/item/*',        requireUser(() => db));
  app.use('/api/search',        requireUser(() => db));
  app.use('/api/play/*',        requireUser(() => db));
  app.use('/api/progress/*',    requireUser(() => db));
  app.use('/api/source-status', requireUser(() => db));
  app.use('/api/subtitles',     requireUser(() => db));
  app.use('/api/admin/*',       requireUser(() => db));
  app.use('/api/admin/*',       requireAdmin);
  app.use('/api/sources',       requireUser(() => db));
  app.use('/api/sources/*',     requireUser(() => db));

  app.route('/api/pair',           makePairRoutes(() => db));
  app.route('/api/home',           makeHomeRoutes(() => db));
  app.route('/api/source-home',    makeSourceHomeRoutes(() => db));
  app.route('/api/library',        makeLibraryRoutes(() => db));
  app.route('/api/item',           makeItemRoutes(() => db));
  app.route('/api/search',         makeSearchRoutes(() => db));
  app.route('/api/play',           makePlayRoutes(() => db));
  app.route('/api/progress',       makeProgressRoutes(() => db));
  app.route('/api/source-status',  makeSourceStatusRoutes(() => db));
  app.route('/api/subtitles',      makeSubtitlesRoutes(() => db));
  app.route('/api/admin',          makeAdminRoutes(() => db));
  app.route('/api/admin',          makeAdminTelemetryRoutes(() => db));
  app.route('/api/admin',          makeAdminUpdatesRoutes(() => db, wtClient));
  app.route('/api/sources',        makeSourcesMgmtRoutes(() => db));

  // Anything under /api/* that didn't match a mounted route returns a JSON
  // 404 (so unknown API calls don't accidentally fall through to the static
  // frontend below and get HTML).
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  // Static frontend. Serves files from CANVAS_WEB_DIR (bundled at /app/web
  // in the Docker image). Falls back to index.html for unmatched paths so
  // client-side routing keeps working.
  app.use('/*', serveStatic({ root: config.CANVAS_WEB_DIR }));
  app.get('/*', async (c) => {
    const file = Bun.file(`${config.CANVAS_WEB_DIR}/index.html`);
    if (!(await file.exists())) return c.notFound();
    return new Response(file, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });
  return app;
}
