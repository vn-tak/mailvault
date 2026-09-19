import { expect, test } from "@playwright/test";

test("domains table shows the seeded Ready domain without mutating anything", async ({ page }) => {
  await page.goto("/#/domains");
  await expect(page.getByRole("heading", { name: "Domains" })).toBeVisible();
  await expect(page.getByText("demo.example")).toBeVisible();
  await expect(page.getByText("Ready").first()).toBeVisible();
  // The bulk action buttons stay disabled until rows are selected (section 9:
  // no domain mutation without an explicit owner action).
  await expect(page.getByRole("button", { name: /Enable mail/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Preflight/ })).toBeDisabled();
});

test("inbox renders its filter controls", async ({ page }) => {
  await page.goto("/#/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unread" })).toBeVisible();
});
