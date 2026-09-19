import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

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
 * An absolutely-positioned popover inside a rounded card is the mobile failure that
 * reports success: the DOM is there, the CSS box has a size, and the owner sees nothing
 * because an ancestor clipped it, or because the fixed tab bar paints over it. So measure
 * the real box and hit-test its centre rather than trusting a visibility check. Assert the
 * panel's class first (web-first, retried) — React decides up/down in an effect, so a
 * one-shot read races the flush it schedules.
 */
async function popoverFits(menu: Locator, where: string) {
  const probe = await menu.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const bar = document.querySelector<HTMLElement>(".sidebar")?.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      vw: window.innerWidth,
      barTop: bar && bar.top > window.innerHeight / 2 ? bar.top : window.innerHeight,
      visibleAtCentre: !!at && el.contains(at),
      itemHeights: [...el.querySelectorAll('[role="menuitem"]')].map((b) => b.getBoundingClientRect().height),
    };
  });
  const box = `pop=[${[probe.top, probe.right, probe.bottom, probe.left].map(Math.round).join(", ")}] vw=${probe.vw} barTop=${Math.round(probe.barTop)}`;
  expect(probe.visibleAtCentre, `${where}: popover is clipped or covered (${box})`).toBe(true);
  expect(probe.top, `${where}: popover runs above the viewport (${box})`).toBeGreaterThanOrEqual(0);
  expect(probe.bottom, `${where}: popover hides behind the bottom tab bar (${box})`).toBeLessThanOrEqual(probe.barTop + 1);
  expect(probe.left, `${where}: popover goes off the left edge (${box})`).toBeGreaterThanOrEqual(0);
  expect(probe.right, `${where}: popover goes off the right edge (${box})`).toBeLessThanOrEqual(probe.vw);
  for (const h of probe.itemHeights) expect(h, `${where}: menu item too small to tap`).toBeGreaterThanOrEqual(40);
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
  await expect(page.locator(".msg")).toHaveCount(5);
}

/*
 * Same problem, same cure, for the alias this test archives on purpose: a reused dev
 * server skips the seed, so a row left archived by a previous (failed) run would break
 * the next run for reasons that have nothing to do with the layout under test.
 */
const SEEDED_ALIAS = "00000000-0000-4000-8000-00000000al01";
const SEEDED_ALIAS_ADDRESS = "github-x9f2@demo.example";

async function openAliases(page: Page) {
  await page.goto("/#/aliases");
  await page.evaluate(async (id) => {
    const res = await fetch(`/api/aliases/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-mailvault": "1" },
      body: JSON.stringify({ archived: false, pinned: false }),
    });
    if (!res.ok) throw new Error(`reset alias ${id}: ${res.status}`);
  }, SEEDED_ALIAS);
  await page.reload();
  return page.locator(".entity").filter({ hasText: SEEDED_ALIAS_ADDRESS });
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
  await expect(page.locator(".msg")).toHaveCount(5);
  await expect(page.locator(".msg.unread")).toHaveCount(2);

  const list = page.locator(".card--flush");
  // Trusted mail may surface its code; a spoofed row must show a warning instead of a
  // code the owner would paste somewhere.
  await expect(list.locator(".badge.mono")).toHaveCount(2);
  await expect(list.locator(".msg", { hasText: "verification code" }).locator(".badge.mono")).toHaveText("55905149");
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

const STRESS_MSG = "00000000-0000-4000-8000-0000000000m5";

test("phone: a folded magic link, a tracking wrapper and an ASCII table all read cleanly @mobile", async ({ page }) => {
  await page.goto(`/#/messages/${STRESS_MSG}`);
  const cards = page.locator(".link-card");
  await expect(cards).toHaveCount(4);

  // The token was broken across a line break in the mail; the UI must show it whole.
  const magic = cards.filter({ hasText: "intent=device&token=eyJ" });
  await expect(magic.locator(".link-url")).toContainText("OiJVNThTTEoiLCJleHAi");
  await expect(magic.locator(".link-url")).toContainText("next=%2Fsettings%2Fsecurity");

  // A wrapped link shows where it really goes, says the message carried it behind a
  // tracking host, and still offers the address as sent.
  const wrapped = cards.filter({ hasText: "Confirm your device" });
  await expect(wrapped.locator(".link-host")).toHaveText("console.cloud.example");
  await expect(wrapped.getByText(/tracking host/)).toBeVisible();
  await expect(wrapped.getByRole("link", { name: /Open as sent/ })).toBeVisible();

  await fitsViewport(page, "stress message");
  // The sanitized HTML has to actually paint: a blank sandboxed frame would leave every
  // other assertion here green.
  const frame = page.frameLocator("iframe.email-frame");
  await expect(frame.getByText("A new sign-in reached Example Cloud.")).toBeVisible();
  await expect(frame.locator("script")).toHaveCount(0);
  // Real mail is built from tables with width="300" cells; inside a 360px frame that has to
  // shrink rather than pan, because a frame you scroll sideways is unreadable on a phone.
  await expect
    .poll(() => frame.locator("body").evaluate((b) => (b.ownerDocument ?? document).documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
  await page.locator("iframe.email-frame").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "e2e-screens/message-stress-html.png" });

  // Plain text: paragraphs flow, and the indented summary keeps its columns in a box that
  // scrolls by itself instead of widening the page.
  await page.getByRole("button", { name: "Show plain text" }).click();
  await expect(page.locator("pre.text-plain").first()).toContainText("  device     Chrome 129 on macOS 15.6");
  await expect(page.locator(".text-body a").first()).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await page.locator(".text-body").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "e2e-screens/message-stress-text.png" });
  await fitsViewport(page, "stress message as plain text");
});

test("desktop: the same inbox markup grids into a two-line mail row", async ({ page }) => {
  await openInbox(page);
  await expect(page.locator(".msg")).toHaveCount(5);
  const columns = await page
    .locator(".msg")
    .first()
    .locator("a")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(4);
  await page.screenshot({ path: "e2e-screens/inbox-desktop.png" });
});

test("phone: secondary actions sit behind More instead of crowding the row @mobile", async ({ page }) => {
  const row = await openAliases(page);
  await expect(row).toHaveCount(1);

  // Copy · Detail · Inbox · Disable · More — the rest is one tap away, not four buttons wide.
  await expect(row.locator(".entity-actions > button, .entity-actions > div")).toHaveCount(5);
  await expect(row.getByRole("button", { name: "Archive" })).toHaveCount(0);

  await row.getByRole("button", { name: "More" }).click();
  const menu = row.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  await expect(menu).not.toHaveClass(/menu-up/); // room below: open downwards
  await popoverFits(menu, "alias row");

  await menu.getByRole("menuitem", { name: "Archive" }).click();
  await expect(row).toHaveCount(0);

  // It left the Active list, so the row is gone from this tab.
  await page.getByRole("tab", { name: "Archived" }).click();
  const archived = page.locator(".entity").filter({ hasText: SEEDED_ALIAS_ADDRESS });
  await expect(archived).toHaveCount(1);

  /*
   * The case the first version got wrong. The panel is ~150px tall and wants 16px of
   * clearance, so 166px is "room to open downwards" — but the fixed tab bar paints over
   * the bottom of the screen, so the viewport's measure lies. Size the window from the
   * row's own position (rather than scrolling, which depends on how long the list is)
   * until the two measures disagree, then require the bar's answer.
   */
  const NEED = 166;
  const trigger = archived.locator(".menu > button");
  const geometry = await trigger.evaluate((el) => {
    const bar = document.querySelector<HTMLElement>(".sidebar")?.getBoundingClientRect();
    return { bottom: el.getBoundingClientRect().bottom, barHeight: window.innerHeight - (bar?.top ?? window.innerHeight) };
  });
  await page.setViewportSize({ width: 412, height: Math.round(geometry.bottom + NEED + geometry.barHeight / 2) });
  const room = await trigger.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const bar = document.querySelector<HTMLElement>(".sidebar")?.getBoundingClientRect();
    return {
      toViewport: Math.round(window.innerHeight - r.bottom),
      toBar: Math.round((bar?.top ?? window.innerHeight) - r.bottom),
      above: Math.round(r.top),
    };
  });
  expect(room.toViewport, "viewport says there is room below").toBeGreaterThanOrEqual(NEED);
  expect(room.toBar, "the tab bar says there is not").toBeLessThan(NEED);
  expect(room.above, "and there is room above to flip into").toBeGreaterThan(NEED);
  await trigger.click();
  const flipped = archived.getByRole("menu");
  await expect(flipped).toHaveClass(/menu-up/);
  await popoverFits(flipped, "bottom row");
  await archived.getByRole("menuitem", { name: "Unarchive" }).click();
  await expect(archived).toHaveCount(0);
});
