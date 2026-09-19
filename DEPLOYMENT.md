# MailVault — Deployment & Operations Runbook

Deploying MailVault has **two very different kinds of change**, and this runbook keeps
them separate on purpose:

1. **Application infrastructure deploy** — the Worker, D1, R2 and static assets. This
   is ordinary and reversible.
2. **Real domain mutations** — enabling Email Routing / MX / catch-all on a live
   domain. This is **never** automatic: it happens only when the signed-in owner clicks
   *Enable mail* in the app, after a read-only preflight, and it **never** overwrites a
   foreign provider's MX records.

---

## Implementation receipt

```
PROJECT:        MailVault V1 — private persistent domain-mail inbox (Cloudflare)
COMMIT STATE:   working tree at /Users/tunbee27/Documents/mail sever (not a git repo)

QUALITY GATES (run in this environment):
  pnpm install            ✅ (workspace already resolved)
  pnpm typecheck          ✅  shared / worker / web  — no errors
  pnpm lint               ✅  eslint .               — no errors/warnings
  pnpm test               ✅  49 tests passed (worker 32, web 17)
  pnpm build              ✅  web vite build + worker `wrangler deploy --dry-run` bundle ok
  pnpm test:e2e           ✅  5 Playwright tests passed against a live workerd Worker

COVERAGE:
  worker unit             ✅  mail parse/OTP/links/preview/filename/MX + sanitize + preflight(no-mutation) + fixtures(.eml)
  worker integration      ✅  D1/R2 via Miniflare: ingest/accept/reject/dedupe/size + full HTTP API (auth/CSRF/alias/message/attachment)
  web unit                ✅  router + formatting + UI primitives (Testing Library)
  web e2e (Playwright)    ✅  EXECUTED — dashboard health pill, nav, Domains read-only table, Inbox filters,
                                alias create → disable → delete through the real Worker + local D1/R2

LIVE-RUNTIME PROBE (manual, `wrangler dev` on :8787):
  GET  /                        ✅ SPA served, full CSP / nosniff / X-Frame-Options / COOP / CORP headers present
  GET  /api/domains             ✅ returns the seeded READY domain
  POST /api/aliases (no header) ✅ 403 BAD_ORIGIN (CSRF enforced in the real runtime)
  POST /api/aliases (valid)     ✅ 201, "E2E Test!" sanitized to local part `e2e-test-j7wud7`

REAL DOMAIN MUTATIONS:    NONE
  No Email Routing was enabled, no MX/catch-all record was created or changed, and no
  Cloudflare zone was touched. No Cloudflare account, API token, D1, R2 or Access
  instance was provisioned against a live account from this environment.

STATUS:                   DEPLOYMENT_BLOCKED_CREDENTIALS
```

## Why `DEPLOYMENT_BLOCKED_CREDENTIALS`

The build could not be deployed here because the required, secret, account-specific
inputs are **not present** (and must not be fabricated):

- A Cloudflare **account id** and a **least-privilege API token** (`wrangler secret put
  CLOUDFLARE_API_TOKEN`).
- A **D1 database** and **R2 bucket** created on the account (the ids/names in
  `wrangler.jsonc` are placeholders).
- A **Cloudflare Access** self-hosted application (team domain + `AUD`).
- A **custom hostname** + DNS for the app origin.
- Wrangler login for `wrangler deploy` / `d1 migrations apply --remote`.

Per the project rules, deployment was **not** faked. Everything that does not require a
live account is complete, green and committed to the tree.

## How the E2E suite runs

`pnpm test:e2e` boots the Worker itself via `webServer` →
`pnpm --filter @mailvault/worker dev:e2e`, which applies migrations, seeds
`scripts/seed.sql`, and serves the built SPA **and** `/api/*` from one origin
(`http://localhost:8787`). Same-origin is required: the browser's `Origin` must equal
the request host for the CSRF check to pass, so the Vite dev proxy is deliberately not
used for E2E.

```bash
npx playwright install chromium      # once
pnpm build:web
pnpm test:e2e
```

Verified locally with the bundled `wrangler 3.114.17` + its workerd, using
`wrangler.dev.jsonc` (`compatibility_date: 2024-12-30`, `DEV_AUTH_BYPASS=true`,
`ENVIRONMENT=development`). Result: **5 passed**.

> Note: `wrangler dev` and Playwright work fine from this project path. The path-space
> problem is confined to `@cloudflare/vitest-pool-workers`, whose virtual-module
> resolution mis-encodes the space in `mail sever`; that is why the worker's integration
> tests drive D1/R2 through programmatic Miniflare instead. Upgrading wrangler to v4
> (and the pool with it) would let those tests run on the same workerd build the
> production Worker uses — a worthwhile follow-up, not a blocker.

---

## Prerequisites (owner, one-time)

```bash
# 1. Install deps
corepack enable && pnpm install

# 2. Create remote D1 + R2 and paste real ids into apps/worker/wrangler.jsonc
wrangler d1 create mail-vault-db
wrangler r2 bucket create mail-vault-storage

# 3. Confirm the Worker's own name + APP_ORIGIN/CF_ACCESS_* in wrangler.jsonc
```

## Deploy application infrastructure

```bash
# From apps/worker (or via root scripts):
pnpm build:web                       # produces apps/web/dist served as assets
pnpm --filter @mailvault/worker db:migrate:remote   # apply 0001_init.sql to prod D1
pnpm --filter @mailvault/worker deploy              # wrangler deploy

# Secrets (never committed, never in vars):
wrangler secret put CLOUDFLARE_API_TOKEN            # least-privilege token, see below

# Put the deployed Worker behind Cloudflare Access:
#   - Zero Trust → Access → Applications → Self-hosted
#   - policy = the owner's email(s); set a login policy
#   - copy the AUD tag and team domain into CF_ACCESS_AUD / CF_ACCESS_TEAM_DOMAIN
#   - restrict direct access to the Worker route to Access only
```

### API token scope (least privilege)

Create one **User API Token** per zone you want MailVault to manage, scoped to exactly
those zones:

- **Zone / Zone / Read** — enumerate + inspect the zone
- **Zone / DNS / Read** — read MX records for conflict detection
- **Zone / Email Routing Rules / Edit** — read and set the catch-all → Worker
- **Account / Email Routing Addresses / Read** — carries the account resource the Email
  Routing endpoints require

Do **not** use a Global API Key, and do not grant `Zone / DNS / Edit`: it was tested and
does **not** unlock anything MailVault needs (see the constraint below).

### Constraint: an API token cannot enable Email Routing

Measured against a live account, not inferred:

| Call with a scoped API token | Result |
|---|---|
| `GET /zones/{id}/dns_records?type=MX` | ✅ 200 |
| `GET /zones/{id}/email/routing/rules/catch_all` | ✅ 200 |
| `PUT /zones/{id}/email/routing/rules/catch_all` | ✅ 200 |
| `GET /zones/{id}/email/routing` (settings flag) | ❌ 403 `cfCode 10000` |
| `POST /zones/{id}/email/routing/enable` | ❌ 403 `cfCode 10000` |

The two failures above persist with `Email Routing Rules:Edit`, `Zone:Read`,
`Email Routing Addresses:Read` **and** `DNS:Edit` granted, and Cloudflare exposes no
token permission group for them in that account. The same calls succeed with a broader
dashboard/OAuth credential, so this is a token-permission gap, not a bug in the client.

Two consequences are already built in:

1. **Preflight derives routing state from DNS.** Cloudflare only publishes
   `route*.mx.cloudflare.net` records once Email Routing is on, so the unreadable
   `enabled` flag is not needed. If the flag read fails for any *other* reason, the
   error still propagates — the fallback is deliberately narrow.
2. **Onboarding a brand-new domain is a two-step, owner-driven action.**

## Enable mail per domain (owner-triggered, in the app)

1. **Enable Email Routing once for the zone** in the Cloudflare dashboard
   (Zones → *domain* → Email Routing → Enable). This is the single step an API token is
   not permitted to perform. It adds Cloudflare's own MX/SPF records.
2. **Domains → Sync from Cloudflare.** Read-only import of the zones the token can see.
   No DNS change.
3. **Domains → Preflight all** (or select, then Preflight). Read-only: reports
   `Ready to enable` / `Already configured` / `MX conflict` / `Catch-all conflict` /
   `Permission error`, and auto-expands any domain that is not safe. Nothing is
   mutated — the preflight unit test asserts an empty mutation log.
4. **Select → Enable mail.** After an explicit confirmation the Worker:
   - runs preflight again; a **foreign MX** stops it and reports a conflict (never
     overwrites), and a **foreign catch-all** is replaced only if the owner also ticks
     *Take over catch-all*;
   - skips the enable call when Cloudflare MX already exist (no redundant mutation), and
     otherwise attempts it;
   - points the catch-all rule at the MailVault Worker;
   - **verifies** routing is on *and* the catch-all targets this Worker before marking
     the domain `READY`. A single 200 is never trusted.
5. If step 1 was skipped, the receipt says so explicitly and tells the owner to enable
   routing in the dashboard and press **Retry** — it does not surface a bare
   "Authentication error".

`enable mail` performs exactly these steps:
`email_routing_dns → catch_all_worker → verify`.

## Receiving & reading mail

- Create **aliases** (random / service-prefixed / custom) on any `READY` domain. Only
  aliases in the `ACTIVE` state accept mail; unknown recipients are rejected and never
  auto-created.
- Incoming OTPs, verification links, sanitized HTML and attachments appear in the
  **Inbox**. Remote images stay blocked until the owner opts in per message.
- **Nothing expires.** Deleting a message or an alias (with optional purge) is the only
  way content is removed.

## Removal / teardown

- **Remove a domain** in the app deletes only the local MailVault row. It refuses while
  aliases exist and **never** deletes the Cloudflare zone or its DNS.
- **Delete an alias** keeps existing mail unless *also delete all messages* is checked,
  which then purges the D1 rows and the R2 objects.
- Un-deploying the app (`wrangler delete`, dropping D1/R2) is a separate, deliberate
  operator action outside the app.

## Rollback

`wrangler` keeps previous Worker versions. `pnpm --filter @mailvault/worker deploy`
again with an earlier build, or `wrangler rollback`, restores the previous Worker. D1
migrations are additive; roll forward with a new migration rather than editing history.
