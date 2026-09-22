import { expect, test } from "@playwright/test";

test("domains table shows the seeded Ready domain without mutating anything", async ({ page }) => {
  await page.goto("/#/domains");
  await expect(page.getByRole("heading", { name: "Domains" })).toBeVisible();
  await expect(page.getByText("demo.example")).toBeVisible();
  await expect(page.getByText("Ready").first()).toBeVisible();
  /*
   * Mutating bulk actions do not exist until the owner selects rows (section 9: no domain
   * mutation without an explicit owner action). A permanently disabled "Enable mail (0)"
   * above an unselected list only made the page look like its job was enabling mail.
   * Preflight is read-only against Cloudflare, so "Preflight all" stays available.
   */
  await expect(page.getByRole("button", { name: /^Enable mail/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Preflight \(/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preflight all" })).toBeEnabled();

  await page.getByRole("checkbox", { name: "Select demo.example" }).check();
  const enable = page.getByRole("button", { name: /^Enable mail/ });
  await expect(enable).toHaveText("Enable mail (1)");
  await expect(enable).toBeEnabled();
  await page.getByRole("button", { name: "Clear ✕" }).click();
  await expect(enable).toHaveCount(0);

  // A row's own actions are folded until it is engaged, so the list reads as domains.
  // Off to the side first: on a desktop pointer the row's :hover unfolds it on its own.
  await page.mouse.move(4, 4);
  const row = page.locator(".entity").filter({ hasText: "demo.example" });
  await expect(row.locator(".entity-actions")).toBeHidden();
  await row.locator(".entity-summary").click();
  await expect(row.getByRole("button", { name: "Open mailbox" })).toBeVisible();
});

test("inbox renders its filter controls", async ({ page }) => {
  await page.goto("/#/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  // Scoped to the strip: the bulk bar beside it carries a "Mark unread" button, and a filter
  // and an action that share a word should not be told apart by which one happens to be
  // first in the DOM.
  await expect(page.locator(".tabs").getByRole("button", { name: "Unread" })).toBeVisible();
});
