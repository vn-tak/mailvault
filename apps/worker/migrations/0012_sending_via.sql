-- 0012 — which name this domain's mail actually leaves under.
--
-- Cloudflare onboards Email Sending per *name* inside a zone, and a zone's receiving records
-- and its sending records are separate things. `send.omnipos.tech` can be enabled while
-- `omnipos.tech` is not, and that is the shape MailVault wants: aliases live on the domain
-- people write to, while the DMARC policy Email Sending insists on being written sits on a
-- subdomain nobody else sends from.
--
-- NULL means the obvious default — the domain sends as itself, which is how every row written
-- before this column behaved.

ALTER TABLE domains ADD COLUMN sending_via TEXT;
