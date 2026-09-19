import { api } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { relativeTime } from "../lib/format";
import { senderName } from "../lib/format";
import { ErrorBanner, Loading } from "../components/ui";

export function Dashboard() {
  const { data, error, loading } = useAsync(() => api.dashboard(), []);
  const { data: health } = useAsync(() => api.health(), []);

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

      {health && (
        <div className="banner" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontWeight: 600, color: health.ok ? "var(--ok)" : "var(--warn)" }}>
            {health.ok ? "● Online" : "● Degraded"}
          </span>
          <span className="faint">database {health.checks?.d1 ?? "…"}</span>
          <span className="faint">storage {health.checks?.r2 ?? "…"}</span>
          <span className="faint">Cloudflare token {health.checks?.token ?? "…"}</span>
        </div>
      )}

      {data && (
        <>
          <div className="grid stats">
            <div className="card stat">
              <div className="k">Active domains</div>
              <div className="v">
                {data.activeDomains}
                <span className="faint" style={{ fontSize: 14 }}>
                  {" "}/ {data.totalDomains}
                </span>
              </div>
            </div>
            <div className="card stat">
              <div className="k">Aliases</div>
              <div className="v">{data.totalAliases}</div>
            </div>
            <div className="card stat">
              <div className="k">Unread</div>
              <div className="v">{data.unreadMessages}</div>
            </div>
            <div className="card stat">
              <div className="k">Stored messages</div>
              <div className="v">{data.totalMessages}</div>
            </div>
          </div>

          <div className="card card--flush mt">
            <div className="row spread" style={{ margin: "14px 14px 8px" }}>
              <h2 style={{ margin: 0 }}>Recent messages</h2>
              <button className="ghost small" onClick={() => navigate("/inbox")}>
                Open inbox →
              </button>
            </div>
            {data.recentMessages.length === 0 ? (
              <p className="muted">No messages yet. Create an alias and use it on an external site.</p>
            ) : (
              <ul className="msglist">
                {data.recentMessages.map((m) => (
                  <li key={m.id} className={`msg ${m.isRead ? "" : "unread"}`}>
                    <Link to={`/messages/${m.id}`}>
                      <span className="msg-sender">{senderName(m.headerFrom, m.envelopeFrom)}</span>
                      <span className="msg-time">{relativeTime(m.receivedAt)}</span>
                      <span className="msg-subject">{m.subject || "(no subject)"}</span>
                      <span className="msg-alias">{m.aliasLabel || m.aliasAddress}</span>
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
