const { test, expect } = require("@playwright/test");

// The counter renders a single scoped-CSS button centered in the viewport.
// Its initial state is fully static, so the screenshot is deterministic.
test("counter — initial render", async ({ page }) => {
  await page.goto("http://localhost:3000/");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("counter.png", { fullPage: true });
});
