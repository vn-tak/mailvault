# MailVault V1 — Private Persistent Domain Mail

MailVault is a **receive-only** personal mail system that turns domains you already
own on Cloudflare into private inboxes of disposable **aliases**, optimized for
capturing **one-time passcodes (OTPs)**, verification links and password-reset
mail. Aliases and messages persist **indefinitely** — nothing expires automatically.

It runs as a single Cloudflare Worker (HTTP `fetch` + inbound `email` handlers) with
D1 for metadata, a private R2 bucket for raw/normalized content and attachments,
Workers Static Assets for the SPA, and Cloudflare Access for authentication.

---

## Status

| Area | State |
|------|-------|
| Worker (API + inbound email) | ✅ Implemented |
| Shared types/validation (`packages/shared`) | ✅ Implemented |
| D1 schema + migration | ✅ Implemented (`apps/worker/migrations/0001_init.sql`) |
| React SPA (Dashboard / Domains / Aliases / Alias detail / Inbox / Message / Settings) | ✅ Implemented |
| Installable PWA + payload-free new-mail notifications | ✅ Implemented |
| Phone layout: bottom tab bar, card lists, safe-area insets, 44px targets | ✅ Mobile-first (E2E at 412px) |
| Reading view: re-flowed plain text, folded magic links, tracking-wrapper destinations, HTML frame that fits the screen | ✅ Fixture + E2E covered |
| One mailbox per domain: dashboard mailbox cards, inbox picker, per-row arrival domain | ✅ Implemented |
| Row actions folded until engaged (tap / hover / focus), bulk actions only with a selection | ✅ E2E covered |
| Unit + integration tests (168 passing: worker 114, web 54) | ✅ Green |
| Playwright E2E (19 passing, live workerd + local D1/R2) | ✅ Green |
| Deployed + receiving real mail on 32 of 36 owner domains (4 excluded by config) | ✅ Live |

See [`DEPLOYMENT.md`](./DEPLOYMENT.md): the implementation receipt records the state at
build time (no Cloudflare credentials existed in that environment, so it says
`REAL DOMAIN MUTATIONS: NONE` and `DEPLOYMENT_BLOCKED_CREDENTIALS` rather than pretending
otherwise), and its addendum records what has since been deployed and measured live.

---

## Architecture

```
Cloudflare Email Routing (per-domain catch-all rule)
                    │  inbound mail
                    ▼
        ┌───────────────────────────┐
        │   mail-vault Worker       │   email() ── ingest: parse MIME (postal-mime),
        │                           │            extract OTP + verification links,
        │   fetch()  ── Hono API    │            store raw .eml + parsed JSON in R2,
        │   /api/*  (authenticated) │            write metadata row in D1
        └───────────┬───────┬───────┘
                    │       │
             ┌──────▼──┐ ┌──▼────────┐        D1: domains, aliases, messages,
             │   D1    │ │    R2     │            attachments, provisioning_events
             │ metadata│ │ raw+parsed│        R2: raw .eml, parsed JSON, attachments
             └─────────┘ │ +attach.  │        (private bucket — never public)
                         └───────────┘
                    ▲
        ┌───────────┴────────────┐
        │  Workers Static Assets │  React SPA (auth via Cloudflare Access JWT)
        └────────────────────────┘
```

- **One deployable.** The Worker serves the API under `/api/*` and the SPA for every
  other path (`run_worker_first: true`), so security headers are applied to the
  HTML document and assets too.
- **Mail is hostile input.** Raw `.eml` is stored verbatim; HTML is sanitized
  server-side and rendered only inside a `sandbox=""` iframe in the browser. The SPA
  never injects email markup into its own DOM.
- **No content ever expires.** No TTL, no cron deletion, no R2 lifecycle rule.
  Deletion happens only through explicit owner actions in the UI.

## Repository layout

```
apps/
  worker/            Cloudflare Worker: Hono API + email() ingest + provisioning
    src/
      index.ts       entrypoint (fetch + email)
      app.ts         router factory: auth → CSRF → routes
      auth.ts        Cloudflare Access JWT verification (+ dev-bypass guard)
      routes/        health, dashboard, domains, aliases, messages
      mail/          MIME parse, OTP extraction, link extraction, preview, normalize
      provisioning/  MX assessment, read-only preflight, owner-triggered provisioner
      security/      HTML sanitizer + security headers/CSRF
      storage/       R2 helpers
      db/            D1 data access + row mappers
      cf/            Cloudflare REST client (token from secret only)
    migrations/      D1 SQL
    test/            unit + integration + .eml fixtures
  web/               React 18 + Vite SPA (custom hash router, no UI framework)
    src/pages/       Dashboard, Domains, Aliases, AliasDetail, Inbox, MessageDetail, Settings
    src/components/  ui primitives, sandboxed MessageHtml
    e2e/             Playwright specs (against same-origin wrangler dev)
packages/
  shared/            Zod schemas + TS types shared by worker and web
```

## Getting started (local)

```bash
corepack enable            # uses pnpm@10 pinned in package.json
pnpm install

# Quality gates (all must pass):
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e            # boots its own same-origin Worker (see below); needs `npx playwright install chromium`
```

### Run the full app locally

The browser needs a Worker that serves both `/api/*` and the SPA on one origin so
CSRF "same-origin" holds.

```bash
pnpm build:web                                   # produce apps/web/dist
pnpm --filter @mailvault/worker dev:e2e          # migrate+seed local D1, then wrangler dev :8787
# open http://localhost:8787
```

`dev:e2e` uses `wrangler.dev.jsonc` (`DEV_AUTH_BYPASS=true`, `ENVIRONMENT=development`)
and seeds one Ready domain + one alias from `scripts/seed.sql`. **This is local only** —
the bypass cannot take effect when `ENVIRONMENT=production`, and the seed never reaches
a real account.

### Frontend unit/dev

```bash
pnpm --filter @mailvault/web dev      # Vite dev server on :5173, proxies /api → :8787
pnpm --filter @mailvault/web test     # Vitest + Testing Library
```

## API surface

All `/api/*` except `/api/health` require a valid Cloudflare Access identity and, for
state-changing methods, the `x-mailvault: 1` header + same-origin (CSRF).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Liveness (unauthenticated, coarse) |
| GET | `/api/dashboard` | Counts + recent messages |
| GET | `/api/domains` | Tracked domains |
| POST | `/api/domains/sync` | Import zones from Cloudflare (read-only CF) |
| POST | `/api/domains/preflight` | Read-only conflict checks (no CF mutation) |
| POST | `/api/domains/provision` | Enable mail on selected zones (owner action; takes over catch-all only with explicit confirm) |
| POST | `/api/domains/:id/retry` | Retry provisioning for one zone |
| DELETE | `/api/domains/:id` | Forget a domain locally (**never** deletes the Cloudflare zone) |
| GET | `/api/aliases` | List/search aliases (`?view=active\|archived\|all`, pinned first) |
| POST | `/api/aliases` | Create alias (random / service_random / custom) |
| GET | `/api/aliases/:id` | One alias + arrival history (counts, first/last, top senders) |
| PATCH | `/api/aliases/:id` | Update label, notes, pinned, archived (partial) |
| POST | `/api/aliases/:id/enable` \| `/disable` | Toggle receiving |
| DELETE | `/api/aliases/:id` | Delete alias; purge messages only if `purgeMessages` |
| GET | `/api/messages` | Paginated inbox; filters + FTS5 search over subject/preview/sender, exact OTP-code and alias match |
| GET | `/api/messages/:id` | Detail with sanitized HTML, codes, links, attachments |
| PATCH | `/api/messages/:id/read` | Set read flag |
| DELETE | `/api/messages/:id` | Delete a message (+ its R2 objects) |
| GET | `/api/messages/:mid/attachments/:aid` | Authenticated attachment download (`Content-Disposition`, `nosniff`) |
| GET | `/api/push/public-key` \| `/status` | VAPID public key + subscription count (never the endpoints) |
| POST | `/api/push/subscribe` \| `/unsubscribe` \| `/test` | Register / drop a browser subscription; owner test send |

## Security posture (summary)

See [`SECURITY.md`](./SECURITY.md) for the full model. Highlights:

- The Cloudflare API token lives **only** as a Worker secret; it is never sent to the
  browser, stored in D1, logged, or returned by any endpoint.
- **No automatic domain mutation on startup or deploy.** Provisioning is strictly
  owner-triggered after an explicit action.
- Foreign **MX** and **catch-all** records are detected and **never silently
  overwritten** — conflicts are reported and must be confirmed.
- Email HTML is sanitized and rendered in a sandboxed iframe; remote images are
  blocked by default; a plain-text fallback always exists.
- R2 is private; every message/attachment read goes through authenticated routes.
- Security headers (CSP, `nosniff`, frame-ancestors, COOP/CORP, HSTS) are applied to
  every response; `DEV_AUTH_BYPASS` cannot take effect in production.

## Notes on this build environment

`@cloudflare/vitest-pool-workers` cannot boot `workerd` from this project path
(contains a space, which breaks the pool's virtual-module resolution). Integration
tests therefore run in a normal Node Vitest pool and drive real D1/R2 through
programmatic **Miniflare**. Application code runs on Node's native
`fetch`/`Response`/`crypto`. This keeps the tests exercising genuine storage
engines without depending on the broken pool.

This limitation is confined to that Vitest pool: `wrangler dev` and the Playwright E2E
suite both run correctly from the same path, so the Worker is exercised in a real
workerd runtime end-to-end. Upgrading `wrangler` (and the pool) to v4 would let the
worker integration tests run on the same workerd build as production.
