const { test, expect } = require("@playwright/test");

// The SSR example serves server-rendered markup (the button + "count is 0"),
// then the client hydrates it. The initial appearance is identical before and
// after hydration, so the screenshot is deterministic — no interaction needed.
test("ssr — initial render", async ({ page }) => {
  await page.goto("http://localhost:3102/");
  // Wait for the (server-rendered, then hydrated) button rather than
  // `networkidle` — more deterministic.
  await expect(page.locator("button")).toBeVisible();
  await expect(page).toHaveScreenshot("ssr.png", { fullPage: true });
});
