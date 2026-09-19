import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { relativeTime, senderName } from "../lib/format";
import { ErrorBanner, Loading } from "../components/ui";
import { AuthVerdict, type MessageSummary } from "@mailvault/shared";

const PAGE = 50;

function MsgItem({ m }: { m: MessageSummary }) {
  return (
    <li className={`msg ${m.isRead ? "" : "unread"}`}>
      <Link to={`/messages/${m.id}`}>
        <span className="msg-sender">{senderName(m.headerFrom, m.envelopeFrom)}</span>
        <span className="msg-time">{relativeTime(m.receivedAt)}</span>
        <span className="msg-subject">{m.subject || "(no subject)"}</span>
        <span className="msg-alias">{m.aliasLabel || m.aliasAddress}</span>
        {m.preview ? <span className="msg-preview">{m.preview}</span> : null}
        <span className="msg-badges">
          {m.authVerdict === AuthVerdict.Spoofed ? (
            // Never echo a forger's payload in the list — the detail view explains it.
            <span className="pill error">⚠ unverified sender</span>
          ) : m.primaryCode ? (
            <span className="badge mono" title="Detected code">{m.primaryCode}</span>
          ) : null}
          {m.attachmentCount > 0 ? <span className="badge" title={`${m.attachmentCount} attachment(s)`}>📎 {m.attachmentCount}</span> : null}
        </span>
      </Link>
    </li>
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
          <button onClick={reload}>
            Refresh
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <form className="toolbar toolbar--sticky" onSubmit={submitSearch}>
        <div className="tabs">
          <button type="button" className={!unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(false)}>
            All
          </button>
          <button type="button" className={unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(true)}>
            Unread
          </button>
        </div>
        <input className="search" placeholder="Search subject, preview, sender, OTP code, alias…" value={q} onChange={(e) => setQ(e.target.value)} />
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
          <div className="card card--flush">
            <ul className="msglist">
              {data.items.map((m) => (
                <MsgItem key={m.id} m={m} />
              ))}
            </ul>
          </div>
          <div className="pager">
            <span className="faint" style={{ fontSize: 13 }}>
              Showing {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
            </span>
            <div className="row">
              <button disabled={!hasPrev} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                ← Newer
              </button>
              <button disabled={!hasNext} onClick={() => setOffset(offset + PAGE)}>
                Older →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
