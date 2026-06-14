# Visual regression tests

Screenshot-based regression tests for the runnable examples, run with
Playwright's built-in `toHaveScreenshot` (which bundles the pixel-diff
comparator — no extra dependency).

These are **not** part of `bun test`. The core unit suite runs against the DOM
mock and stays runtime-independent; this is a separate, browser-based lane.
Playwright is **CI-only tooling** (provided by the container image / installed
ad-hoc with `--no-save`), never a `package.json` dependency, so the project's
zero-dependency rule is preserved.

## Why a pinned container

Rendered output depends on fonts, sub-pixel anti-aliasing, and the Chromium
build, so a baseline is only valid against the exact environment it was captured
in. CI runs in `mcr.microsoft.com/playwright:v1.56.1-jammy`; baselines must be
generated in that same image. **Do not commit baselines captured on your laptop
or in any other environment** — they will produce false diffs.

## Regenerating baselines (the only sanctioned way)

Run the **"Update visual baselines"** GitHub Actions workflow
(`.github/workflows/visual-baselines.yml`, `workflow_dispatch`). It runs the
pinned container, captures fresh PNGs under `__screenshots__/`, and commits them
to the branch.

> First-time bootstrap (merge procedure): until baselines exist, the `visual`
> CI gate fails by design (Playwright errors on a missing snapshot), so **do not
> make `visual` a required status check until baselines are committed**. The
> `workflow_dispatch` button only appears once the workflow is on the default
> branch, so the bootstrapping PR itself stays red. Sequence:
>
> 1. Merge this change (with `visual` not yet required).
> 2. Trigger **"Update visual baselines"** on `main` — it commits the PNGs.
>    Confirm `github-actions[bot]` can push (branch protection must allow it, or
>    run the `docker run` below locally and commit yourself).
> 3. Once the gate is green, mark `visual` a required check.
>
> To bootstrap pre-merge instead, run the same image locally:
>
> ```sh
> docker run --rm -it -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v1.56.1-jammy \
>   bash -lc 'curl -fsSL https://bun.sh/install | bash && export PATH=$HOME/.bun/bin:$PATH \
>     && npm install --no-save @playwright/test@1.56.1 \
>     && npx playwright test -c tests/visual/playwright.config.cjs --update-snapshots'
> ```
>
> then commit the generated `tests/visual/__screenshots__/`.

## Running locally (against your own environment)

You can run the suite locally to iterate, but compare only against baselines you
generated locally — never the committed (container) ones:

```sh
npm install --no-save @playwright/test@1.56.1      # CI-only tool, not a dep
npx playwright test -c tests/visual/playwright.config.cjs --update-snapshots  # local baseline
npx playwright test -c tests/visual/playwright.config.cjs                     # compare
```

The config boots both example dev servers (`counter` on :3000, `todomvc` on
:3101) and screenshots each at PC (1280×900) and mobile (375×800) viewports.

## Tuning

`toHaveScreenshot` tolerance lives in `playwright.config.cjs`
(`maxDiffPixelRatio`). A too-loose ratio hides small regressions (e.g. a
corner-only `border-radius` change can slip under 1%); switch to `maxDiffPixels`
or per-test options for stricter checks.
