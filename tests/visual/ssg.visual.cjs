const { test, expect } = require("@playwright/test");

// The SSG example serves prebuilt static HTML (`kanabun generate`), then the
// client hydrates it. The initial appearance is identical before and after
// hydration, so the screenshots are deterministic — no interaction needed.
// Two routes are prerendered, so each gets its own baseline.
test("ssg — home route", async ({ page }) => {
  await page.goto("http://localhost:3103/");
  // Wait for the (server-rendered, then hydrated) button rather than
  // `networkidle` — more deterministic.
  await expect(page.locator("button")).toBeVisible();
  await expect(page).toHaveScreenshot("ssg-home.png", { fullPage: true });
});

test("ssg — about route", async ({ page }) => {
  await page.goto("http://localhost:3103/about/");
  await expect(page.locator("button")).toBeVisible();
  await expect(page).toHaveScreenshot("ssg-about.png", { fullPage: true });
});
