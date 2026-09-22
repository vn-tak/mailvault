-- Local development / E2E seed. Creates ONE already-Ready domain and a single
-- alias so the UI has data without touching Cloudflare. Safe to re-run (REPLACE).
-- This is for --local D1 only; it is never applied to a real account by the app.
-- `sending_status` is ENABLED here so the compose screen has something to send with. It is a
-- claim about a real Cloudflare domain, and locally it is a fiction: the binding is workerd's
-- simulator, which logs a message instead of delivering one.
INSERT OR REPLACE INTO domains
  (id, cloudflare_zone_id, cloudflare_account_id, name, zone_status, zone_type,
   mail_status, routing_status, catch_all_status, conflict_type,
   sending_status, sending_tag, sending_checked_at, last_checked_at,
   created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000demo', 'demo-zone-0001', NULL, 'demo.example',
   'active', 'full', 'READY', 'READY', 'OURS', 'NONE',
   'ENABLED', 'demo-sending-0001', '2026-09-19T00:00:00.000Z',
   '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z');

INSERT OR REPLACE INTO aliases
  (id, domain_id, local_part, address, label, status, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-00000000al01', '00000000-0000-4000-8000-000000000demo',
   'github-x9f2', 'github-x9f2@demo.example', 'GitHub (demo)', 'ACTIVE',
   '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z');

-- A pinned alias with a note, plus an archived one, so the alias screens (pin, archive,
-- notes, timeline) have something real to render locally.
INSERT OR REPLACE INTO aliases
  (id, domain_id, local_part, address, label, notes, pinned, archived, status, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-00000000al02', '00000000-0000-4000-8000-000000000demo',
   'news-d7k2q1', 'news-d7k2q1@demo.example', 'Newsletters',
   'Handed out to the weekly digest so the real address stays private.', 1, 0, 'ACTIVE',
   '2026-09-18T00:00:00.000Z', '2000-01-01T00:00:00.000Z'),
  ('00000000-0000-4000-8000-00000000al03', '00000000-0000-4000-8000-000000000demo',
   'old-shop-z1', 'old-shop-z1@demo.example', 'Old shop account', 'Stopped using this one.', 0, 1, 'ACTIVE',
   '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z');

-- A few messages so the inbox, unread state, OTP badge, spoof warning and search have
-- real content locally. Bodies stay in D1 metadata only (no R2 objects): the detail view
-- shows its "could not be fully parsed" path, which is also worth seeing.
INSERT OR REPLACE INTO messages
  (id, domain_id, alias_id, provider_message_id, dedupe_key, envelope_from, envelope_to,
   header_from, header_to, subject, preview, received_at, raw_size, raw_r2_key, parsed_r2_key,
   has_attachments, attachment_count, is_read, extracted_codes_json, verification_links_json,
   created_at, auth_verdict, auth_json)
VALUES
  ('00000000-0000-4000-8000-0000000000m1', '00000000-0000-4000-8000-000000000demo',
   '00000000-0000-4000-8000-00000000al01', 'gh-1', 'seed-dedupe-1', 'noreply@github.com',
   'github-x9f2@demo.example', 'GitHub <noreply@github.com>', 'github-x9f2@demo.example',
   'Please enter your verification code', 'Your GitHub verification code is 55905149. It will expire in 15 minutes.',
   '2026-09-19T08:30:00.000Z', 18234, 'seed/raw/m1.eml', NULL, 0, 0, 0,
   '[{"value":"55905149","kind":"numeric","length":8,"confidence":0.85}]', '[]',
   '2026-09-19T08:30:00.000Z', 'TRUSTED',
   '{"verdict":"TRUSTED","spf":"pass","dkim":"pass","dmarc":"pass","alignedPass":{"spf":true,"dkim":true,"dmarc":true},"envelopeMismatch":false,"observed":true,"reasons":["dmarc pass, aligned"],"evidence":[]}'),

  ('00000000-0000-4000-8000-0000000000m2', '00000000-0000-4000-8000-000000000demo',
   '00000000-0000-4000-8000-00000000al01', 'gh-2', 'seed-dedupe-2', 'bounce@news.example',
   'github-x9f2@demo.example', 'Long Sender Name That Wraps On Phones <hello+newsletter@very-long-sender-domain.example>',
   'github-x9f2@demo.example', 'Your weekly digest is ready — 12 new items from the teams you follow',
   'Here is everything that happened since last week, plus a summary of the threads you are watching and a few suggestions.',
   '2026-09-19T07:10:00.000Z', 94120, 'seed/raw/m2.eml', NULL, 1, 2, 1, '[]',
   '[{"url":"https://news.example/digest/991","hostname":"news.example","label":"Open digest","score":0.4}]',
   '2026-09-19T07:10:00.000Z', 'UNVERIFIED',
   '{"verdict":"UNVERIFIED","spf":null,"dkim":null,"dmarc":null,"alignedPass":{"spf":false,"dkim":false,"dmarc":false},"envelopeMismatch":false,"observed":false,"reasons":[],"evidence":[]}'),

  ('00000000-0000-4000-8000-0000000000m3', '00000000-0000-4000-8000-000000000demo',
   '00000000-0000-4000-8000-00000000al02', 'evil-1', 'seed-dedupe-3', 'spam@attacker.example',
   'news-d7k2q1@demo.example', 'Your bank <alerts@mybank.example>', 'news-d7k2q1@demo.example',
   'Urgent: verify your account within 24 hours', 'Click now to keep your account open. Your code is 998877.',
   '2026-09-19T06:05:00.000Z', 7410, 'seed/raw/m3.eml', NULL, 0, 0, 0,
   '[{"value":"998877","kind":"numeric","length":6,"confidence":0.62}]',
   '[{"url":"http://attacker.example/verify","hostname":"attacker.example","label":"Verify now","score":0.9}]',
   '2026-09-19T06:05:00.000Z', 'SPOOFED',
   '{"verdict":"SPOOFED","spf":"fail","dkim":"pass","dmarc":"fail","alignedPass":{"spf":false,"dkim":false,"dmarc":false},"envelopeMismatch":true,"observed":true,"reasons":["dmarc=fail"],"evidence":[{"mechanism":"dmarc","outcome":"fail","domain":"mybank.example","aligned":false,"reporter":"mail.attacker.example"}]}'),

  ('00000000-0000-4000-8000-0000000000m4', '00000000-0000-4000-8000-000000000demo',
   '00000000-0000-4000-8000-00000000al02', 'nx-4', 'seed-dedupe-4', 'no-reply@example.org',
   'news-d7k2q1@demo.example', 'Example Community <no-reply@example.org>', 'news-d7k2q1@demo.example',
   'Re: Design review follow-up', 'Thanks for the notes — I moved the thread to the tracker.',
   '2026-09-18T19:45:00.000Z', 5120, 'seed/raw/m4.eml', NULL, 0, 0, 1, '[]', '[]',
   '2026-09-18T19:45:00.000Z', 'TRUSTED',
   '{"verdict":"TRUSTED","spf":"pass","dkim":"pass","dmarc":"pass","alignedPass":{"spf":false,"dkim":true,"dmarc":true},"envelopeMismatch":false,"observed":true,"reasons":["dmarc pass, aligned"],"evidence":[]}'),

-- The reading view's stress case. Bodies come from parsed-body-stress.json (put into the
-- local R2 bucket by `dev:e2e`), and the codes/links below are the real output of
-- src/mail/{otp,links}.ts against test/fixtures/body-stress.eml — a magic link folded
-- across a hard line break, a /CL0/ tracking wrapper, an ASCII table and a signature.
-- Regenerate rather than hand-edit: the phone E2E asserts the folded token stays whole.
  ('00000000-0000-4000-8000-0000000000m5', '00000000-0000-4000-8000-000000000demo',
   '00000000-0000-4000-8000-00000000al01', 'stress-1@cloud.example', 'seed-dedupe-5', 'no-reply@cloud.example',
   'github-x9f2@demo.example', 'Example Cloud Security <no-reply@cloud.example>', 'github-x9f2@demo.example',
   'New sign-in to Example Cloud — confirm your device',
   'Hi, We received a sign-in to Example Cloud from a device we do not recognise. If this was you, confirm it with the link below. The link works once and expires in 10 minutes.…',
   '2026-09-19T15:04:11.000Z', 2429, 'seed/raw/m5.eml', 'parsed/seed-body-stress.json', 0, 0, 1,
   '[{"value":"441702","kind":"numeric","length":6,"confidence":1,"context":"Your one-time code is 441702"}]',
   '[{"url":"https://console.cloud.example/verify?intent=device&token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJVNThTTEoiLCJleHAiOjE3OTAwMDAwMDAwfQ&sig=MEUCIQDT%2B7kc0V3nKqZ8&next=%2Fsettings%2Fsecurity","hostname":"console.cloud.example","label":"Verify account","score":0.8,"context":"confirm it with the link below. The link works once and expires in 10 minutes."},
     {"url":"https://59.email.cloud.example/CL0/https:%2F%2Fconsole.cloud.example%2Fverify%3Fintent%3Ddevice%26token%3Dshort%26sig%3DMEUCIQDT/1/010101a0ba5a30a0-8dc5e2f4-35ab-4aba-b73e-0c54cbee1234","hostname":"59.email.cloud.example","label":"Confirm your device","score":0.8,"context":"Confirm your device","destination":"https://console.cloud.example/verify?intent=device&token=short&sig=MEUCIQDT"},
     {"url":"https://account.cloud.example/password/reset?next=%2Fsettings","hostname":"account.cloud.example","label":"reset your password","score":0.8,"context":"reset your password"},
     {"url":"https://docs.cloud.example/handbook/security/investigating-an-unrecognised-sign-in-from-a-device-you-do-not-recognise-see-this-long-reference-page-for-what-happens-next","hostname":"docs.cloud.example","label":"what happens after you confirm","score":0.6,"context":"what happens after you confirm"}]',
   '2026-09-19T15:04:11.000Z', 'TRUSTED',
   '{"verdict":"TRUSTED","spf":"pass","dkim":"pass","dmarc":"pass","alignedPass":{"spf":false,"dkim":true,"dmarc":true},"envelopeMismatch":false,"observed":true,"reasons":["dmarc pass, aligned"],"evidence":[]}');

-- Keep the FTS index in step with the seeded rows (the app does this on ingest).
DELETE FROM messages_fts WHERE message_id IN
  ('00000000-0000-4000-8000-0000000000m1','00000000-0000-4000-8000-0000000000m2',
   '00000000-0000-4000-8000-0000000000m3','00000000-0000-4000-8000-0000000000m4',
   '00000000-0000-4000-8000-0000000000m5');
INSERT INTO messages_fts (message_id, subject, preview, sender)
  SELECT id, COALESCE(subject,''), COALESCE(preview,''), COALESCE(header_from,'')
  FROM messages WHERE id LIKE '00000000-0000-4000-8000-0000000000m%';
