import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { relativeTime, senderName } from "../lib/format";
import { arrivalLabel, selectableMailboxes } from "../lib/mailboxes";
import { t } from "../lib/i18n";
import { ErrorBanner, Loading } from "../components/ui";
import { AuthVerdict, type MessageSummary } from "@mailvault/shared";

const PAGE = 50;

function MsgItem({ m, scoped }: { m: MessageSummary; scoped: boolean }) {
  return (
    <li className={`msg ${m.isRead ? "" : "unread"}`}>
      <Link to={`/messages/${m.id}`}>
        <span className="msg-sender">{senderName(m.headerFrom, m.envelopeFrom)}</span>
        <span className="msg-time">{relativeTime(m.receivedAt)}</span>
        <span className="msg-subject">{m.subject || t("inbox.noSubject")}</span>
        <span className="msg-alias">{arrivalLabel(m, scoped)}</span>
        {m.preview ? <span className="msg-preview">{m.preview}</span> : null}
        <span className="msg-badges">
          {m.authVerdict === AuthVerdict.Spoofed ? (
            // Never echo a forger's payload in the list — the detail view explains it.
            <span className="pill error">{t("inbox.unverified")}</span>
          ) : m.primaryCode ? (
            <span className="badge mono" title={t("inbox.codeTitle")}>{m.primaryCode}</span>
          ) : null}
          {m.ruleTag ? <span className="badge" title={t("inbox.filedTag")}>{m.ruleTag}</span> : null}
          {m.attachmentCount > 0 ? (
            <span className="badge" title={t("inbox.nAttachments", { n: m.attachmentCount })}>📎 {m.attachmentCount}</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

export function Inbox({ aliasId, domainId }: { aliasId?: string; domainId?: string }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "unread" | "archived">("all");
  const [offset, setOffset] = useState(0);

  // Debounce-free: only query on explicit change of filter/scope, not every keystroke.
  const query = useMemo(
    () => ({
      filter: view === "unread" ? ("unread" as const) : ("all" as const),
      // A rule files mail out of the working list; the Archived tab is how it comes back.
      archived: view === "archived" ? ("archived" as const) : ("active" as const),
      q: search || undefined,
      aliasId,
      domainId,
      limit: PAGE,
      offset,
    }),
    [view, search, aliasId, domainId, offset],
  );

  const { data, error, loading, reload } = useAsync(() => api.listMessages(query), [query]);
  const { data: domainPage } = useAsync(() => api.listDomains(), []);

  const mailboxes = useMemo(
    () =>
      selectableMailboxes(
        (domainPage?.items ?? []).map((d) => ({ domainId: d.id, name: d.name, mailStatus: d.mailStatus })),
        domainId,
      ),
    [domainPage, domainId],
  );

  useEffect(() => {
    setOffset(0);
  }, [view, search, aliasId, domainId]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(q.trim());
  }

  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = data ? offset + PAGE < total : false;

  const scope = aliasId || domainId || search || view !== "all";
  // Inside one mailbox every row arrived at the same domain, so repeating it would be
  // noise; across all of them it is the one fact that tells the rows apart.
  const scoped = !!(aliasId || domainId);

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t("inbox.title")}</h1>
        <div className="actions">
          <button className="ghost small" onClick={reload}>
            {t("common.refresh")}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <form className="toolbar toolbar--sticky" onSubmit={submitSearch}>
        <div className="tabs">
          <button type="button" className={view === "all" ? "active" : ""} onClick={() => setView("all")}>
            {t("inbox.all")}
          </button>
          <button type="button" className={view === "unread" ? "active" : ""} onClick={() => setView("unread")}>
            {t("inbox.unreadTab")}
          </button>
          <button type="button" className={view === "archived" ? "active" : ""} onClick={() => setView("archived")}>
            {t("inbox.filed")}
          </button>
        </div>
        {/* One mailbox at a time, because mail for different domains arriving in one
            undifferentiated pile is the complaint this answers. An alias view is already
            inside one mailbox, so it does not get a second selector. */}
        {!aliasId && (
          <select
            className="mailbox-select"
            aria-label={t("inbox.mailbox")}
            value={domainId ?? ""}
            onChange={(e) => navigate(e.target.value ? `/inbox?domain=${e.target.value}` : "/inbox")}
          >
            <option value="">{t("inbox.allMailboxes")}</option>
            {mailboxes.map((m) => (
              <option key={m.domainId} value={m.domainId}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <input className="search" placeholder={t("inbox.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit">{t("common.search")}</button>
        {aliasId && (
          <button type="button" className="ghost small" onClick={() => navigate("/inbox")}>
            {t("inbox.clearAlias")}
          </button>
        )}
      </form>

      {loading && !data && <Loading />}

      {data && data.items.length === 0 && (
        <div className="empty">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t(scope ? "inbox.noMatch" : "inbox.empty")}</div>
          <div className="muted">{t(scope ? "inbox.filterHint" : "inbox.emptyHint")}</div>
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="card card--flush">
            <ul className="msglist">
              {data.items.map((m) => (
                <MsgItem key={m.id} m={m} scoped={scoped} />
              ))}
            </ul>
          </div>
          <div className="pager">
            <span className="faint" style={{ fontSize: 13 }}>
              {t("inbox.showing", { from: offset + 1, to: Math.min(offset + PAGE, total), total })}
            </span>
            <div className="row">
              <button className="small" disabled={!hasPrev} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                {t("inbox.newer")}
              </button>
              <button className="small" disabled={!hasNext} onClick={() => setOffset(offset + PAGE)}>
                {t("inbox.older")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
