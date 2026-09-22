import { expect, test } from "@playwright/test";

/*
 * Sending, checked in the browser.
 *
 * The local runtime now really runs the `send_email` binding: `wrangler dev` on wrangler 4
 * hands the Worker a simulator that builds the message, logs it, and delivers nothing. So the
 * compose path is exercised end to end here — which it could not be when the runtime listed
 * the binding and injected nothing. What the refusal reasons, the thread bookkeeping and the
 * per-address states do *inside* the Worker is still asserted against a stub in
 * `test/integration/send.test.ts`, where each branch can be forced rather than waited for.
 */

const DOMAIN = "demo.example";

test("desktop: the composer offers only aliases on a domain that may sign mail", async ({ page }) => {
  await page.goto("/#/inbox");
  const compose = page.getByRole("button", { name: "Compose" });
  await expect(compose).toBeEnabled();
  await compose.click();

  const dialog = page.getByRole("dialog", { name: "New message" });
  await expect(dialog).toBeVisible();
  const from = dialog.getByLabel("From", { exact: true });
  // Whatever it defaults to, it is an address on the one domain allowed to send.
  await expect(from).toHaveValue(/@demo\.example$/);
  const options = await from.locator("option").allTextContents();
  expect(options.length).toBeGreaterThan(0);
  // Everything on offer belongs to the one domain the seed marks as able to send.
  for (const label of options) expect(label).toContain(DOMAIN);

  await expect(dialog.getByLabel("To", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Subject", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Message", { exact: true })).toBeVisible();
});

test("desktop: composing goes out, and the Sent row is the receipt", async ({ page }) => {
  const subject = `A letter from the runtime ${Date.now()}`;
  const recipient = `probe-${Date.now()}@example.com`;

  await page.goto("/#/inbox");
  await page.getByRole("button", { name: "Compose" }).click();
  const dialog = page.getByRole("dialog", { name: "New message" });
  // The server can send, so nothing warns and nothing is blocked: this is the ordinary path.
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("To", { exact: true }).fill(recipient);
  await dialog.getByLabel("Subject", { exact: true }).fill(subject);
  await dialog.getByLabel("Message", { exact: true }).fill("Written in the browser, accepted by the runtime.");
  await dialog.getByRole("button", { name: "Send" }).click();

  // The composer closes, the list moves to Sent, and the row that answers for the send is
  // opened beside it — the owner never has to trust a toast that disappears.
  await expect(dialog).toHaveCount(0);
  const row = page.locator(".msg").filter({ hasText: subject });
  await expect(row).toBeVisible();
  await expect(row.locator(".pill")).toContainText("waiting");

  const pane = page.locator(".mail-pane");
  // The destination the send named is recorded as its own line, waiting for an answer —
  // per-address tracking, proven against the real runtime rather than a stub.
  await expect(pane.getByText("Delivery to each address")).toBeVisible();
  await expect(pane.locator(".recip-status li")).toHaveCount(1);
  await expect(pane.locator(".recip-status .addr")).toHaveText(recipient);
  await expect(pane.locator(".recip-status .pill")).toContainText("waiting");

  // Take the message out again. The local database survives between runs, and a leftover
  // sent row would move the dashboard's mailbox count for whichever suite reads it next.
  const id = await row.getAttribute("data-msg-id");
  await page.evaluate(async (messageId) => {
    const res = await fetch(`/api/messages/${messageId}`, { method: "DELETE", headers: { "x-mailvault": "1" } });
    if (!res.ok) throw new Error(`cleanup ${messageId}: ${res.status}`);
  }, id);
});

test("desktop: a reply names its recipient as a fact, not as a field to edit", async ({ page }) => {
  await page.goto("/#/messages/00000000-0000-4000-8000-0000000000m4");
  const reply = page.getByRole("button", { name: "Reply" });
  await expect(reply).toBeEnabled();
  await reply.click();

  const dialog = page.getByRole("dialog", { name: "Reply" });
  await expect(dialog).toBeVisible();
  // The address the stored message named, shown as text: the client cannot aim a reply at
  // somebody the conversation never pointed to.
  await expect(dialog.getByText("no-reply@example.org")).toBeVisible();
  await expect(dialog.getByLabel("To", { exact: true })).toHaveCount(0);
  // It leaves from the alias the message arrived on, which is not the first alias in the list.
  await expect(dialog.getByText("news-d7k2q1@demo.example")).toBeVisible();
});

test("phone: the compose sheet fits the viewport and its fields stay thumb-sized", async ({ page }) => {
  await page.goto("/#/inbox");
  await page.getByRole("button", { name: "Compose" }).click();
  const dialog = page.getByRole("dialog", { name: "New message" });
  await expect(dialog).toBeVisible();

  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);

  for (const label of ["From", "To", "Subject", "Message"]) {
    const size = await dialog.getByLabel(label).evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(size)).toBeGreaterThanOrEqual(16);
  }
});
