import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { relativeTime, senderName } from "../lib/format";
import { ErrorBanner, Loading } from "../components/ui";
import { AuthVerdict, type MessageSummary } from "@mailvault/shared";

const PAGE = 50;

function Row({ m }: { m: MessageSummary }) {
  return (
    <tr className={`clickable ${m.isRead ? "" : "unread"}`} onClick={() => navigate(`/messages/${m.id}`)}>
      <td style={{ width: 220 }} className="muted">
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {senderName(m.headerFrom, m.envelopeFrom)}
        </div>
        <div className="addr faint" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>
          {m.aliasLabel || m.aliasAddress}
        </div>
      </td>
      <td>
        <div className="subject">{m.subject || "(no subject)"}</div>
        {m.preview && (
          <div className="faint" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {m.preview}
          </div>
        )}
      </td>
      <td style={{ width: 130 }} className="right wrap">
        <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
          {m.authVerdict === AuthVerdict.Spoofed ? (
            // Never echo a forger's payload in the list — the detail view explains it.
            <span className="badge" title="Sender authentication failed — open for details">⚠ spoof risk</span>
          ) : m.primaryCode ? (
            <span className="badge mono" title="Detected code">{m.primaryCode}</span>
          ) : null}
          {m.attachmentCount > 0 ? <span className="badge" title={`${m.attachmentCount} attachment(s)`}>📎 {m.attachmentCount}</span> : null}
        </div>
        <div className="faint right" style={{ fontSize: 12, width: "100%", textAlign: "right", marginTop: 2 }}>
          {relativeTime(m.receivedAt)}
        </div>
      </td>
    </tr>
  );
}

export function Inbox({ aliasId, domainId }: { aliasId?: string; domainId?: string }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  // Debounce-free: only query on explicit change of filter/scope, not every keystroke.
  const query = useMemo(
    () => ({
      filter: unreadOnly ? ("unread" as const) : ("all" as const),
      q: search || undefined,
      aliasId,
      domainId,
      limit: PAGE,
      offset,
    }),
    [unreadOnly, search, aliasId, domainId, offset],
  );

  const { data, error, loading, reload } = useAsync(() => api.listMessages(query), [query]);

  useEffect(() => {
    setOffset(0);
  }, [unreadOnly, search, aliasId, domainId]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(q.trim());
  }

  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = data ? offset + PAGE < total : false;

  const scope = aliasId || domainId || search || unreadOnly;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Inbox</h1>
        <div className="actions">
          <button className="small" onClick={reload}>
            Refresh
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <form className="toolbar" onSubmit={submitSearch}>
        <div className="tabs">
          <button type="button" className={!unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(false)}>
            All
          </button>
          <button type="button" className={unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(true)}>
            Unread
          </button>
        </div>
        <input className="search" placeholder="Search sender, subject, alias…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit">Search</button>
        {aliasId && (
          <button type="button" className="ghost small" onClick={() => navigate("/inbox")}>
            Clear alias filter ✕
          </button>
        )}
        {domainId && !aliasId && (
          <button type="button" className="ghost small" onClick={() => navigate("/inbox")}>
            Clear domain filter ✕
          </button>
        )}
      </form>

      {loading && !data && <Loading />}

      {data && data.items.length === 0 && (
        <div className="empty">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{scope ? "No matching messages" : "Your inbox is empty"}</div>
          <div className="muted">{scope ? "Try clearing the filters or search." : "Create an alias and use it on an external site to receive mail."}</div>
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table>
              <tbody>
                {data.items.map((m) => (
                  <Row key={m.id} m={m} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="row spread" style={{ marginTop: 12 }}>
            <span className="faint" style={{ fontSize: 13 }}>
              Showing {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
            </span>
            <div className="row">
              <button className="small" disabled={!hasPrev} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                ← Prev
              </button>
              <button className="small" disabled={!hasNext} onClick={() => setOffset(offset + PAGE)}>
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
