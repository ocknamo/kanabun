// @ts-check
const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Drives the real kanabun dev server in a browser to prove the CSS hot-swap
// end-to-end: editing a `.css` re-fetches just that stylesheet (style applies)
// without reloading the page (JS state survives), while editing anything else
// triggers a full reload. The unit suite covers the client `swapCss` logic and
// the `changeMessage` routing against mocks; this closes the loop through the
// actual HTTP serve → file watcher → WebSocket → browser path.
//
// The fixture is deliberately framework-free: the feature swaps `<link>`
// elements regardless of what rendered them, and a plain JS counter is the
// cleanest possible proof that "nothing else re-executes" (a reload would reset
// it to 0). Vanilla also means the temp fixture resolves no imports, so it can
// live outside the repo and be mutated freely.

const repoRoot = path.resolve(__dirname, "..", "..");
const PORT = 3210; // outside the visual lane's range (3000/3101/3102/3103)
const ORIGIN = `http://localhost:${PORT}`;

const RED = "rgb(255, 0, 0)";
const BLUE = "rgb(0, 0, 255)";
const cssWithColor = (color) => `#box { color: ${color}; }\n`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>css-hmr e2e</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="box">box</div>
    <button id="inc">inc</button>
    <output id="count">0</output>
    <script>
      // In-memory state with no persistence: only survives if the page is NOT
      // reloaded. A hot-swap must leave this untouched; a full reload resets it.
      let n = 0;
      const out = document.getElementById("count");
      document.getElementById("inc").addEventListener("click", () => {
        out.textContent = String(++n);
      });
    </script>
  </body>
</html>
`;

let tmp;
let server;
let serverLog = ""; // captured dev-server output, surfaced if startup fails
const stylesPath = () => path.join(tmp, "styles.css");

/** Resolve once the dev server answers, or reject after `timeoutMs`. */
async function waitForServer(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${ORIGIN}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      // Include the captured output so a CI failure (e.g. port in use) is
      // diagnosable rather than just "did not start".
      throw new Error(`dev server did not start:\n${serverLog || "(no output)"}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kanabun-e2e-"));
  fs.writeFileSync(path.join(tmp, "index.html"), INDEX_HTML);
  fs.writeFileSync(stylesPath(), cssWithColor("rgb(255, 0, 0)"));
  server = spawn(
    "bun",
    [
      path.join(repoRoot, "packages/cli/bin/kanabun.ts"),
      "dev",
      path.join(tmp, "index.html"),
      "--port",
      String(PORT),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  await waitForServer();
});

test.afterAll(async () => {
  if (server) server.kill();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test.beforeEach(async () => {
  // Reset styles to the baseline before each test so order doesn't matter.
  fs.writeFileSync(stylesPath(), cssWithColor("rgb(255, 0, 0)"));
});

const boxColor = (page) =>
  page.locator("#box").evaluate((el) => getComputedStyle(el).color);

test("hot-swaps a changed stylesheet without reloading (state survives)", async ({
  page,
}) => {
  await page.goto(ORIGIN);
  await expect.poll(() => boxColor(page)).toBe(RED);

  // Build up in-memory state that a reload would wipe.
  await page.locator("#inc").click();
  await page.locator("#inc").click();
  await page.locator("#inc").click();
  await expect(page.locator("#count")).toHaveText("3");

  // Edit the stylesheet on disk → server should send `css:/styles.css`.
  fs.writeFileSync(stylesPath(), cssWithColor("rgb(0, 0, 255)"));

  // The new style applies (hot-swap happened)...
  await expect.poll(() => boxColor(page)).toBe(BLUE);
  // ...and the counter is intact, proving the page never reloaded.
  await expect(page.locator("#count")).toHaveText("3");
});

test("falls back to a full reload when a non-CSS file changes", async ({
  page,
}) => {
  await page.goto(ORIGIN);
  await page.locator("#inc").click();
  await expect(page.locator("#count")).toHaveText("1");

  // A non-`.css` change → server sends `reload`; the inline script re-runs and
  // the counter resets to 0. Polling tolerates the navigation round-trip.
  fs.writeFileSync(path.join(tmp, "notes.txt"), `touched ${Date.now()}`);

  await expect.poll(() => page.locator("#count").textContent()).toBe("0");
});
