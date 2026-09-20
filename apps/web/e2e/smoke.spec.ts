import { expect, test } from "@playwright/test";

test("dashboard loads and the API reports healthy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // The vault band's status resolves from /api/health once it responds ok. It used to be a
  // "●" glyph in the text; the mark is now an element, so the state is asserted on the band.
  await expect(page.locator(".vault-top")).toContainText("Online");
  await expect(page.locator(".vault-top .live-dot")).toHaveClass(/^(?!.*warn).*$/, "a healthy check is not flagged");
});

test("primary navigation switches views", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Inbox" }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await page.getByRole("link", { name: "Domains" }).click();
  await expect(page.getByRole("heading", { name: "Domains" })).toBeVisible();
  await page.getByRole("link", { name: "Aliases" }).click();
  await expect(page.getByRole("heading", { name: "Aliases" })).toBeVisible();
});
