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

### Addendum — what actually shipped (2026-09-19)

The receipt above is kept exactly as it was written at implementation time, including its
`DEPLOYMENT_BLOCKED_CREDENTIALS` line: no credentials existed in that environment and
fabricating a deployed state was the correct thing to refuse. That is no longer the state
of this system, so this addendum records the difference.

- **Deployed:** D1 `mail-vault-db`, R2 `mail-vault-storage`, Worker `mail-vault` + SPA on
  `https://mail.omnipos.tech` behind Cloudflare Access with a single owner address in
  `ALLOWED_EMAILS`. `workers_dev` is off, so the Worker is reachable only through that
  Access-protected route. The Cloudflare API token exists only as a Worker secret.
- **Real domain mutations: 3 zones, each one an explicit owner click in the app** —
  `omnipos.tech`, `datlichngay.com`, `tung.codes`. Email Routing was enabled by MailVault's
  own token, the catch-all points at the MailVault Worker, and `READY` was recorded only
  after re-reading both. Public DNS confirms `route1-3.mx.cloudflare.net` on the enabled
  zones. The remaining 35 zones were classified as conflicts and left untouched.
- **Inbound proven with real mail**, including a live provider email whose 8-digit OTP was
  extracted at 0.85 confidence while a postal code in the same message was demoted to 0.47.
- **Gates at this writing:** 103 tests (worker 81, web 22), 5 E2E; lint and typecheck clean.
  The five later slices — sender authentication, drift watchdog, FTS5 search, alias
  lifecycle, PWA + payload-free push — were each built, tested and deployed on
  `feat/mailvault-v1`; see `git log` and `SECURITY.md` §6.1/§8.1/§9 for their contracts.

## Why it was `DEPLOYMENT_BLOCKED_CREDENTIALS`

At implementation time the build could not be deployed here because the required, secret,
account-specific inputs were **not present** (and must not be fabricated):

- A Cloudflare **account id** and a **least-privilege API token** (`wrangler secret put
  CLOUDFLARE_API_TOKEN`).
- A **D1 database** and **R2 bucket** created on the account (the ids/names in
  `wrangler.jsonc` are placeholders).
- A **Cloudflare Access** self-hosted application (team domain + `AUD`).
- A **custom hostname** + DNS for the app origin.
- Wrangler login for `wrangler deploy` / `d1 migrations apply --remote`.

Per the project rules, deployment was **not** faked. Everything that did not require a
live account was complete, green and committed to the tree — and each item above was
supplied by the owner afterwards, which is what the addendum records.

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
wrangler secret put VAPID_PRIVATE_KEY               # optional: enables notifications

# VAPID key pair (only if you want push notifications). The Worker derives the public
# half from this JWK, so there is one value to keep and no way for them to disagree:
node -e 'const{generateKeyPairSync}=require("node:crypto");const{privateKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});console.log(JSON.stringify(privateKey.export({format:"jwk"})))' \
  | pbcopy                      # then: wrangler secret put VAPID_PRIVATE_KEY  (paste)
# and set VAPID_SUBJECT (a var, not a secret) to a contact, e.g. mailto:you@example.com

# Put the deployed Worker behind Cloudflare Access:
#   - Zero Trust → Access → Applications → Self-hosted
#   - policy = the owner's email(s); set a login policy
#   - copy the AUD tag and team domain into CF_ACCESS_AUD / CF_ACCESS_TEAM_DOMAIN
#   - restrict direct access to the Worker route to Access only
```

### API token scope (least privilege)

Create **one** User API Token.

- **Zone / Zone / Read** — enumerate + inspect the zone
- **Zone / DNS / Read** — read MX records for conflict detection
- **Zone / Email Routing Rules / Edit** — read and set the catch-all → Worker
- **Account / Email Routing Addresses / Read** — carries the account resource the Email
  Routing endpoints require

Do **not** use a Global API Key, and do not grant `Zone / DNS / Edit`: it was tested and
does **not** unlock anything MailVault needs (see the constraint below).

Set *Zone Resources* to **All zones from an account**. A per-zone list was tried first
and rejected: it forces a dashboard edit before MailVault can even *see* a new domain, and
it makes `email/routing/enable` fail with an error that looks like a missing permission
(next section). The scope changes which zones the *existing four* permissions apply to, so
judge it by what they can do on a zone MailVault has no business touching:

- `Zone:Read` + `DNS:Read` are read-only on the owner's own zones.
- `Email Routing Addresses:Read` is read-only.
- `Email Routing Rules:Edit` is the single write: it sets the catch-all rule and, through
  the same permission, enables Email Routing. Both are bounded in code, not by the token.

What actually limits the blast radius is the code path: an HTTP route can only name zones
the owner selected, each must already be a row in MailVault's own `domains` table, the
preflight **allow-list** refuses mutation unless the classification is `Ready to enable`,
`Already configured`, or `Catch-all conflict` *with* the owner's explicit take-over tick,
foreign MX is never overwritten, and none of this runs on startup.

### Constraint: what an API token can and cannot do for Email Routing

Measured against a live account — and an earlier reading of the same measurement was wrong
in a way worth recording, because the failure mode is genuinely misleading:

| Call with the runtime API token | Result |
|---|---|
| `GET /zones/{id}/dns_records?type=MX` | ✅ 200 |
| `GET /zones/{id}/email/routing/rules/catch_all` | ✅ 200 |
| `PUT /zones/{id}/email/routing/rules/catch_all` | ✅ 200 |
| `POST /zones/{id}/email/routing/enable` | ✅ 200 — but ❌ 403 `cfCode 10000` when the zone is outside the token's *Zone Resources* |
| `GET /zones/{id}/email/routing` (settings flag) | ❌ 403 `cfCode 10000`, in every scope and permission combination tried |

- **Enabling Email Routing *is* token-performable.** It was first written down as
  impossible because `cfCode 10000` ("Authentication error") is also what Cloudflare
  returns when the *zone* falls outside the token's resources — the two causes are
  indistinguishable from the response. After `Zone Resources = All zones from an account`,
  a clean zone went from `Ready to enable` to `READY` entirely inside the app, and public
  DNS confirms `route1-3.mx.cloudflare.net` was created for it. **Adding a domain now needs
  no dashboard step at all.**
- **Reading the routing settings flag is not token-performable**, in either scope: it stays
  403 with `Email Routing Rules:Edit`, `Zone:Read`, `Email Routing Addresses:Read` and even
  `DNS:Edit` granted, and Cloudflare exposes no permission group for it. Consequence,
  already built in: preflight derives routing state from DNS instead, since Cloudflare only
  publishes `route*.mx.cloudflare.net` once Email Routing is on. If that read fails for any
  *other* reason the error still propagates — the fallback is deliberately narrow.

## Enable mail per domain (owner-triggered, in the app)

1. **Domains → Sync from Cloudflare.** Read-only import of every zone the token can see —
   with `All zones from an account` that is the whole account, so a domain the owner adds in
   Cloudflare shows up here without any token edit. No DNS change.
2. **Domains → Preflight all** (or select, then Preflight). Read-only: reports
   `Ready to enable` / `Already configured` / `MX conflict` / `Catch-all conflict` /
   `Permission error`, and auto-expands any domain that is not safe. Nothing is
   mutated — the preflight unit test asserts an empty mutation log.
3. **Select → Enable mail.** After an explicit confirmation the Worker:
   - runs preflight again; a **foreign MX** stops it and reports a conflict (never
     overwrites), and a **foreign catch-all** is replaced only if the owner also ticks
     *Take over catch-all*;
   - skips the enable call when Cloudflare MX already exist (no redundant mutation), and
     otherwise attempts it;
   - points the catch-all rule at the MailVault Worker;
   - **verifies** routing is on *and* the catch-all targets this Worker before marking
     the domain `READY`. A single 200 is never trusted.
4. **Troubleshooting only:** if a receipt ever says routing could not be enabled, the first
   thing to check is the token's *Zone Resources* for that zone, not the dashboard —
   MailVault names both causes in the receipt and links to the Email Routing console.
   Nothing is ever surfaced as a bare "Authentication error".

`enable mail` performs exactly these steps:
`email_routing_dns → catch_all_worker → verify`.

## Ongoing health: the drift watchdog

A zone can be edited from the dashboard at any time (by you, a teammate, or another tool),
and then mail simply stops arriving. Two things guard against discovering that by accident:

- **Hourly, automatically** (`triggers.crons` → `7 * * * *`): every domain marked `READY`
  is re-read — are Cloudflare's routing MX still in DNS, and does the catch-all still point
  at this Worker?
- **On demand:** Domains → **Verify delivery**, which runs the same sweep and reports
  `checked / drifted / restored / failed`.

What it does on drift: marks the domain `CONFLICT` with `DRIFT` and names the new
destination, records a `watchdog:drift` event, and restores the domain when the path comes
back. What it never does: enable routing, edit DNS, or rewrite someone else's catch-all to
win mail back — re-taking a zone is an owner decision, made with *Enable mail*. A zone whose
reads fail is left alone, because "unknown" is not evidence of drift.

This matters in practice: during development of this slice, another operator enabled
`vnecs.com`/`vnecs.store` (with catch-all take-over) and removed two other domains from
tracking while the app was being tested — exactly the kind of concurrent change a status
page that never refreshes would hide.

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
