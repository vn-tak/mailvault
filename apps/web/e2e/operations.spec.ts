import { expect, test, type Page } from "@playwright/test";
import { resetSeededFlags, SEEDED_MAILS } from "./fixtures";

/*
 * Working through the list rather than one message at a time: ticking several rows and doing
 * one thing to them, the star that says "this one", the counts beside each tab, and a search
 * that shows what it understood.
 *
 * Nothing here deletes a seeded message — later suites open them by id — so the destructive
 * path is asserted only as far as its confirmation, and the delete itself is covered against
 * a real database in the integration suite.
 */

const M1 = SEEDED_MAILS[0];
const M2 = SEEDED_MAILS[1];
const M4 = SEEDED_MAILS[3];

test.beforeEach(async ({ page }) => {
  await page.goto("/#/inbox");
  await expect(page.locator(".msg").first()).toBeVisible();
  await resetSeededFlags(page, [M1, M4]);
  await page.reload();
  await expect(page.locator(".msg").first()).toBeVisible();
});

const checkbox = (page: Page, id: string) =>
  page.locator(`[data-msg-id="${id}"] input[type="checkbox"]`);
const rows = (page: Page) => page.locator(".msglist .msg");

test("ticking rows arms a selection and one action moves all of it", async ({ page }) => {
  await checkbox(page, M1).check();
  await expect(page.locator(".bulk-count")).toHaveText("1 selected");
  await expect(page.locator(".msg.is-selected")).toHaveCount(1);

  await checkbox(page, M2).check();
  await expect(page.locator(".bulk-count")).toHaveText("2 selected");
  // The count names the selection rather than the page, so it cannot be misread as a total.
  await expect(page.locator(".msg.is-selected")).toHaveCount(2);

  await page.getByRole("button", { name: "Mark read" }).click();
  await expect(page.locator(".bulk-count")).toHaveText(/work on several/);
  await expect(page.locator(`[data-msg-id="${M1}"].unread`)).toHaveCount(0);
  await expect(page.locator(`[data-msg-id="${M2}"].unread`)).toHaveCount(0);
});

test("shift-click covers the rows in between", async ({ page }) => {
  const ids = await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-msg-id") as string));
  expect(ids.length).toBeGreaterThanOrEqual(3);

  await checkbox(page, ids[0] ?? "").check();
  await checkbox(page, ids[2] ?? "").click({ modifiers: ["Shift"] });
  await expect(page.locator(".bulk-count")).toHaveText("3 selected");
  await expect(page.locator(".msg.is-selected")).toHaveCount(3);

  // The master checkbox covers the page, and a second press lets go of all of it.
  await page.getByRole("checkbox", { name: "Select every message on this page" }).check();
  await expect(page.locator(".msg.is-selected")).toHaveCount(ids.length);
  await page.getByRole("checkbox", { name: "Select every message on this page" }).uncheck();
  await expect(page.locator(".msg.is-selected")).toHaveCount(0);
});

test("a star is the owner's own mark, and the Starred tab counts it", async ({ page }) => {
  await expect(page.getByRole("button", { name: /^Starred/ })).toContainText("2");

  const row = page.locator(`[data-msg-id="${M2}"]`);
  await expect(row.locator(".star")).toHaveCount(1);
  await row.getByRole("button", { name: "Star" }).click();
  await expect(row.locator(".star.is-on")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Starred/ })).toContainText("3");

  await page.getByRole("button", { name: /^Starred/ }).click();
  await expect(rows(page)).toHaveCount(3);
  // Every row in there is marked, which is the whole promise of the tab.
  await expect(rows(page).locator(".star.is-on")).toHaveCount(3);

  // And marking something from inside it takes it out again, the way a toggle should.
  await rows(page).first().getByRole("button", { name: "Remove star" }).click();
  await expect(rows(page)).toHaveCount(2);
});

test("archiving takes mail out of the working list, and back", async ({ page }) => {
  const before = await rows(page).count();
  await checkbox(page, M1).check();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(rows(page)).toHaveCount(before - 1);

  await page.getByRole("button", { name: "Filed" }).click();
  await expect(page.locator(`[data-msg-id="${M1}"]`)).toBeVisible();
  await checkbox(page, M1).check();
  // In this tab the same control means the opposite thing, and says so.
  await page.getByRole("button", { name: "Back to inbox" }).click();
  await expect(page.locator(`[data-msg-id="${M1}"]`)).toHaveCount(0);

  await page.getByRole("button", { name: /^All/ }).click();
  await expect(page.locator(`[data-msg-id="${M1}"]`)).toBeVisible();
});

test("deleting asks first, and does nothing until you say so", async ({ page }) => {
  await checkbox(page, M1).check();
  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Delete 1 messages?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(`[data-msg-id="${M1}"]`)).toBeVisible();
});

test("an operator in the search box is read back as a chip that removes itself", async ({ page }) => {
  const search = page.locator("input.search");

  await search.fill("has:attachment");
  await search.press("Enter");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator(".chip")).toHaveCount(1);

  await search.fill("has:attachment has:code");
  await search.press("Enter");
  // Two operators on one message that has only one of them: the list narrows to nothing.
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator(".chip")).toHaveCount(2);

  // Dropping the chip that over-mustered the search brings the row back, because the chip is
  // the query and not a decoration under it.
  await page.locator(".chip").nth(1).click();
  await expect(page.locator(".chip")).toHaveCount(1);
  await expect(rows(page)).toHaveCount(1);
});

test("Escape lets go of the selection before it closes anything", async ({ page }) => {
  await checkbox(page, M1).check();
  await expect(page.locator(".msg.is-selected")).toHaveCount(1);
  // Focus is still inside the checkbox that made the selection, which is exactly when a
  // handler that ignores focused inputs would leave Escape doing nothing.
  await page.keyboard.press("Escape");
  await expect(page.locator(".msg.is-selected")).toHaveCount(0);
});

test("@mobile the bulk bar wraps instead of pushing the page sideways", async ({ page }) => {
  await checkbox(page, M1).check();
  await checkbox(page, M2).check();
  await expect(page.locator(".bulkbar")).toBeVisible();
  // A toolbar whose buttons sit side by side on a desktop must not widen a phone page: the
  // row of actions is allowed to break, the viewport is not allowed to scroll sideways.
  await expect(page.evaluate(() => document.documentElement.scrollWidth)).resolves.toBeLessThanOrEqual(412);
});
