import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { navigate, useRoute } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { selectableMailboxes } from "../lib/mailboxes";
import { useMediaQuery } from "../lib/useMediaQuery";
import { NEW_MAIL_EVENT } from "../lib/live";
import { t } from "../lib/i18n";
import { ConfirmDialog, EmptyState, ErrorBanner, SkeletonList } from "../components/ui";
import { Composer } from "../components/Composer";
import { MsgItem } from "../components/MessageRow";
import { MessageDetail } from "./MessageDetail";
import { BulkMessageAction, parseSearchQuery, type MessageCounters, type MessageSummary } from "@mailvault/shared";

const PAGE = 50;

/** The five views a mailbox is read through. `filed` is what rules move mail to. */
type View = "all" | "unread" | "starred" | "archived" | "sent";

const TAB_LABEL: Record<View, string> = {
  all: "inbox.all",
  unread: "inbox.unreadTab",
  starred: "inbox.starredTab",
  archived: "inbox.filed",
  sent: "inbox.sentTab",
};

/**
 * The number beside a tab's name, counted over the whole mailbox rather than the page on
 * screen — a badge that changed as you paged would be describing the viewport, not the
 * mailbox. `unread` gets none: the All tab already carries the unread count, and the same
 * number twice in a row on two adjacent tabs reads as two different facts.
 */
function tabBadge(view: View, c: MessageCounters): number | null {
  if (view === "unread") return null;
  if (view === "all") return c.inbox.unread;
  if (view === "sent") return c.sent.total;
  if (view === "starred") return c.starred.total;
  return c.filed.total;
}

/**
 * What a multi-select can do. Archive is not here because the button changes meaning by tab
 * — in Filed it brings mail back rather than taking it away.
 */
const BULK_ACTIONS: { action: BulkMessageAction; label: string }[] = [
  { action: BulkMessageAction.Read, label: "bulk.read" },
  { action: BulkMessageAction.Unread, label: "bulk.unread" },
  { action: BulkMessageAction.Star, label: "bulk.star" },
];

export function Inbox({ aliasId, domainId }: { aliasId?: string; domainId?: string }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("all");
  const [offset, setOffset] = useState(0);
  const [composing, setComposing] = useState(false);
  // Conversation view is the way a mailbox reads; a search opts out, because matching one
  // message and showing a thread is a different question.
  const [grouped, setGrouped] = useState(() => localStorage.getItem("mailvault-threaded") !== "0");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { query: route } = useRoute();
  const wide = useMediaQuery("(min-width: 900px)");
  const openId = wide ? route.get("open") : null;

  // The row a shift-click counts from, not the last row touched: dragging a range out and
  // then back has to shrink it the way a file manager's does.
  const anchor = useRef<string | null>(null);

  const query = useMemo(
    () => ({
      filter: view === "unread" ? ("unread" as const) : ("all" as const),
      // A rule files mail out of the working list; the Filed tab is how it comes back.
      archived: view === "archived" ? ("archived" as const) : ("active" as const),
      // Sent mail is the same table, so the tab says which side of the conversation to show.
      // Starred spans both: marking a letter you sent is as useful as marking one you got.
      direction: view === "sent" ? ("out" as const) : view === "starred" ? ("all" as const) : ("in" as const),
      starred: view === "starred" ? ("true" as const) : undefined,
      q: search || undefined,
      aliasId,
      domainId,
      // Boolean here, `true`/`false` on the wire: the query string is where the parsing happens.
      threaded: grouped && !search,
      limit: PAGE,
      offset,
    }),
    [view, search, aliasId, domainId, offset, grouped],
  );

  const { data, error, loading, reload } = useAsync(() => api.listMessages(query), [query]);
  const { data: domainPage } = useAsync(() => api.listDomains(), []);
  const { data: capabilities } = useAsync(() => api.outboxCapabilities(), []);
  const { data: aliasPage } = useAsync(() => api.listAliases(), []);
  const { data: counters, reload: reloadCounters } = useAsync(() => api.messageCounters(domainId), [domainId]);

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

  // A different list of rows is a different selection: keeping ids that are no longer on
  // screen would let an invisible message be deleted by the next button press.
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
  }, [query]);

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
    // The badges count the whole mailbox, so anything that just changed the list may have
    // changed them too — reading, filing and arriving all move a number.
    reloadCounters();
    if (!wasArmed || !previous) return;
    const arrived = [...ids].filter((id) => !previous.has(id));
    if (arrived.length === 0) return;
    setFresh(new Set(arrived));
    const timer = setTimeout(() => setFresh(new Set()), 1700);
    return () => clearTimeout(timer);
  }, [data, reloadCounters]);

  const items = data?.items ?? [];
  const selectedIds = useMemo(() => items.filter((m) => selected.has(m.id)).map((m) => m.id), [items, selected]);
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  const toggleSelect = useCallback(
    (id: string, shift: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const from = anchor.current ? items.findIndex((m) => m.id === anchor.current) : -1;
        const to = items.findIndex((m) => m.id === id);
        // Shift extends the block from where the last plain click landed, and adds to what is
        // already chosen rather than replacing it — two shift-drags should cover both.
        if (shift && from >= 0 && to >= 0) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          for (let i = lo; i <= hi; i++) {
            const row = items[i];
            if (row) next.add(row.id);
          }
          return next;
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchor.current = id;
        return next;
      });
    },
    [items],
  );

  const toggleSelectAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(items.map((m) => m.id)));
    anchor.current = null;
  }, [allSelected, items]);

  const runBulk = useCallback(
    async (action: BulkMessageAction) => {
      if (selectedIds.length === 0 || busy) return;
      setBusy(true);
      setBulkError(null);
      try {
        await api.bulkMessages(selectedIds, action);
        setSelected(new Set());
        anchor.current = null;
        setConfirmDelete(false);
        reload();
      } catch (e) {
        setBulkError(e instanceof Error ? e.message : t("bulk.failed"));
      } finally {
        setBusy(false);
      }
    },
    [selectedIds, busy, reload],
  );

  const toggleStar = useCallback(
    async (m: MessageSummary) => {
      setBulkError(null);
      try {
        await api.bulkMessages([m.id], m.starred ? BulkMessageAction.Unstar : BulkMessageAction.Star);
        reload();
      } catch (e) {
        setBulkError(e instanceof Error ? e.message : t("bulk.failed"));
      }
    },
    [reload],
  );

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
      // A selection is the thing being worked on, so Escape clears it before anything else:
      // focus sits in the checkbox that made the selection, and a key handler that gave up on
      // any focused input would leave Escape doing nothing exactly when it is most wanted.
      if (e.key === "Escape" && selected.size > 0) {
        e.preventDefault();
        setSelected(new Set());
        anchor.current = null;
        return;
      }
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
      if (key === "c") {
        e.preventDefault();
        setComposing(true);
        return;
      }
      // `x` and `s` act on the message on screen, the same two keys a desktop client uses.
      if ((key === "x" || key === "s") && openId) {
        e.preventDefault();
        if (key === "x") toggleSelect(openId, false);
        else {
          const current = items.find((m) => m.id === openId);
          if (current) void toggleStar(current);
        }
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
  }, [wide, items, openId, step, openMessage, markRead, selected.size, toggleSelect, toggleStar]);

  useEffect(() => {
    if (!openId) return;
    document.querySelector(`[data-msg-id="${openId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [openId]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(q.trim());
  }

  // Parsed here for the chips and the hint only; the Worker parses the same string again for
  // the query itself, because a filter a client chose to ignore is not a filter.
  const intent = useMemo(() => parseSearchQuery(search), [search]);

  function removeToken(raw: string) {
    // Literal split/join: an operator value can hold `.` or `+`, which a regex would eat.
    const next = q.split(raw).join(" ").replace(/\s{2,}/g, " ").trim();
    setQ(next);
    setSearch(next);
  }

  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = data ? offset + PAGE < total : false;

  const scope = aliasId || domainId || search || view !== "all";
  // Inside one mailbox every row arrived at the same domain, so repeating it would be
  // noise; across all of them it is the one fact that tells the rows apart.
  const scoped = !!(aliasId || domainId);

  const bulkBar = (
    <div className="bulkbar" role="toolbar" aria-label={t("bulk.actions")}>
      <span className="bulk-all">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleSelectAll}
          ref={(el) => {
            // `indeterminate` is a property with no attribute equivalent; the ref is the only
            // way to say "some of this page" to a screen reader.
            if (el) el.indeterminate = selectedIds.length > 0 && !allSelected;
          }}
          aria-label={t("inbox.selectAllPage")}
        />
      </span>
      <span className="bulk-count">
        {selectedIds.length > 0 ? t("bulk.nSelected", { n: selectedIds.length }) : t("inbox.selectAllHint")}
      </span>
      <div className="bulk-actions">
        {BULK_ACTIONS.map(({ action, label }) => (
          <button key={action} type="button" className="small" disabled={selectedIds.length === 0 || busy} onClick={() => void runBulk(action)}>
            {t(label)}
          </button>
        ))}
        {view === "archived" ? (
          <button type="button" className="small" disabled={selectedIds.length === 0 || busy} onClick={() => void runBulk(BulkMessageAction.Unarchive)}>
            {t("bulk.unarchive")}
          </button>
        ) : (
          <button type="button" className="small" disabled={selectedIds.length === 0 || busy} onClick={() => void runBulk(BulkMessageAction.Archive)}>
            {t("bulk.archive")}
          </button>
        )}
        <button
          type="button"
          className="small danger"
          disabled={selectedIds.length === 0 || busy}
          onClick={() => setConfirmDelete(true)}
        >
          {t("bulk.delete")}
        </button>
      </div>
    </div>
  );

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
            {/* On a phone the bar appears with the selection instead of sitting above the
                list waiting for it: the first rows of mail are worth more than the promise
                of a control that is only used occasionally. */}
            {wide || selectedIds.length > 0 ? bulkBar : null}
            <ul className="msglist">
              {items.map((m) => (
                <MsgItem
                  key={m.id}
                  m={m}
                  scoped={scoped}
                  fresh={fresh.has(m.id)}
                  active={m.id === openId}
                  wide={wide}
                  selected={selected.has(m.id)}
                  onOpen={openMessage}
                  onSelect={toggleSelect}
                  onStar={(row) => void toggleStar(row)}
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
          {/* A view preference, not a filter: grouping changes how the same messages are
              stacked, and it keeps its place beside the other view control. */}
          <button
            className="ghost small"
            aria-pressed={grouped}
            title={search ? t("inbox.groupOffWhileSearching") : t("inbox.groupHint")}
            onClick={() => {
              const next = !grouped;
              setGrouped(next);
              localStorage.setItem("mailvault-threaded", next ? "1" : "0");
            }}
          >
            {t("inbox.groupConversations")}
          </button>
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
      {bulkError && <ErrorBanner message={bulkError} />}

      <form className="toolbar toolbar--sticky" onSubmit={submitSearch}>
        <div className="tabs">
          {(["all", "unread", "starred", "archived", "sent"] as View[]).map((v) => {
            const badge = counters ? tabBadge(v, counters) : null;
            return (
              <button key={v} type="button" className={view === v ? "active" : ""} onClick={() => setView(v)}>
                {t(TAB_LABEL[v])}
                {/* The badge counts the mailbox, not this page, so it says "42 unread here"
                    rather than whatever happens to be listed. */}
                {badge ? <span className="tab-count">{badge}</span> : null}
              </button>
            );
          })}
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
            {/* No unread count in the label: a `select` sizes itself to its longest option,
                and the few extra characters are enough to drop the picker onto a line of its
                own — which is the third line of filters this screen is measured on avoiding. */}
            {mailboxes.map((m) => (
              <option key={m.domainId} value={m.domainId}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <input
          className="search"
          placeholder={t("inbox.placeholder")}
          aria-label={t("common.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit">{t("common.search")}</button>
        {aliasId && (
          <button type="button" className="ghost small" onClick={() => navigate("/inbox")}>
            {t("inbox.clearAlias")}
          </button>
        )}
      </form>

      {/* Chips echo back what the operators were read as, because a query that silently
          became something narrower is worse than one that failed. Each one removes itself. */}
      {intent.tokens.length > 0 && (
        <div className="chip-row">
          {intent.tokens.map((tok) => (
            <button key={tok.raw} type="button" className="chip" onClick={() => removeToken(tok.raw)} title={t("search.chipRemove")}>
              <span className="chip-k">{t(`search.op.${tok.kind}`)}</span>
              {tok.value}
              <span aria-hidden="true"> ✕</span>
            </button>
          ))}
        </div>
      )}

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

      {confirmDelete && selectedIds.length > 0 && (
        <ConfirmDialog
          title={t("bulk.deleteTitle", { n: selectedIds.length })}
          confirmLabel={t("bulk.deleteConfirm", { n: selectedIds.length })}
          description={t("bulk.deleteBody")}
          onConfirm={() => void runBulk(BulkMessageAction.Delete)}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
