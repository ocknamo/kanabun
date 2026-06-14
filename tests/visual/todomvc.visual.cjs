const { test, expect } = require("@playwright/test");

// TodoMVC's empty initial state (no items, input focused-but-empty) is static,
// so the screenshot is deterministic. If a state with items is added later,
// drive it through deterministic interactions before snapshotting.
test("todomvc — initial render", async ({ page }) => {
  await page.goto("http://localhost:3101/");
  // Wait for the mounted app rather than `networkidle` (more deterministic).
  await expect(page.locator("input.new-todo")).toBeVisible();
  await expect(page).toHaveScreenshot("todomvc.png", { fullPage: true });
});
