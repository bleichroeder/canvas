import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as esbuild from 'esbuild';

async function main() {
  const dotenv = existsSync('.env') ? await readFile('.env', 'utf8') : '';
  const env = { ...process.env };
  for (const line of dotenv.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }

  const token = env.PASSENGER_TOKEN;
  const api = env.PASSENGER_API;
  if (!token || !api) {
    console.error('Missing PASSENGER_TOKEN or PASSENGER_API in .env');
    process.exit(1);
  }

  const src = await readFile('src.js', 'utf8');
  const substituted = src
    .replace('__PASSENGER_TOKEN__', token)
    .replace('__PASSENGER_API__', api.replace(/\/$/, ''));

  const minified = await esbuild.transform(substituted, {
    minify: true,
    target: 'es2015',
    format: 'iife',
  });

  const bookmarkletUrl = 'javascript:' + encodeURIComponent(minified.code);

  await mkdir('dist', { recursive: true });
  await writeFile('dist/bookmarklet.js', minified.code);
  await writeFile('dist/bookmarklet.url.txt', bookmarkletUrl);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Install Passenger Bookmarklet</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #222; }
  h1 { margin-bottom: 8px; }
  .install { display: inline-block; padding: 10px 16px; background: #0a7d2c; color: white;
             border-radius: 6px; text-decoration: none; font-weight: 600; }
  .install:hover { background: #086020; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  ol li { margin-bottom: 8px; }
</style>
</head><body>
<h1>Passenger Bookmarklet</h1>
<p>Drag this button to your bookmarks bar:</p>
<p><a class="install" href="${bookmarkletUrl.replace(/"/g, '&quot;')}">Queue for Passenger</a></p>
<h2>Use</h2>
<ol>
  <li>Open a movie on the source site and start playback (so the video element gets a src).</li>
  <li>Click the bookmark.</li>
  <li>A green toast confirms the item was queued.</li>
</ol>
<h2>Notes</h2>
<ul>
  <li>API: <code>${api}</code></li>
  <li>This page contains your token in the bookmarklet URL — do not share.</li>
</ul>
</body></html>`;
  await writeFile('dist/install.html', html);

  console.log(`Built bookmarklet (${minified.code.length} bytes minified).`);
  console.log(`Open dist/install.html in your browser, then drag the link to your bookmarks bar.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
