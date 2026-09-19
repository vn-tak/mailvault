# MailVault Security Model

This document maps the security requirements for a private, internet-facing
receive-only mail system onto the actual implementation, and states the threat model.
Email is treated as **hostile input at every layer**.

Scope: personal/self-hosted use by a single owner behind Cloudflare Access. Not
multi-tenant SaaS.

---

## 1. Trust boundaries

```
Internet ──SMTP──▶ Cloudflare Email Routing ──▶ Worker.email()   [untrusted input]
Browser ──HTTPS──▶ Cloudflare Access ──JWT──▶ Worker.fetch()      [authenticated]
                     Worker ──token(secret)──▶ Cloudflare API     [privileged egress]
                     Worker ◀──▶ D1 / R2                          [private storage]
```

The owner's browser is untrusted for CSRF; the sender of any email is entirely
untrusted; the Cloudflare API token is the single most sensitive secret.

---

## 2. Secrets & the Cloudflare API token

**Rule:** the runtime token exists *only* as a Worker secret.

- Typed as a secret binding in `apps/worker/src/env.ts`
  (`CLOUDFLARE_API_TOKEN?: string`). Set with `wrangler secret put` (prod) or
  `.dev.vars` (local). Never a plain-text `vars` value.
- The Cloudflare client is constructed per-request from `env` in
  `apps/worker/src/routes/_helpers.ts` → `cfClient(env)`. If unset it throws a
  `503 CLOUDFLARE_TOKEN_UNSET` and **never** echoes the value.
- The token is never placed in a response body, D1 row, R2 object, or the browser.
- Least-privilege: the token only needs *Email Routing* + *Zone/DNS read+edit* on the
  owner's zones. A Global API Key is **not** supported or required.
- Log scrubbing: `apps/worker/src/lib/logging.ts` allow-lists safe fields and
  redacts a set of keys (`token`, `authorization`, `cf_authorization`, `api_key`,
  `cloudflare_api_token`, `raw`, `body`, `otp`, `code`, `jwt`, `cookie`) to
  `[redacted]`. Error messages are truncated and never include request headers.

**Why it matters:** a leaked token would let an attacker mutate DNS/mail for every
domain in the account — the blast radius is the whole account, so it is isolated as a
secret and scrubbed from every log path.

## 3. Authentication (private by default)

`apps/worker/src/auth.ts`:

- Identity comes from a Cloudflare **Access** application JWT, validated with `jose`
  against the team's remote JWKS: signature, issuer (`team domain`), audience
  (`CF_ACCESS_AUD`) and expiry are all verified. Preferred source is the
  `cf-access-jwt-assertion` header, falling back to the `CF_Authorization` cookie.
- An optional `ALLOWED_EMAILS` allowlist further restricts which Access users are
  honored; an empty list means "any authenticated Access user".
- Service tokens (no `email` claim) are rejected.
- The only **public** endpoint is `GET /api/health` (coarse liveness). Everything
  under `/api/*` is authenticated in `apps/worker/src/app.ts` before routing;
  unauthorized requests get `401 UNAUTHORIZED`. No stack traces leak (Hono `onError`
  returns a structured `{ error: { code, message } }`).

### Dev bypass cannot reach production

`apps/worker/src/env.ts` → `devAuthBypassEnabled()` returns true **only** when
`DEV_AUTH_BYPASS=="true"` **and** `ENVIRONMENT` is one of `development/local/test`.
Production config ships `ENVIRONMENT=production`, so the bypass is inert regardless of
the flag — accidental exposure is structurally impossible.

## 4. CSRF & same-origin

`apps/worker/src/security/headers.ts` → `checkCsrf()`, wired as middleware after auth:

- State-changing methods (anything but GET/HEAD/OPTIONS) must carry the custom header
  `x-mailvault: 1`. A cross-site form cannot set custom headers.
- `Origin` (or `Referer`) host must equal the request host **or** the configured
  `APP_ORIGIN`. This is why E2E/dev run same-origin.
- Failures return `403 BAD_ORIGIN`.

## 5. Response hardening (every response)

`decorateResponse()` in `index.ts` wraps **both** the API and the static-asset path,
so success, error, 404 and SPA-document responses all get:

- `Content-Security-Policy`: `default-src 'self'`; `script-src 'self'`;
  `frame-ancestors 'none'`; `form-action 'none'`; `object-src 'none'`;
  `base-uri 'none'`; `connect-src 'self'`; `img-src 'self' data: blob:`;
  `frame-src 'self' blob: data:` (for the sandboxed email frame).
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Cross-Origin-Resource-Policy/Opener-Policy: same-origin`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
  `Permissions-Policy`.
- `Strict-Transport-Security` on API responses in production.

## 6. Email content handling (hostile input)

Parsing: `apps/worker/src/mail/parse.ts` uses `postal-mime`; the raw `.eml` is always
kept in R2 so nothing is lost even on degraded parses (`parseDegraded`).

Sanitization: `apps/worker/src/security/sanitize-html.ts` (`sanitizeEmailHtml`):

- Drops `<script>`, `<style>`-with-content, event-handler attributes (`on*`),
  `<iframe>/<object>/<embed>/<form>`, and disallowed tags — unknown tags are removed
  while their inner text is HTML-escaped, so leftover text can never execute.
- `javascript:`/`data:`/`vbscript:` and other unsafe URLs are stripped from `href`.
- Remote images are **blocked by default**; they render only when the owner opts in
  per-message (`?remoteImages=1`), because loading them discloses the reader's IP and
  that the mail was opened.
- Surviving links get `rel="noopener noreferrer"`.

Rendering: the SPA's `MessageHtml.tsx` injects the sanitized HTML into an
`iframe` with `sandbox=""` (no scripts, no same-origin, no forms) loaded from a
Blob URL with its own `<meta http-equiv="Content-Security-Policy">` and
`<base target="_blank">`. Email markup is never added to the top-level document.
A plain-text fallback (`<pre>`) is always available.

## 6.1 Sender authentication (`apps/worker/src/mail/auth.ts`)

An OTP inbox is a phishing target: the whole product is "show the owner a code and a
verification link". Anyone who learns an alias address can therefore try to deliver a
message that *looks* like it came from a brand, so every message is judged at delivery
time and the judgement is stored (`messages.auth_verdict` + `auth_json`).

- **`Authentication-Results` is not trusted as written.** It travels inside the message, so
  the sender can author `dkim=pass` themselves. A pass only counts when the domain it
  vouches for (`d=`, `header.d=`, `header.i=`, `smtp.mailfrom=`) **aligns** with the header
  `From` domain at registrable-domain level — DMARC's own rule. Misaligned passes are
  recorded as evidence and reported honestly (`spf=pass`) but never credited
  (`alignedPass.dkim === false`), and the UI labels exactly that distinction.
- **Verdicts:** `SPOOFED` when `dmarc=fail` (the one result the header cannot fake into
  usefulness); `TRUSTED` when an aligned `dmarc`/`dkim`/`spf` pass exists; `UNVERIFIED`
  otherwise — including when no results reached us at all, which is honest rather than
  alarming.
- **Enforcement is per domain, default `WARN`:** `OFF` records only, `WARN` records and
  flags, `REJECT` refuses delivery (`setReject("sender authentication failed")`) — chosen
  by the owner per domain in the Domains table, never flipped silently.
- **The payload of a spoofed message is withheld, not just labelled.** `MessageDetail`
  hides extracted codes and verification links behind an explicit "Show anyway", and the
  inbox list never echoes a `primaryCode` for a `SPOOFED` message.
- **Old mail is not re-judged with guesses.** Rows written before this existed carry
  `UNVERIFIED` with no assessment JSON, and the banner stays silent for them.

## 7. Attachments

`apps/worker/src/routes/messages.ts` (download route) + `apps/worker/src/lib/filename.ts`:

- Attachment bytes live in the **private** R2 bucket; there are no public URLs and no
  permanent links. The only access path is the authenticated
  `GET /api/messages/:mid/attachments/:aid`, which verifies the message belongs to the
  caller's data before streaming.
- Download responses force `Content-Disposition: attachment` with a sanitized
  filename (directories, control chars, path traversal and a restrictive charset are
  stripped; extension preserved), plus `X-Content-Type-Options: nosniff` and
  `Cache-Control: private, no-store`. Dangerous types are never inlined.

## 8. Alias safety — refuse unknown mail

`apps/worker/src/mail/ingest.ts`:

- Inbound acceptance is gated on an **ACTIVE alias row** in D1 matched by normalized
  recipient address. Unknown recipients are **rejected** (`message.setReject`) and are
  **never auto-created** — so the domain cannot be turned into a spam sink by
  guessing addresses. Mail to a `DISABLED` alias is rejected too (history preserved).
- Delivery is idempotent via a UNIQUE `dedupe_key`, so Cloudflare retries after a
  persistence throw cannot duplicate messages.
- Messages over `MAX_MESSAGE_BYTES` are rejected; the configured ceiling is clamped to
  Cloudflare's ~25 MiB inbound limit (`env.ts`).

## 9. Domain provisioning safety (the highest-risk feature)

`apps/worker/src/provisioning/` + `apps/worker/src/routes/domains.ts`:

- **Zero mutation on startup/deploy.** The Worker entrypoint never enables Email
  Routing, touches MX, replaces a catch-all, or provisions a zone. `sync` is read-only
  discovery.
- **Preflight is read-only** (`preflight.ts`) — proven by `test/unit/preflight.test.ts`
  asserting an empty mutation list. It classifies each zone and returns evidence.
- **Foreign MX is never overwritten** (`mx.ts`): Google Workspace, Microsoft 365, Zoho,
  Fastmail, Yahoo, Apple, Proton, Mimecast, Proofpoint, Barracuda, SpamTitan, IONOS,
  Amazon SES, Migadu and Yandex 360 signatures — and *any* non-Cloudflare host — mark
  `MX_CONFLICT` → `safeToProvision=false`, default **skip**. Only Cloudflare Email
  Routing MX counts as "ours". The IONOS/SES/Migadu/Yandex entries were added from
  hostnames actually observed in the owner's account.
- **Foreign catch-all** marks `CATCH_ALL_CONFLICT`; a takeover requires an explicit
  `allowCatchAllTakeover` confirmation from the owner (surfaced in the Domains UI).
- **Provisioning is allow-listed, not block-listed** (`provisioner.ts`). It mutates only
  when preflight returns `READY_TO_PROVISION`, `ALREADY_CONFIGURED`, or
  `CATCH_ALL_CONFLICT` *with* an explicit takeover confirmation. Everything else —
  including a preflight read that Cloudflare refused — stops before any write. A token
  that cannot *see* a zone is therefore never able to *change* it. This replaced an
  earlier block-list that let an unrecognized classification fall through to mutation,
  found only by exercising the live API.
- **`cfCode 10000` is ambiguous, and provision must not guess.** Measured live: `POST
  /zones/{id}/email/routing/enable` returns the same 403 `Authentication error` for a zone
  outside the token's Zone Resources as it would for a missing permission — this is what
  first masqueraded as "an API token cannot enable Email Routing". It can, and now does:
  with the zone in scope a clean zone reached `READY` purely through the app. The endpoint
  that genuinely has no token permission is `GET /zones/{id}/email/routing` (the settings
  flag), which 403s in every scope and permission set tried. Consequences: routing state is
  derived from DNS instead of the unreadable flag (narrowly — other failures still
  propagate), the enable call is skipped when Cloudflare MX already exist, and a refused
  enable names the token's Zone Resources as the first suspect rather than telling the owner
  to go click around in the dashboard. See `DEPLOYMENT.md`.
- **Drift is detected, never "repaired".** `provisioning/watchdog.ts` runs hourly
  (`triggers.crons`) and on demand from *Verify delivery*, re-reading the delivery path of
  domains MailVault believes work. If Cloudflare's routing MX disappeared or the catch-all
  was moved to another destination, the domain is marked `CONFLICT / DRIFT` with the new
  destination named — it **never** re-enables routing or rewrites the catch-all to win mail
  back, because someone else's configuration is not MailVault's to overwrite. It restores a
  domain to `READY` only if *it* was the one that marked it drifted (an MX-conflict domain
  is never resurrected because routing happens to look fine), and an unreadable zone is
  recorded as unknown rather than downgraded.
- **Zone Resources are account-wide on purpose.** The token scopes its zone permissions to
  `All zones from an account`, not a per-zone list, so adding a domain never requires
  editing the token. Widening a *resource* does not widen a *capability* — it only changes
  which zones the same four permissions apply to: `Zone:Read`, `DNS:Read` and
  `Email Routing Addresses:Read` are read-only, and the one write,
  `Email Routing Rules:Edit`, reaches the catch-all rule and (through the same permission)
  `email/routing/enable`. That is exactly the blast radius to reason about, and it is
  bounded in code, not by the token: mutation happens only behind the allow-list gate
  above, only for a zone the owner imported and selected (a zone absent from `domains` is
  refused before any API call — `test/unit/provisioner.test.ts`), only via an
  authenticated owner-triggered route, and never for foreign MX. Measured on the owner's
  account: sync + preflight classified 38/38 zones and reported 35 conflicts with zero
  writes; one clean zone was then enabled deliberately, by the owner, in one click.
- **No unused write permissions.** `DNS:Edit` was granted during diagnosis, shown by
  measurement to unlock nothing required, and reverted to `DNS:Read`.
- **Removing a domain** deletes only the local row; the code refuses while aliases
  exist and **never** deletes the Cloudflare zone or its DNS.
- Every Cloudflare-side operation is wrapped so API/permission/rate-limit errors map
  to safe `asApiError` codes without leaking the token. Diagnostics log only the API
  path, status and Cloudflare error code — never headers, bodies or the token.

## 10. Data retention — nothing auto-expires

`migrations/0001_init.sql` and the app have **no** TTL, cron, lifecycle rule, or
background job that deletes mailbox content. Aliases and messages persist until the
owner explicitly deletes them, and message deletion only purges content when asked.
The one scheduled job that exists (`7 * * * *`) is the read-only drift watchdog in §9;
it writes status columns and never touches a message, an alias or a zone.

## 11. Input validation

`packages/shared` Zod schemas validate every request body/query (`readJson`,
`parseQuery`) with tight bounds: local-part charset/length + reserved names, label
length, pagination limits (≤200), filter enums, etc. Validation failures return
`400 VALIDATION_ERROR` rather than reaching the DB.

- **Search syntax is data, not a query.** Values are always bound as parameters, but an
  FTS5 `MATCH` string is parsed by the index itself, so `"`, `AND`, `NOT`, `col:` and
  syntax errors in it are a caller-controlled grammar. `ftsMatch()` reduces the input to
  quoted word tokens (capped at 8) and the search falls back to LIKE-only when nothing
  usable remains, so a hostile query returns zero rows instead of a `500`. Proven by
  `test/integration/ingest.test.ts` ("FTS5 syntax attacks").

## 12. What is deliberately out of scope in V1

- Sending mail (receive-only).
- Multi-user tenancy and per-user authorization (single owner behind Access).
- DKIM signing / outbound reputation (no sending).
- Automatic conflict resolution (always human-confirmed).

## 13. Residual risks / operator responsibilities

- **Access configuration.** The owner must put the Worker behind a real Cloudflare
  Access application with a strong policy and keep `CF_ACCESS_AUD`/team domain
  correct; without it, only `DEV_AUTH_BYPASS=false` prevents open access.
- **Token scope.** Grant the narrowest token possible; rotate periodically.
- **OTP/verification links** are sensitive; treat the inbox like a password manager.
- **E2E suite** runs against a local `wrangler dev` Worker with `DEV_AUTH_BYPASS=true`
  in `ENVIRONMENT=development`. That config must never be deployed; the production
  config ships `ENVIRONMENT=production`, where the bypass is inert by construction.
