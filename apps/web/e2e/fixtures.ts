import type { Page } from "@playwright/test";

/*
 * The local D1 survives between E2E runs, and the app's own behaviour — opening a message
 * marks it read, archiving an alias removes it from the default view — mutates what the
 * next run asserts. So every suite that reasons about unread counts or alias state resets
 * its fixtures first, from inside the page, where the browser supplies the same-origin
 * headers the CSRF guard requires.
 */
export const SEEDED_UNREAD = ["00000000-0000-4000-8000-0000000000m1", "00000000-0000-4000-8000-0000000000m3"];
export const SEEDED_ALIAS = "00000000-0000-4000-8000-00000000al01";
export const SEEDED_ALIAS_ADDRESS = "github-x9f2@demo.example";
export const SEEDED_DOMAIN = "demo.example";

export async function resetSeededMail(page: Page) {
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
}

export async function resetSeededAlias(page: Page) {
  await page.evaluate(async (id) => {
    const res = await fetch(`/api/aliases/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-mailvault": "1" },
      body: JSON.stringify({ archived: false, pinned: false }),
    });
    if (!res.ok) throw new Error(`reset alias ${id}: ${res.status}`);
  }, SEEDED_ALIAS);
}
