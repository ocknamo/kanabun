const { test, expect } = require("@playwright/test");

// The counter renders a single scoped-CSS button centered in the viewport.
// Its initial state is fully static, so the screenshot is deterministic.
test("counter — initial render", async ({ page }) => {
  await page.goto("http://localhost:3000/");
  // Wait for the mounted button rather than `networkidle` (more deterministic).
  await expect(page.locator("button")).toBeVisible();
  await expect(page).toHaveScreenshot("counter.png", { fullPage: true });
});
