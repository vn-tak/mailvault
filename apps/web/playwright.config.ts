import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end UI tests run against the SAME-ORIGIN local Worker dev server
 * (`pnpm --filter @mailvault/worker dev:e2e`), which serves the built SPA and the
 * `/api/*` router from one origin. Same-origin is deliberate: the browser `Origin`
 * then equals the request host, so the Worker's CSRF check passes without needing
 * the Vite dev proxy. `dev:e2e` also applies migrations and seeds a demo domain +
 * alias into local D1, so no real Cloudflare account or DNS is required.
 *
 * Requires a wrangler/workerd version whose runtime date covers the config's
 * compatibility_date, plus Playwright browser binaries:
 *   npx playwright install chromium
 */
const PORT = Number(process.env.E2E_PORT ?? 8787);
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "on-first-retry",
  },
  projects: [
    // Desktop layout. Tests tagged @mobile are handset-only and run once, below.
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, grepInvert: /@mobile/ },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        // Pixel-class handset: Chromium (the only installed browser) with mobile
        // emulation, so `@media (pointer: coarse)` and touch behaviour apply.
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 2.6,
        isMobile: true,
        hasTouch: true,
      },
      grep: /@mobile/,
    },
  ],
  webServer: {
    command: `pnpm --filter @mailvault/worker dev:e2e`,
    url: `${BASE}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
