# OSS Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` for tracking.

**Goal:** Ship the release pipeline: LICENSE, GitHub Actions for CI + publish, OCI-labeled Dockerfile, contribution docs, first tag `v0.1.0`. Package publishes PRIVATE on ghcr.io. Repo stays private throughout.

**Architecture:** Two workflows (`publish.yml` on version tags, `ci.yml` on every push/PR). Multi-arch builds via docker/buildx with GHA cache. First tag drives the initial publish to verify the pipeline works end-to-end. Public visibility flip is a documented checklist item, not executed here.

## Global Constraints

- **Branch:** direct commits on `self-host-server-port` (no sub-branch this time).
- **Registry:** `ghcr.io/bleichroeder/canvas` (owner slug matches the repo owner exactly).
- **First tag:** `v0.1.0`.
- **License:** MIT, copyright David Herzfeld.
- **CI on which branches:** `self-host-server-port` (post-migration to `main`, we'll update the trigger — trivial edit).
- **Package stays private** through the entire sub-project. The public flip is a step in the final task's documented checklist, NOT executed.
- **Do NOT modify canvas app code.** This sub-project is purely release plumbing.

---

## Task 1: LICENSE + Dockerfile OCI labels + README namespace fix

**Files:**
- Create: `LICENSE`
- Modify: `Dockerfile` — add OCI image labels + `GIT_SHA` / `VERSION` build args
- Modify: `README.md` — ghcr.io namespace references

- [ ] **Step 1: Write `LICENSE`**

Save as `LICENSE` at repo root:

```
MIT License

Copyright (c) 2026 David Herzfeld

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Add OCI labels to `Dockerfile`**

Find the final runtime stage (the one with `ENTRYPOINT`). Add just before the `ENTRYPOINT` line:

```dockerfile
# OCI image metadata — populates registry listings + `docker inspect`.
ARG VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="canvas"
LABEL org.opencontainers.image.description="Self-hosted Tesla-in-car streaming client. Plays from Plex and Flixify sources via a canvas + WebCodecs pipeline."
LABEL org.opencontainers.image.source="https://github.com/bleichroeder/canvas"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.vendor="bleichroeder"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${VERSION}"
```

`VERSION` and `GIT_SHA` default to `dev` / `unknown` for local builds (`docker build -t canvas:local .` still works fine). The workflow passes real values.

- [ ] **Step 3: Update `README.md` — ghcr namespace + a tiny badge**

Search for `ghcr.io/dherzfeld/canvas` in README.md (placeholder from earlier work) and replace with `ghcr.io/bleichroeder/canvas`. Every command example that references a `docker pull` gets the new namespace.

Add near the top of the README (below the tagline but above Quick Start), a status/version badge line:

```markdown
![License](https://img.shields.io/badge/license-MIT-blue)
![Build Status](https://github.com/bleichroeder/canvas/actions/workflows/ci.yml/badge.svg)
```

(The build badge will render as "unknown" until CI runs at least once. That's fine.)

- [ ] **Step 4: Verify local build still works**

```bash
cd /c/github/passenger
docker build -t canvas:local .
```

Should succeed with the LABEL directives added. `docker inspect canvas:local | grep -A 10 org.opencontainers` should show the labels.

- [ ] **Step 5: Commit**

```bash
git add LICENSE Dockerfile README.md
git commit -m "release: MIT license + OCI image labels + ghcr.io/bleichroeder namespace"
```

---

## Task 2: CI + publish workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/publish.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:

jobs:
  server-tests:
    name: server tests + typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3'
      - name: install
        working-directory: server
        run: bun install --frozen-lockfile
      - name: test
        working-directory: server
        run: bun test
      - name: typecheck
        working-directory: server
        run: bun run typecheck

  web-build:
    name: web build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: web/package-lock.json
      - name: install
        working-directory: web
        run: npm ci
      - name: build
        working-directory: web
        run: npm run build

  docker-build:
    name: docker build (amd64)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: build
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

CI only builds amd64 — arm64 emulation on GH runners is slow (~15+ minutes), which is fine for release builds but not every push.

- [ ] **Step 2: Write `.github/workflows/publish.yml`**

```yaml
name: Publish canvas image

on:
  push:
    tags: ['v*.*.*']

jobs:
  build-and-push:
    name: multi-arch build + push to ghcr.io
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Set up QEMU (for arm64 emulation on x86 runners)
        uses: docker/setup-qemu-action@v3

      - uses: docker/setup-buildx-action@v3

      - name: Log in to ghcr.io
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/canvas
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: |
            VERSION=${{ github.ref_name }}
            GIT_SHA=${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

The `type=raw,value=latest` line adds the `:latest` tag on every version tag push. If you'd prefer `:latest` to only track the highest semver version (rather than the last-pushed tag), that's more logic than we need — for a hobby project, "last tag pushed becomes :latest" is fine.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/
git commit -m "release: CI + publish workflows (multi-arch on tag; ci on every push)"
```

- [ ] **Step 4: Push and verify CI**

```bash
git push
```

Open GitHub → Actions tab. `ci.yml` should trigger on the push, run 3 jobs (server-tests, web-build, docker-build), and go green.

If any job fails, fix + push before proceeding to T3. Don't push a version tag until CI is green.

---

## Task 3: CONTRIBUTING + issue templates

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/ISSUE_TEMPLATE/config.yml`

- [ ] **Step 1: Write `CONTRIBUTING.md`**

```markdown
# Contributing to canvas

Thanks for interest! canvas is a hobby project I share with friends and a few strangers. Contributions are welcome; here's the shape.

## Local development

Canvas has two runtime pieces + a legacy worker:

- `server/` — Bun + Hono + Drizzle + SQLite backend
- `web/` — Vite + React + MUI frontend
- `worker/` — frozen Cloudflare Worker (retiring; ignore for new work)

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
  -v ~/canvas-data:/data \
  canvas:local
```

Then browse to `http://localhost:8787/` and follow the setup wizard.

## Project structure

See [docs/superpowers/specs/](docs/superpowers/specs/) for design docs and [docs/superpowers/plans/](docs/superpowers/plans/) for implementation plans. Each sub-project (A through F) is documented; new work should follow the same shape.

## Making changes

1. Fork + branch from `self-host-server-port` (the integration branch — `main` still holds legacy pre-self-host code).
2. Follow the spec/plan pattern for anything non-trivial: write a spec, get feedback, then implement.
3. Include tests for server changes. Frontend has no test infrastructure; verification is `npm run build` + smoke testing.
4. Run `bun test` + `bun run typecheck` + `npm run build` before opening a PR.
5. Keep commits focused. One logical change per commit.
6. CI must be green before merge.

## Deployment modes + testing

Canvas supports four deployment modes (see [`docs/deployment-modes.md`](docs/deployment-modes.md)). PRs that touch server-side deployment logic should describe which modes were smoke-tested.

## Sub-agent-driven development

Canvas is largely built via subagent-driven development ([docs/superpowers/](docs/superpowers/)). If you're using an AI assistant for contributions, following that pattern will keep changes reviewable. Handwritten contributions welcome too.

## Filing issues

Bug reports: please include canvas version (from the footer or `docker inspect ghcr.io/bleichroeder/canvas:<tag>`), deployment mode, and reproduction steps.

Feature requests: describe the use case, not just the feature. The self-host / household focus shapes what fits.

## Code of conduct

Be kind. This is a hobby project, communication should reflect that.

## License

MIT. See [LICENSE](LICENSE).
```

- [ ] **Step 2: Write `.github/ISSUE_TEMPLATE/bug_report.md`**

```markdown
---
name: Bug report
about: Something's not working as expected
labels: bug
---

## What happened

A clear description of the bug.

## What did you expect to happen

## Reproduction steps

1.
2.
3.

## Environment

- canvas version: (from `docker inspect` or the app footer)
- Deployment mode: (local / domain / cf-quick / cf-named)
- Docker version: (`docker --version`)
- OS / architecture: (Linux amd64 / Raspberry Pi arm64 / etc.)
- Client browser: (Tesla / Chrome / Safari / etc.)
- Media source: (Plex / Flixify)

## Logs

Relevant excerpt from `docker logs canvas`. Please redact any tokens, IPs, or user info you'd rather not share.

```
paste logs here
```

## Additional context
```

- [ ] **Step 3: Write `.github/ISSUE_TEMPLATE/feature_request.md`**

```markdown
---
name: Feature request
about: Suggest a new feature or improvement
labels: enhancement
---

## The use case

Describe the situation where this would help you. Concrete scenarios are more useful than abstract asks.

## What you'd like to happen

## Alternatives you've considered

## Additional context

Screenshots, mockups, comparable features in similar projects, etc.
```

- [ ] **Step 4: Write `.github/ISSUE_TEMPLATE/config.yml`**

```yaml
blank_issues_enabled: false
contact_links:
  - name: Discussion
    url: https://github.com/bleichroeder/canvas/discussions
    about: Questions, ideas, or general feedback — please post in Discussions, not Issues.
```

(Discussions may or may not be enabled on the private repo yet; if it complains, remove the contact_links block or enable Discussions.)

- [ ] **Step 5: Commit**

```bash
git add CONTRIBUTING.md .github/ISSUE_TEMPLATE/
git commit -m "release: CONTRIBUTING guide + bug/feature issue templates"
```

---

## Task 4: First tag + verify publish + publishing.md

**Files:**
- Create: `docs/publishing.md`

- [ ] **Step 1: Cut the first tag**

Before tagging, one final sanity check locally:

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
bun test
bun run typecheck
cd /c/github/passenger/web
npm run build
cd /c/github/passenger
docker build -t canvas:local .
```

All should pass. If anything is broken, fix before tagging.

Then:

```bash
git tag -a v0.1.0 -m "canvas v0.1.0 — first release"
git push origin v0.1.0
```

- [ ] **Step 2: Watch the publish workflow**

Open GitHub → Actions tab. The `Publish canvas image` workflow should trigger on the tag push. It'll take 10-15 minutes (arm64 emulation is slow).

If it fails, fix + push a new tag (bump patch: `v0.1.1`). Common failure modes:
- `permissions: packages: write` missing → workflow file misconfigured
- Buildx cache miss on first run → will succeed on subsequent runs
- Multi-arch build fails on native deps → shouldn't happen with our stack (Bun + Node + shell), but worth checking logs

- [ ] **Step 3: Verify the published image**

Once the workflow is green, go to `https://github.com/users/bleichroeder/packages/container/package/canvas` and confirm:
- Image exists
- Visibility is Private (default)
- Tags: `0.1.0`, `0.1`, `latest` (from the metadata action pattern)

Pull it locally (authenticated as David; ghcr.io private packages require a personal access token with `read:packages`):

```bash
# One-time: log in to ghcr.io. Create a classic PAT with read:packages scope at
# https://github.com/settings/tokens
echo <YOUR_PAT> | docker login ghcr.io -u bleichroeder --password-stdin

docker pull ghcr.io/bleichroeder/canvas:v0.1.0
docker inspect ghcr.io/bleichroeder/canvas:v0.1.0 | grep -A 10 org.opencontainers
```

The `org.opencontainers.image.*` labels should be populated with the tag version + git sha.

- [ ] **Step 4: Full end-to-end smoke of the published image**

Same as your local smoke, but pull from ghcr.io instead of using `canvas:local`:

```bash
docker rm -f canvas
docker run -d --restart unless-stopped --name canvas \
  -p 80:80 -p 443:443 -p 8787:8787 \
  -v ~/canvas-data:/data \
  ghcr.io/bleichroeder/canvas:v0.1.0
```

Open `http://localhost:8787/` and confirm the wizard flow works end-to-end. This is the exact experience an external user will get post-public-flip — just with an auth step in `docker login` while the image is private.

- [ ] **Step 5: Write `docs/publishing.md` — the flip-to-public checklist**

```markdown
# Publishing canvas to the public

This checklist covers the one-time actions required to release canvas to the world. It is separate from the version-release process (which happens automatically on any `git tag`); this is about visibility changes.

## Prerequisites

- [ ] Tesla player fix verified end-to-end (single-frame freeze issue resolved)
- [ ] At least one release tag has been pushed and the publish workflow completed green
- [ ] The image at `ghcr.io/bleichroeder/canvas:latest` runs end-to-end via the wizard against a fresh volume
- [ ] Someone besides David has tested the image on their own machine
- [ ] docs/deployment-modes.md is accurate for the four bundled modes

## Flip the container package to public

1. Go to https://github.com/users/bleichroeder/packages/container/canvas/settings
2. Scroll to "Danger Zone" → "Change package visibility"
3. Choose "Public" → confirm
4. Test: from an unauthenticated shell, `docker pull ghcr.io/bleichroeder/canvas:latest` should succeed without `docker login`

At this point, the image is available worldwide but the source is still private.

## Flip the repo to public (later)

Only when you're ready to expose source, issues, PRs, contribution history.

1. Go to https://github.com/bleichroeder/canvas/settings
2. Scroll to "Danger Zone" → "Change repository visibility"
3. Choose "Public" → confirm (GH will require typing the repo name)
4. Optional next steps:
   - Add topics: `self-hosted`, `tesla`, `plex`, `docker`, `webcodecs`
   - Add a README badge for the image: `![Docker Pulls](https://ghcr.io/bleichroeder/canvas)`
   - Enable Discussions
   - Submit to [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted) if you want broader visibility

## Cutting a release

Independent of visibility, cutting a canvas release is:

```bash
git tag -a v0.2.0 -m "canvas v0.2.0 — <summary>"
git push origin v0.2.0
```

Watch the "Publish canvas image" workflow at https://github.com/bleichroeder/canvas/actions. On green, `ghcr.io/bleichroeder/canvas:v0.2.0` + `:0.2` + `:latest` are all updated. Users on `:latest` auto-pick-up on next `docker pull` + recreate.

## Emergency: pulling a bad release

If a release ships broken:

1. Publish a fixed version bump (`v0.2.1`) via the normal tag flow
2. Delete the bad image from the ghcr.io package UI, OR mark it as retracted
3. Notify users if they're on the affected version (README banner, GH issue, whatever channel you have)
```

- [ ] **Step 6: Commit + push**

```bash
git add docs/publishing.md
git commit -m "release: publishing.md flip-to-public checklist"
git push
```

- [ ] **Step 7: Final report**

Confirm to controller (David):
- v0.1.0 tag pushed
- Publish workflow completed green (screenshot / URL to the workflow run)
- Image at `ghcr.io/bleichroeder/canvas:v0.1.0` pulls successfully (with auth)
- Image runs end-to-end via wizard
- Package visibility confirmed Private
- Repo visibility unchanged (Private)
- Publishing checklist committed

Next controller action (outside this sub-project): flip package to public when player is fixed. Flip repo to public when comfortable with source exposure. Both are documented in `docs/publishing.md`.

---

## Out of scope

- Docker Hub as secondary registry
- Cosign / image signing
- SBOM generation
- Automated dependency PRs (Renovate / Dependabot config)
- Homebrew formula, apt package, Nix flake
- Kubernetes manifests / Helm chart
- Auto-migrations for schema breaking changes (already covered by drizzle)
- Windows containers
- Actually flipping visibility to public — documented in publishing.md, executed by controller when appropriate
