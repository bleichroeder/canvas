import { app } from './app';

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '0.0.0.0';

const server = Bun.serve({
  port,
  hostname,
  fetch: app.fetch,
});

console.log(`canvas server listening on http://${hostname}:${port}`);

process.on('SIGTERM', () => { server.stop(); process.exit(0); });
process.on('SIGINT',  () => { server.stop(); process.exit(0); });
