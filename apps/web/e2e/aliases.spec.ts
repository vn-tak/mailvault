import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

/** A row keeps its actions folded until it is engaged — so engage it. */
async function engage(row: Locator) {
  await row.locator(".entity-summary").click();
  await expect(row.locator(".entity-actions")).toBeVisible();
}

test("lists the seeded alias, then creates and removes one", async ({ page }) => {
  await page.goto("/#/aliases");
  await expect(page.getByRole("heading", { name: "Aliases" })).toBeVisible();
  await expect(page.getByText("github-x9f2@demo.example")).toBeVisible();

  // Create a random alias for the demo domain.
  await page.getByRole("button", { name: "+ Create alias" }).click();
  const modal = page.getByRole("dialog", { name: "Create alias" });
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder("GitHub Personal").fill("E2E alias");
  await modal.getByRole("button", { name: "Random" }).click();
  await modal.getByRole("button", { name: /^Create alias$/ }).click();

  const row = page.locator(".entity").filter({ hasText: "E2E alias" });
  await expect(row).toBeVisible();

  // Disable then delete it to keep runs independent.
  await engage(row);
  await row.getByRole("button", { name: "Disable" }).click();
  await expect(row.getByText("Disabled")).toBeVisible();

  await engage(row);
  await row.getByRole("button", { name: "More" }).click();
  await row.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete alias" }).click();
  await expect(page.getByText("E2E alias")).toHaveCount(0);
});

/*
 * The custom-name path, which used to be the feature's most obvious failure: typing a
 * capital produced "Validation failed" with nothing to act on. Now the name is normalized,
 * the reason appears beside the field while typing, and the preview is the address that
 * actually gets stored.
 */
test("a custom name is normalized, explained, and creates what it previewed", async ({ page }) => {
  await page.goto("/#/aliases");
  // A crashed earlier run must not turn this into a duplicate-name failure.
  await page.evaluate(async () => {
    const list = await (await fetch("/api/aliases?q=e2e.tung&view=all")).json();
    for (const a of list.items ?? []) {
      await fetch(`/api/aliases/${a.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", "x-mailvault": "1" },
        body: JSON.stringify({ purgeMessages: true }),
      });
    }
  });

  await page.getByRole("button", { name: "+ Create alias" }).click();
  const modal = page.getByRole("dialog", { name: "Create alias" });
  await modal.getByRole("button", { name: "Custom" }).click();
  const name = modal.getByLabel("Custom local part");
  const create = modal.getByRole("button", { name: /^Create alias$/ });

  await name.fill("postmaster");
  await expect(modal.getByRole("alert")).toContainText("reserved");
  await expect(create).toBeDisabled();

  await name.fill("  E2E.Tung  ");
  await expect(modal.getByRole("alert")).toHaveCount(0);
  await expect(modal.locator(".addr")).toHaveText("e2e.tung@demo.example");
  await expect(create).toBeEnabled();
  await create.click();

  const row = page.locator(".entity").filter({ hasText: "e2e.tung@demo.example" });
  await expect(row).toBeVisible();
  await engage(row);
  await row.getByRole("button", { name: "More" }).click();
  await row.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete alias" }).click();
  await expect(row).toHaveCount(0);
});
