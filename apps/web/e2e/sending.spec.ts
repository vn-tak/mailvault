import { expect, test } from "@playwright/test";

/*
 * Sending, checked in the browser.
 *
 * The local runtime `wrangler dev` starts lists a `send_email` binding and then injects
 * nothing, so what these cover is the contract the owner can actually see: which senders are
 * offered, who a reply is aimed at, and what the app says when the server itself cannot send.
 * The send logic, the thread bookkeeping and every refusal reason are asserted against a
 * stubbed binding in `test/integration/send.test.ts`, where they can be checked exactly
 * rather than approximated — a browser cannot prove a message was recorded correctly when the
 * transport it is testing does not exist.
 */

const DOMAIN = "demo.example";

test("desktop: the composer offers only aliases on a domain that may sign mail", async ({ page }) => {
  await page.goto("/#/inbox");
  const compose = page.getByRole("button", { name: "Compose" });
  await expect(compose).toBeEnabled();
  await compose.click();

  const dialog = page.getByRole("dialog", { name: "New message" });
  await expect(dialog).toBeVisible();
  const from = dialog.getByLabel("From");
  // Whatever it defaults to, it is an address on the one domain allowed to send.
  await expect(from).toHaveValue(/@demo\.example$/);
  const options = await from.locator("option").allTextContents();
  expect(options.length).toBeGreaterThan(0);
  // Everything on offer belongs to the one domain the seed marks as able to send.
  for (const label of options) expect(label).toContain(DOMAIN);

  await expect(dialog.getByLabel("To")).toBeVisible();
  await expect(dialog.getByLabel("Subject")).toBeVisible();
  await expect(dialog.getByLabel("Message")).toBeVisible();
});

test("desktop: when the server cannot send, the composer says so instead of failing on Submit", async ({ page }) => {
  await page.goto("/#/inbox");
  await page.getByRole("button", { name: "Compose" }).click();
  const dialog = page.getByRole("dialog", { name: "New message" });

  await expect(dialog.getByRole("alert")).toContainText("not available");
  await dialog.getByLabel("To").fill("customer@example.com");
  await dialog.getByLabel("Message").fill("Whatever I write.");
  await expect(dialog.getByRole("button", { name: "Send" })).toBeDisabled();
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
  await expect(dialog.getByLabel("To")).toHaveCount(0);
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
