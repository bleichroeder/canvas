# OSS Release Design (sub-project E)

**Status:** Draft 2026-07-01. Last planned sub-project on the self-host roadmap. Package publishes as PRIVATE on ghcr.io; visibility flips to public later, after the Tesla player is verified end-to-end.

**Goal:** Establish the release pipeline so cutting a canvas release is a single `git tag`. Multi-arch image (amd64 + arm64) auto-builds and publishes to `ghcr.io/bleichroeder/canvas:<version>` + `:latest`. Users pull via `docker pull ghcr.io/bleichroeder/canvas:latest`. Repo can flip from private to public without touching the release infrastructure.

**Motivation:** Canvas is now feature-complete for household self-hosting. To share with friends or eventually open-source, we need images published to a registry and versioned. Every push should NOT auto-release — releases are explicit acts (git tags). CI covers build health on every branch push.

## Deliverables

1. **`LICENSE`** — MIT. Simple, permissive, standard for hobby / consumer-adjacent OSS. Copyright: David Herzfeld.
2. **`.github/workflows/publish.yml`** — GitHub Actions workflow. Two triggers:
   - **Version tag push** (`v*.*.*`) → build multi-arch (linux/amd64 + linux/arm64) → push to `ghcr.io/bleichroeder/canvas:<version>` + `ghcr.io/bleichroeder/canvas:latest`
   - **Push to `self-host-server-port`** (later `main` post-cutover) → build only, no publish. CI health check.
3. **`.github/workflows/ci.yml`** — Regular CI on every branch push + PR: server `bun test` + `bun run typecheck`, web `npm run build`, Dockerfile lints (hadolint), overall image build success. Fails PR merges on red.
4. **`Dockerfile` OCI labels** — Add `org.opencontainers.image.*` labels: source URL, license, description, revision (git sha), version. Populates image metadata in registries and pull-time tooling.
5. **`CONTRIBUTING.md`** — How to build, run tests, structure PRs, and the SDD workflow. Points at `docs/superpowers/` for design docs.
6. **`.github/ISSUE_TEMPLATE/`** — Bug report + feature request templates.
7. **First tag** — `v0.1.0`. Kicks off the workflow, produces the first published image. Package stays private until controller flips it.
8. **Documented "make public" checklist** — README section or separate `docs/publishing.md` covering the one-time actions to make canvas discoverable: flip package visibility, flip repo visibility, populate GitHub topic tags, add a README badge for the ghcr image, submit to awesome-selfhosted list (optional).

## Non-goals

- **Docker Hub as secondary registry.** Skip. ghcr.io is enough.
- **Cosign / image signing.** Deferred — nice for supply-chain security but overkill for v1.
- **SBOM generation.** Deferred — same reasoning.
- **Renovate / dependency automation.** Deferred; keeps scope tight.
- **Homebrew formula / apt package / systemd unit / Kubernetes manifest.** All community territory.
- **Windows containers.** Not on the roadmap.

## Version scheme

Semver starting from `v0.1.0`. Rough guidance:

- `v0.x.y` while I'm still the only user in production; breaking DB migrations allowed with a note in the release notes
- `v1.0.0` when I've been using canvas daily for a few months without incident and the schema feels stable
- Bumping `y` (patch) for bug fixes; `x` (minor) for new features; `x` also for backwards-incompatible schema until 1.0.0

Releases are always tagged from the `self-host-server-port` branch tip (or `main` post-cutover). No release from unmerged feature branches.

## Workflow specifics

### `publish.yml` shape

```yaml
name: Publish canvas image

on:
  push:
    tags: ['v*.*.*']

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3        # arm64 build support on x86 runner
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ghcr.io/${{ github.repository_owner }}/canvas
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}
      - uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### `ci.yml` shape

Runs on every branch push + PR:

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:

jobs:
  server-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3'
      - working-directory: server
        run: |
          bun install --frozen-lockfile
          bun test
          bun run typecheck

  web-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - working-directory: web
        run: |
          npm ci
          npm run build

  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Only amd64 in CI (arm64 emulation is slow; save it for release builds).

### Dockerfile OCI labels

Add to runtime stage:

```dockerfile
LABEL org.opencontainers.image.title="canvas"
LABEL org.opencontainers.image.description="Self-hosted Tesla-in-car streaming client. Plays from Plex and Flixify sources via a canvas + WebCodecs pipeline."
LABEL org.opencontainers.image.source="https://github.com/bleichroeder/canvas"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.vendor="bleichroeder"
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision="${GIT_SHA}"
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}"
```

The workflow passes `GIT_SHA` and `VERSION` via build-args from `github.sha` and the tag ref.

## Repository visibility timeline

1. **Now (private repo, no image published):** Nothing external.
2. **After E lands (private repo, first tag pushed):** Image published to `ghcr.io/bleichroeder/canvas:v0.1.0` (private package by default). Only David can `docker pull` it. Workflow health verified.
3. **After player fix + smoke ships:** Controller flips package visibility to Public via GH package settings. `docker pull ghcr.io/bleichroeder/canvas:latest` works for anyone. Repo stays private.
4. **Eventually — full OSS release:** Controller flips repo visibility to Public. Source, issues, PRs, CONTRIBUTING.md all reachable.

Each transition is a manual, deliberate act. The sub-project E deliverables cover steps 1 → 2. Step 3 is a documented checklist item (task in the plan) executed by controller when appropriate.

## Success criteria

1. `git tag v0.1.0 && git push origin v0.1.0` triggers the publish workflow.
2. Workflow completes green within 10-15 minutes.
3. `docker pull ghcr.io/bleichroeder/canvas:v0.1.0` (authenticated as David) succeeds and pulls the multi-arch image.
4. `docker pull ghcr.io/bleichroeder/canvas:latest` also works (semver + latest tags both applied).
5. Package appears at `https://github.com/users/bleichroeder/packages/container/package/canvas` with visibility set to Private.
6. The image runs end-to-end in the same way `canvas:local` does — wizard, sign-in, cf-quick tunnel, everything.
7. CI workflow runs on every push (branches + PRs), covers server tests + typecheck + web build + Docker build.
8. LICENSE file exists at repo root.
9. CONTRIBUTING.md documents the SDD workflow + build steps.
10. Repo stays private throughout; package stays private throughout.
