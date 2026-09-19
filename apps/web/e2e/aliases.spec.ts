import { expect, test } from "@playwright/test";

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
  await row.getByRole("button", { name: "Disable" }).click();
  await expect(row.getByText("Disabled")).toBeVisible();

  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete alias" }).click();
  await expect(page.getByText("E2E alias")).toHaveCount(0);
});
