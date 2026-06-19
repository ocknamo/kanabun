# End-to-end tests

Behavioural (non-visual) browser tests that drive the **kanabun dev server** in
a real Chromium to verify runtime behaviour the other lanes can't:

- `bun test` runs against the DOM mock — no real HTTP server, file watcher, or
  WebSocket.
- the visual lane (`tests/visual`) only compares screenshots — it can't assert
  "the page did **not** reload".

Currently this covers **CSS hot-swap** (`css-hmr.e2e.cjs`): editing a `.css`
re-fetches just that stylesheet so the style applies without a reload (an
in-memory counter survives), while editing a non-CSS file triggers a full
reload (the counter resets). This closes the loop through the real
serve → watch → WebSocket → client `swapCss` path; the unit suite
(`packages/cli/src/dev.spec.ts`) covers the `swapCss` logic and `changeMessage`
routing against mocks.

Like the visual lane, Playwright is **CI-only tooling** (installed ad-hoc with
`--no-save`, never a `package.json` dependency), so the zero-dependency rule
holds.

## No baselines, no pinned container

Unlike the visual lane there are **no committed snapshots**, so these don't
depend on fonts / AA / the exact Chromium build — they run on a laptop or in any
CI container with Bun + Chromium. Each spec spawns its own dev server against a
throwaway temp fixture (so it can mutate files on disk without touching the
repo); there is no shared `webServer`.

## Running locally

```sh
npm install --no-save @playwright/test@1.56.1   # CI-only tool, not a dep
npx playwright install chromium                  # if not already present
npx playwright test -c tests/e2e/playwright.config.cjs
```

`bun` must be on `PATH` (the specs spawn `kanabun dev`). The e2e fixture uses a
fixed port (`3210`) outside the visual lane's range, so the two can run back to
back as they do in CI.
