import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { navigate, useRoute } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { selectableMailboxes } from "../lib/mailboxes";
import { useMediaQuery } from "../lib/useMediaQuery";
import { NEW_MAIL_EVENT } from "../lib/live";
import { t } from "../lib/i18n";
import { EmptyState, ErrorBanner, SkeletonList } from "../components/ui";
import { Composer } from "../components/Composer";
import { MsgItem } from "../components/MessageRow";
import { MessageDetail } from "./MessageDetail";

const PAGE = 50;

export function Inbox({ aliasId, domainId }: { aliasId?: string; domainId?: string }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"all" | "unread" | "archived" | "sent">("all");
  const [offset, setOffset] = useState(0);
  const [composing, setComposing] = useState(false);
  const { query: route } = useRoute();
  const wide = useMediaQuery("(min-width: 900px)");
  const openId = wide ? route.get("open") : null;

  // Debounce-free: only query on explicit change of filter/scope, not every keystroke.
  const query = useMemo(
    () => ({
      filter: view === "unread" ? ("unread" as const) : ("all" as const),
      // A rule files mail out of the working list; the Archived tab is how it comes back.
      archived: view === "archived" ? ("archived" as const) : ("active" as const),
      // Sent mail is the same table, so the tab says which side of the conversation to show.
      direction: view === "sent" ? ("out" as const) : ("in" as const),
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
  const { data: capabilities } = useAsync(() => api.outboxCapabilities(), []);
  const { data: aliasPage } = useAsync(() => api.listAliases(), []);

  /** Aliases that can actually be signed for, which is not every alias. */
  const sendableAliases = useMemo(() => {
    const sendable = new Set((capabilities?.domains ?? []).filter((d) => d.canSend).map((d) => d.domainId));
    return (aliasPage?.items ?? [])
      .filter((a) => a.status === "ACTIVE" && sendable.has(a.domainId))
      .map((a) => ({ address: a.address, label: a.label }));
  }, [aliasPage, capabilities]);

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

  const openMessage = useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(route.toString());
      if (id) sp.set("open", id);
      else sp.delete("open");
      const qs = sp.toString();
      navigate(`/inbox${qs ? `?${qs}` : ""}`);
    },
    [route],
  );

  /*
   * The nudge carries no content, so it cannot say *which* row is new — the refetch it
   * triggers can. Diffing the ids that arrive after a nudge is what lets exactly those rows
   * light up once, instead of flashing the whole list.
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

  const items = data?.items ?? [];

  const step = useCallback(
    (from: number, dir: 1 | -1) => {
      // j/k walk unread first from where you are, then wrap into the rest.
      const order = items.map((_, i) => i);
      const forward = dir === 1 ? order : [...order].reverse();
      const start = dir === 1 ? from + 1 : from - 1;
      const candidates = forward.filter((i) => (dir === 1 ? i > start - 1 : i < start + 1));
      const nextUnread = candidates.find((i) => !items[i]?.isRead);
      const idx = nextUnread ?? candidates.find((i) => items[i]) ?? (dir === 1 ? 0 : items.length - 1);
      const target = items[idx];
      if (target) openMessage(target.id);
    },
    [items, openMessage],
  );

  const markRead = useCallback(
    async (id: string, isRead: boolean, advance: boolean) => {
      await api.setMessageRead(id, isRead).catch(() => undefined);
      const idx = items.findIndex((m) => m.id === id);
      reload();
      // Reading something and having to hunt for the next one is the friction split
      // inboxes exist to remove.
      if (advance && isRead && items.length > 1) step(idx, 1);
    },
    [items, reload, step],
  );

  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(".palette, .modal")) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (items.length === 0) return;
      const idx = items.findIndex((m) => m.id === openId);
      const key = e.key.toLowerCase();
      if (key === "j" || key === "k") {
        e.preventDefault();
        step(idx, key === "j" ? 1 : -1);
        return;
      }
      if (e.key === "Escape" && openId) {
        e.preventDefault();
        openMessage(null);
        return;
      }
      if ((key === "e" || key === "u") && openId) {
        e.preventDefault();
        const current = items.find((m) => m.id === openId);
        if (current) void markRead(openId, key === "e" ? true : !current.isRead, key === "e");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide, items, openId, step, openMessage, markRead]);

  useEffect(() => {
    if (!openId) return;
    document.querySelector(`[data-msg-id="${openId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [openId]);

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

  const list = (
    <>
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
              {items.map((m) => (
                <MsgItem
                  key={m.id}
                  m={m}
                  scoped={scoped}
                  fresh={fresh.has(m.id)}
                  active={m.id === openId}
                  wide={wide}
                  onOpen={openMessage}
                />
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
    </>
  );

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
          {/* Reachable even when the server cannot send: a control that is simply greyed out
              tells nobody why, and the composer states the reason in its own words. */}
          <button
            className="primary small"
            onClick={() => setComposing(true)}
            disabled={sendableAliases.length === 0}
            title={sendableAliases.length === 0 ? t("composer.noAliases") : undefined}
          >
            {t("inbox.compose")}
          </button>
        </div>
      </div>

      {composing && (
        <Composer
          sendableAliases={sendableAliases}
          remaining={capabilities?.remaining ?? 0}
          bindingMissing={capabilities?.bindingMissing}
          onClose={() => setComposing(false)}
          onSent={(outcome) => {
            setComposing(false);
            setView("sent");
            reload();
            // The row is the receipt: opening it shows exactly what was sent, so the owner
            // never has to trust a toast that disappears.
            if (wide) openMessage(outcome.id);
          }}
        />
      )}

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
          <button type="button" className={view === "sent" ? "active" : ""} onClick={() => setView("sent")}>
            {t("inbox.sentTab")}
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

      {wide && openId ? (
        <div className="mail-split">
          <div className="mail-list">{list}</div>
          <div className="mail-pane" key={openId}>
            <MessageDetail
              id={openId}
              pane
              onClose={() => openMessage(null)}
              onOpenMessage={openMessage}
              onRead={(id) => void markRead(id, true, true)}
            />
          </div>
        </div>
      ) : (
        list
      )}
    </div>
  );
}
