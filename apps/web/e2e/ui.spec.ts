import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/*
 * Layout contract for the phone build. These assert the things that silently break a
 * mobile UI: content wider than the viewport, controls too small to hit, an input under
 * 16px (iOS zooms the whole page), a navigation bar that scrolls away, and — specific to
 * a mail client — a forged OTP being echoed where the owner would tap it.
 */

const SCREENS: Array<[string, string]> = [
  ["dashboard", "/#/"],
  ["inbox", "/#/inbox"],
  ["aliases", "/#/aliases"],
  ["domains", "/#/domains"],
  ["settings", "/#/settings"],
];

async function fitsViewport(page: Page, where: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${where} must not overflow horizontally`).toBeLessThanOrEqual(clientWidth + 1);
}

/*
 * Opening a message marks it read, and the local D1 survives between runs — so unread
 * assertions would depend on what a previous run did. Reset the two rows this suite
 * reasons about, from inside the page so the browser supplies the same-origin headers
 * the CSRF guard requires.
 */
const SEEDED_UNREAD = ["00000000-0000-4000-8000-0000000000m1", "00000000-0000-4000-8000-0000000000m3"];

async function openInbox(page: Page) {
  await page.goto("/#/inbox");
  await page.evaluate(async (ids) => {
    for (const id of ids) {
      const res = await fetch(`/api/messages/${id}/read`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-mailvault": "1" },
        body: JSON.stringify({ isRead: false }),
      });
      if (!res.ok) throw new Error(`reset ${id}: ${res.status}`);
    }
  }, SEEDED_UNREAD);
  await page.reload();
  await expect(page.locator(".msg")).toHaveCount(4);
}

test("phone: every screen fits the viewport, is labelled, and screenshots clean @mobile", async ({ page }) => {
  for (const [name, path] of SCREENS) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await fitsViewport(page, name);
    await page.screenshot({ path: `e2e-screens/${name}.png` });
  }
});

test("phone: navigation is a bottom bar with thumb-sized targets @mobile", async ({ page }) => {
  await page.goto("/#/inbox");
  const bar = page.locator("nav.nav");
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport, "nav bar and viewport must be measurable").toBeTruthy();
  expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport!.height - 2);
  expect(box!.y).toBeGreaterThan(viewport!.height * 0.6);

  for (const link of await bar.getByRole("link").all()) {
    const h = (await link.boundingBox())?.height ?? 0;
    expect(h, "tab targets stay ≥40px").toBeGreaterThanOrEqual(40);
  }
  await expect(bar.getByRole("link", { name: "Inbox" })).toHaveClass(/active/);
});

test("phone: text controls are 16px so iOS never zooms on focus @mobile", async ({ page }) => {
  await page.goto("/#/inbox");
  const size = await page.locator("input.search").evaluate((el) => getComputedStyle(el).fontSize);
  expect(parseFloat(size)).toBeGreaterThanOrEqual(16);
  const height = (await page.locator("input.search").boundingBox())?.height ?? 0;
  expect(height).toBeGreaterThanOrEqual(44);
});

test("phone: the inbox is a card list, searchable, and never shows a forged code @mobile", async ({ page }) => {
  await openInbox(page);
  await expect(page.locator(".msg")).toHaveCount(4);
  await expect(page.locator(".msg.unread")).toHaveCount(2);

  const list = page.locator(".card--flush");
  // Trusted mail may surface its code; a spoofed row must show a warning instead of a
  // code the owner would paste somewhere.
  const codeBadges = list.locator(".badge.mono");
  await expect(codeBadges).toHaveCount(1);
  await expect(codeBadges.first()).toHaveText("55905149");
  await expect(list.locator(".msg", { hasText: "Urgent" }).locator(".badge.mono")).toHaveCount(0);
  await expect(list.getByText("unverified sender")).toBeVisible();

  await page.locator("input.search").fill("digest");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator(".msg")).toHaveCount(1);

  await page.screenshot({ path: "e2e-screens/inbox-list.png", fullPage: true });
});

test("phone: opening spoofed mail explains it before showing anything clickable @mobile", async ({ page }) => {
  await openInbox(page);
  await page.locator(".msg", { hasText: "Urgent" }).locator("a").click();

  await expect(page.getByText("Codes and verification links are hidden")).toBeVisible();
  await expect(page.locator(".code-card")).toHaveCount(0);
  await expect(page.locator(".link-card")).toHaveCount(0);
  await page.screenshot({ path: "e2e-screens/message-spoofed.png" });

  await page.getByRole("button", { name: /Show anyway/ }).click();
  await expect(page.locator(".code-card")).toHaveCount(1);
});

test("desktop: the same inbox markup grids into a two-line mail row", async ({ page }) => {
  await openInbox(page);
  await expect(page.locator(".msg")).toHaveCount(4);
  const columns = await page
    .locator(".msg")
    .first()
    .locator("a")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(4);
  await page.screenshot({ path: "e2e-screens/inbox-desktop.png" });
});
