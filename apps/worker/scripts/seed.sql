-- Local development / E2E seed. Creates ONE already-Ready domain and a single
-- alias so the UI has data without touching Cloudflare. Safe to re-run (REPLACE).
-- This is for --local D1 only; it is never applied to a real account by the app.
INSERT OR REPLACE INTO domains
  (id, cloudflare_zone_id, cloudflare_account_id, name, zone_status, zone_type,
   mail_status, routing_status, catch_all_status, conflict_type, last_checked_at,
   created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000demo', 'demo-zone-0001', NULL, 'demo.example',
   'active', 'full', 'READY', 'READY', 'OURS', 'NONE',
   '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z');

INSERT OR REPLACE INTO aliases
  (id, domain_id, local_part, address, label, status, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-00000000al01', '00000000-0000-4000-8000-000000000demo',
   'github-x9f2', 'github-x9f2@demo.example', 'GitHub (demo)', 'ACTIVE',
   '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z');
