import { expect, test } from "@playwright/test";
import { resetSeededMail } from "./fixtures";

/*
 * One domain, one mailbox. Mail for several domains used to land in one undifferentiated
 * list, so "where is my code" meant reading every row. These assert the contract rather
 * than a realistic count: the dashboard names the mailbox that has mail, and the inbox can
 * be narrowed to it and back.
 */
test("dashboard presents the domain with mail as its own mailbox", async ({ page }) => {
  await page.goto("/#/");
  await resetSeededMail(page);
  await page.reload();

  const card = page.locator(".mailbox").filter({ hasText: "demo.example" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("5 messages");
  await expect(card.getByText("2 unread")).toBeVisible();

  await card.click();
  await expect(page).toHaveURL(/#\/inbox\?domain=/);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.locator(".msg")).toHaveCount(5);
  // Inside one mailbox the domain is what was filtered on, so the rows stop repeating it.
  await expect(page.locator(".msg-alias").first()).toHaveText("GitHub (demo)");
});

test("the inbox switcher narrows to one mailbox and back", async ({ page }) => {
  await page.goto("/#/inbox");
  const picker = page.getByLabel("Mailbox");
  await expect(picker).toHaveValue("");
  await expect(page.locator(".msg-alias").first()).toContainText("demo.example");

  await picker.selectOption({ index: 1 });
  await expect(page).toHaveURL(/#\/inbox\?domain=/);
  await expect(page.locator(".msg")).toHaveCount(5);
  await expect(page.locator(".msg-alias").first()).toHaveText("GitHub (demo)");

  await picker.selectOption("");
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(page.locator(".msg-alias").first()).toContainText("demo.example");
});

test("phone: an open tab connects to the live hub and refetches when nudged @mobile", async ({ page }) => {
  const sockets: string[] = [];
  page.on("websocket", (ws) => sockets.push(ws.url()));

  await page.goto("/#/inbox");
  await expect
    .poll(() => sockets.filter((u) => u.endsWith("/api/live")).length, "the app should hold one socket to the hub")
    .toBeGreaterThan(0);

  // The nudge carries no data, so the visible effect is a refetch through the normal
  // authenticated route — the same one the Refresh button uses.
  const refetch = page.waitForResponse((r) => r.url().includes("/api/messages"));
  await page.evaluate(() => window.dispatchEvent(new Event("mailvault:new-mail")));
  await refetch;
  await expect(page.locator(".msg")).toHaveCount(5);
});

test("phone: the filters share two lines so mail starts near the top @mobile", async ({ page }) => {
  await page.goto("/#/inbox");
  const top = await page.locator(".msg").first().boundingBox();
  const tabs = await page.locator(".toolbar .tabs").boundingBox();
  const picker = await page.locator(".mailbox-select").boundingBox();
  expect(top && tabs && picker, "list and filters must be measurable").toBeTruthy();
  // The mailbox picker shares a line with the unread tabs (their boxes overlap
  // vertically), rather than stacking a third row of controls above the mail.
  expect(picker!.y, "picker starts below the tabs' line").toBeLessThan(tabs!.y + tabs!.height);
  expect(picker!.y + picker!.height, "picker ends above the tabs' line").toBeGreaterThan(tabs!.y);
  expect(Math.round(top!.y)).toBeLessThan(300);
  await page.screenshot({ path: "e2e-screens/inbox-mailbox.png", fullPage: true });
});
