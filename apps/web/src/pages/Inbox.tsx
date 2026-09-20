import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { relativeTime, senderName } from "../lib/format";
import { arrivalLabel, selectableMailboxes } from "../lib/mailboxes";
import { NEW_MAIL_EVENT } from "../lib/live";
import { t } from "../lib/i18n";
import { EmptyState, ErrorBanner, Monogram, SkeletonList } from "../components/ui";
import { AuthVerdict, type MessageSummary } from "@mailvault/shared";

const PAGE = 50;

function MsgItem({ m, scoped, fresh }: { m: MessageSummary; scoped: boolean; fresh: boolean }) {
  const sender = senderName(m.headerFrom, m.envelopeFrom);
  return (
    <li className={`msg ${m.isRead ? "" : "unread"} ${fresh ? "is-live" : ""}`} data-verdict={m.authVerdict}>
      <Link to={`/messages/${m.id}`}>
        <span className="msg-who">
          <span className="msg-avatar">
            <Monogram name={sender} />
          </span>
          <span className="msg-sender">{sender}</span>
        </span>
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
  const searchRef = useRef<HTMLInputElement>(null);

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

  /*
   * The nudge carries no content, so it cannot say *which* row is new — the refetch it
   * triggers can. Diffing the ids that arrive after a nudge is what lets exactly those rows
   * light up once, instead of flashing the whole list or claiming to know more than the
   * socket ever said.
   */
  const armed = useRef(false);
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const onNewMail = () => {
      armed.current = true;
    };
    window.addEventListener(NEW_MAIL_EVENT, onNewMail);
    return () => window.removeEventListener(NEW_MAIL_EVENT, onNewMail);
  }, []);

  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.items.map((m) => m.id));
    const wasArmed = armed.current;
    const previous = known.current;
    armed.current = false;
    known.current = ids;
    if (!wasArmed || !previous) return;
    const arrived = [...ids].filter((id) => !previous.has(id));
    if (arrived.length === 0) return;
    setFresh(new Set(arrived));
    const timer = setTimeout(() => setFresh(new Set()), 1700);
    return () => clearTimeout(timer);
  }, [data]);

  // "/" jumps to the filter, because reading mail is mostly a search loop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        <div>
          <span className="eyebrow">{t("inbox.eyebrow")}</span>
          <h1>{t("inbox.title")}</h1>
        </div>
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
        <span className="search-wrap">
          <input ref={searchRef} className="search" placeholder={t("inbox.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          <kbd className="search-hint" aria-hidden="true">
            /
          </kbd>
        </span>
        <button type="submit">{t("common.search")}</button>
        {aliasId && (
          <button type="button" className="ghost small" onClick={() => navigate("/inbox")}>
            {t("inbox.clearAlias")}
          </button>
        )}
      </form>

      {loading && !data && <SkeletonList rows={6} />}

      {data && data.items.length === 0 && (
        <EmptyState
          art={scope ? "search" : "mailbox"}
          title={t(scope ? "inbox.noMatch" : "inbox.empty")}
          hint={t(scope ? "inbox.filterHint" : "inbox.emptyHint")}
          action={
            scope ? (
              <button className="small" onClick={() => navigate("/inbox")}>
                {t("inbox.clearFilters")}
              </button>
            ) : (
              <button className="primary" onClick={() => navigate("/aliases?new=1")}>
                {t("dash.newAlias")}
              </button>
            )
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="card card--flush">
            <ul className="msglist">
              {data.items.map((m) => (
                <MsgItem key={m.id} m={m} scoped={scoped} fresh={fresh.has(m.id)} />
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
