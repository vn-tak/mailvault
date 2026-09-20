import { useMemo } from "react";
import { api } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { relativeTime, senderName } from "../lib/format";
import { arrivalLabel, splitMailboxes } from "../lib/mailboxes";
import { ErrorBanner, Loading } from "../components/ui";
import { MailStatus, type MailboxStat } from "@mailvault/shared";

function MailboxCard({ m }: { m: MailboxStat }) {
  const receiving = m.mailStatus === MailStatus.Ready;
  return (
    <Link to={`/inbox?domain=${m.domainId}`} className="mailbox">
      <span className="mailbox-name">{m.name}</span>
      <span className="mailbox-facts">
        <span>
          {m.total} {m.total === 1 ? "message" : "messages"}
        </span>
        {m.unread > 0 ? <span className="pill accent">{m.unread} unread</span> : null}
        {m.lastReceivedAt ? <span>last {relativeTime(m.lastReceivedAt)}</span> : null}
        {!receiving ? <span className="pill conflict">not receiving</span> : null}
      </span>
    </Link>
  );
}

export function Dashboard() {
  const { data, error, loading } = useAsync(() => api.dashboard(), []);
  const { data: health } = useAsync(() => api.health(), []);

  const split = useMemo(() => splitMailboxes(data?.mailboxes ?? []), [data]);
  const hidden = split.overflow.length + split.empty.length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <div className="actions">
          <button className="primary" onClick={() => navigate("/aliases?new=1")}>
            + Create alias
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          {/* One line for the whole census. A degraded check gets a banner below, because
              a status that needs action should not be scannable as a footnote. */}
          <div className="statline">
            <span style={{ color: health?.ok === false ? "var(--warn)" : "var(--ok)", fontWeight: 600 }}>
              {health ? (health.ok ? "● Online" : "● Degraded") : "● Checking…"}
            </span>
            <span>
              <strong>{data.activeDomains}</strong> of {data.totalDomains} domains receive mail
            </span>
            <span>
              <strong>{data.totalAliases}</strong> aliases
            </span>
            <span>
              <strong>{data.unreadMessages}</strong> unread
            </span>
            <span>
              <strong>{data.totalMessages}</strong> stored
            </span>
          </div>

          {health && !health.ok && (
            <div className="banner error">
              Something is not right: {[
                health.checks?.d1 === "error" && "database",
                health.checks?.r2 === "error" && "storage",
                health.checks?.token === "error" && "Cloudflare token",
              ]
                .filter(Boolean)
                .join(", ") || "a check"}{" "}
              failed. See Settings.
            </div>
          )}

          <div className="card card--flush">
            <div className="list-head">
              <h2 style={{ margin: 0 }}>Mailboxes</h2>
              <span className="faint" style={{ fontSize: 13 }}>
                one domain, one mailbox
              </span>
              <div className="head-actions">
                <button className="ghost small" onClick={() => navigate("/inbox")}>
                  All mail →
                </button>
              </div>
            </div>
            <div style={{ padding: "var(--space-2)" }}>
              {split.shown.length === 0 ? (
                <div className="muted" style={{ fontSize: 14 }}>
                  No mail has arrived yet. Create an alias, then use it somewhere external.
                </div>
              ) : (
                <div className="mailboxes">
                  {split.shown.map((m) => (
                    <MailboxCard key={m.domainId} m={m} />
                  ))}
                </div>
              )}
              {hidden > 0 && (
                <details className="more-mailboxes">
                  <summary>
                    {hidden} other {hidden === 1 ? "domain" : "domains"}
                    {/* Only worth saying when it is not obvious from the count above it. */}
                    {split.empty.length > 0 && split.empty.length !== hidden
                      ? ` (${split.empty.length} with no mail yet)`
                      : ""}
                  </summary>
                  <div className="chipset">
                    {[...split.overflow, ...split.empty].map((m) => (
                      <Link key={m.domainId} to={`/inbox?domain=${m.domainId}`} className="chip">
                        {m.name}
                        {m.total > 0 ? ` · ${m.total}` : ""}
                      </Link>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>

          <div className="card card--flush mt">
            <div className="list-head">
              <h2 style={{ margin: 0 }}>Recent messages</h2>
              <div className="head-actions">
                <button className="ghost small" onClick={() => navigate("/inbox")}>
                  Open inbox →
                </button>
              </div>
            </div>
            {data.recentMessages.length === 0 ? (
              <p className="muted" style={{ padding: "var(--space-2)" }}>
                No messages yet. Create an alias and use it on an external site.
              </p>
            ) : (
              <ul className="msglist">
                {data.recentMessages.map((m) => (
                  <li key={m.id} className={`msg ${m.isRead ? "" : "unread"}`}>
                    <Link to={`/messages/${m.id}`}>
                      <span className="msg-sender">{senderName(m.headerFrom, m.envelopeFrom)}</span>
                      <span className="msg-time">{relativeTime(m.receivedAt)}</span>
                      <span className="msg-subject">{m.subject || "(no subject)"}</span>
                      <span className="msg-alias">{arrivalLabel(m, false)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
