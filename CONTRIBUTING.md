# Contributing to canvas

Thanks for the interest. Canvas is a hobby project I share with friends and a few strangers. Contributions are welcome; here's the shape.

## Local development

Canvas has two runtime pieces:

- `server/` — Bun + Hono + Drizzle + SQLite backend
- `web/` — Vite + React + MUI frontend

**Prereqs:** [Bun 1.3+](https://bun.sh) for the server, Node 20+ for the web build.

**Server dev loop:**

```bash
cd server
bun install
bun dev             # hot-reload on :8787
bun test            # 240+ tests
bun run typecheck   # tsc --noEmit
```

**Web dev loop:**

```bash
cd web
npm install
# For frontend-only work pointing at a separately-running server:
echo 'VITE_CANVAS_API=http://localhost:8787' > .env.local
npm run dev         # Vite on :5173
```

**Full-stack via Docker:**

```bash
docker build -t canvas:local .
docker run -d --restart unless-stopped --name canvas \
  -p 80:80 -p 443:443 -p 8787:8787 \
  -v canvas-data:/data \
  canvas:local
```

Then open `http://localhost:8787/` and follow the setup wizard.

## Project structure

See [`docs/superpowers/specs/`](docs/superpowers/specs/) for design docs and [`docs/superpowers/plans/`](docs/superpowers/plans/) for implementation plans. Sub-projects A through F document how canvas got to where it is; new work should follow the same shape.

## Making changes

1. Fork + branch from `self-host-server-port` (the integration branch — `main` still holds legacy pre-self-host code).
2. For anything non-trivial, follow the spec/plan pattern: write a spec, get feedback, then implement.
3. Include tests for server changes. Frontend has no test infrastructure; verification is `npm run build` + smoke testing.
4. Run `bun test` + `bun run typecheck` + `npm run build` before opening a PR.
5. Keep commits focused. One logical change per commit.
6. CI must be green before merge.

## Deployment modes + testing

Canvas supports four deployment modes (see [`docs/deployment-modes.md`](docs/deployment-modes.md)). PRs that touch server-side deployment logic should describe which modes were smoke-tested.

## Subagent-driven development

Canvas is largely built via subagent-driven development ([`docs/superpowers/`](docs/superpowers/)). If you're using an AI assistant for contributions, following that pattern will keep changes reviewable. Handwritten contributions welcome too.

## Filing issues

Bug reports: please include the canvas version (from `docker inspect ghcr.io/bleichroeder/canvas:<tag>`), deployment mode, and reproduction steps.

Feature requests: describe the use case, not just the feature. The self-host / household focus shapes what fits.

## Code of conduct

Be kind. This is a hobby project; communication should reflect that.

## License

MIT. See [LICENSE](LICENSE).
