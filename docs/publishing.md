# Publishing canvas

This document covers two things:

1. **Cutting a release** — happens automatically on any `v*.*.*` git tag.
2. **Flipping visibility to public** — a one-time set of manual steps, gated on the Tesla player fix.

Version-release plumbing (Actions workflow, multi-arch build, tag propagation) lives in [`.github/workflows/publish.yml`](../.github/workflows/publish.yml).

## Cutting a release

```bash
git tag -a v0.2.0 -m "canvas v0.2.0 — <summary>"
git push origin v0.2.0
```

The `Publish canvas image` workflow triggers on the tag push and takes ~6–15 minutes (arm64 emulation on x86 runners is the slow part; buildx GHA cache warms after the first run). On green, `ghcr.io/bleichroeder/canvas` gets three new tag references:

- `0.2.0` (from `type=semver,pattern={{version}}` — note the metadata action strips the leading `v`)
- `0.2` (from `type=semver,pattern={{major}}.{{minor}}`)
- `latest` (from `type=raw,value=latest`)

Users on `:latest` pick up the new image on next `docker pull` + container recreate.

Watch the run at https://github.com/bleichroeder/canvas/actions. If it fails, fix + push a bumped patch tag (`v0.2.1`). Don't push the same tag twice — Docker registries treat that as an ambiguous overwrite.

### Cutting a hotfix

If a release ships broken:

1. Cut a fixed patch (`v0.2.1`) via the normal tag flow.
2. Delete the bad image versions from the [package UI](https://github.com/users/bleichroeder/packages/container/canvas/versions), OR let them age out — `:latest` will already point to the fix once the new workflow completes.
3. Notify users on the affected version (README banner / GH issue / release notes).

### Deleting a mistake

If a tag was cut prematurely (bad workflow output, defective labels, etc.) and no one else has pulled it yet:

```bash
git tag -d v0.2.0
git push origin :refs/tags/v0.2.0
gh api --method DELETE users/bleichroeder/packages/container/canvas
# or delete individual versions via the package UI
```

Then push the corrected tag. This is only safe while the repo + package are private — once published publicly, always bump the patch instead.

## Flipping the container package to public

**Prerequisites:**

- Tesla player fix verified end-to-end (single-frame freeze issue resolved on a real Tesla).
- At least one release tag has published green.
- The published image at `ghcr.io/bleichroeder/canvas:latest` runs end-to-end via the setup wizard against a fresh volume.
- Someone besides David has tested the image on their own machine (fresh Docker install, no cached secrets).
- [`docs/deployment-modes.md`](deployment-modes.md) is accurate for the four bundled modes.
- README's Quick Start is accurate against the current image.

**Steps:**

1. Go to https://github.com/users/bleichroeder/packages/container/canvas/settings
2. Scroll to **Danger Zone** → **Change package visibility**
3. Choose **Public** → confirm
4. From an unauthenticated shell (no `docker login` for ghcr.io):
   ```bash
   docker logout ghcr.io
   docker pull ghcr.io/bleichroeder/canvas:latest
   ```
   Should succeed. If it errors with `denied`, the flip didn't take.

At this point the image is available worldwide. The **repo is still private** — source, issues, PRs, and contribution history remain hidden.

## Flipping the repo to public

Only when you're ready to expose source and history. This is the more visible step.

**Prerequisites:**

- Package is already public (previous section).
- No secrets, tokens, or private hosts hardcoded in the tree. Run:
  ```bash
  git grep -iE "(bleichroeder\.duckdns|token|secret|api_key|password)" -- ':(exclude)server/tests' ':(exclude)docs'
  ```
  Anything real needs rotating + purging from git history first.
- CONTRIBUTING.md and issue templates read cleanly to a stranger.
- LICENSE is present at repo root (GitHub's license detector needs this to show the "MIT" badge).

**Steps:**

1. Go to https://github.com/bleichroeder/canvas/settings
2. Scroll to **Danger Zone** → **Change repository visibility**
3. Choose **Public** → confirm (GH will require typing the repo name).
4. Post-flip cleanup:
   - Add topics: `self-hosted`, `tesla`, `plex`, `docker`, `webcodecs`, `hono`, `bun`.
   - Enable Discussions if you want a lower-friction Q&A channel than Issues.
   - Update README badge URLs if any pointed at private artifact links.

## Version numbering

Semver, loosely:

- `0.x.y` — pre-1.0. Anything can change between minors. Patches are for fixes only.
- `1.0.0` — cut when the Tesla player and self-host wizard are both battle-tested.
- Post-1.0: breaking changes bump major, features bump minor, fixes bump patch.

`latest` follows the most recent published tag. Users pinning to `0.x` get patch updates but not minor bumps.
