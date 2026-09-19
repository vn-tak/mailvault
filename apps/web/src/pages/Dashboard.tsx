import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { relativeTime } from "../lib/format";
import { senderName } from "../lib/format";
import { ErrorBanner, Loading } from "../components/ui";

export function Dashboard() {
  const { data, error, loading } = useAsync(() => api.dashboard(), []);

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

          <div className="card mt">
            <div className="row spread" style={{ marginBottom: 8 }}>
              <h2>Recent messages</h2>
              <button className="ghost small" onClick={() => navigate("/inbox")}>
                Open inbox →
              </button>
            </div>
            {data.recentMessages.length === 0 ? (
              <p className="muted">No messages yet. Create an alias and use it on an external site.</p>
            ) : (
              <table>
                <tbody>
                  {data.recentMessages.map((m) => (
                    <tr key={m.id} className={`clickable ${m.isRead ? "" : "unread"}`} onClick={() => navigate(`/messages/${m.id}`)}>
                      <td style={{ width: 200 }} className="muted">
                        {senderName(m.headerFrom, m.envelopeFrom)}
                      </td>
                      <td className="subject">{m.subject || "(no subject)"}</td>
                      <td style={{ width: 120 }} className="muted addr">
                        {m.aliasLabel || m.aliasAddress}
                      </td>
                      <td style={{ width: 90 }} className="faint right">
                        {relativeTime(m.receivedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
