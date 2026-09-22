import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { relativeTime, sendPill, senderName } from "../lib/format";
import { arrivalLabel } from "../lib/mailboxes";
import { copyText } from "../lib/clipboard";
import { t } from "../lib/i18n";
import { Monogram } from "./ui";
import { AuthVerdict, MessageDirection, type MessageSummary } from "@mailvault/shared";

/**
 * One message row, used by the inbox and by the dashboard's recent list. It lives in one
 * file because the dashboard once kept its own copy of the markup and fell out of step
 * with the grid the stylesheet expects — which showed up as a page wider than a phone.
 */

function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={`badge mono code-chip ${copied ? "is-copied" : ""}`}
      title={copied ? t("common.copied") : t("msg.copyCode")}
      aria-label={t("msg.copyCode")}
      onClick={async (e) => {
        // The row is a link; copying must not also open the message.
        e.preventDefault();
        e.stopPropagation();
        if (await copyText(code)) setCopied(true);
      }}
    >
      {code}
    </button>
  );
}

export function MsgItem({
  m,
  scoped,
  fresh,
  active,
  wide,
  selected,
  onOpen,
  onSelect,
  onStar,
}: {
  m: MessageSummary;
  scoped: boolean;
  fresh: boolean;
  active: boolean;
  wide: boolean;
  selected?: boolean;
  onOpen: (id: string) => void;
  /**
   * `shift` is the modifier the row was clicked with — a range is only meaningful there.
   * Both handlers are optional because selection and starring are inbox actions: the
   * dashboard's "recent" list shows the same rows without pretending to be a list you work
   * through, so it passes neither and gets neither control.
   */
  onSelect?: (id: string, shift: boolean) => void;
  onStar?: (m: MessageSummary) => void;
}) {
  const sender = senderName(m.headerFrom, m.envelopeFrom);
  const sent = m.direction === MessageDirection.Out;
  const href = wide ? `/inbox?open=${encodeURIComponent(m.id)}` : `/messages/${m.id}`;
  return (
    <li
      className={`msg ${m.isRead ? "" : "unread"} ${fresh ? "is-live" : ""} ${active ? "is-active" : ""} ${sent ? "is-sent" : ""} ${selected ? "is-selected" : ""} ${onSelect ? "is-selectable" : ""}`}
      data-verdict={m.authVerdict}
      data-msg-id={m.id}
    >
      <div className="msg-row">
        {/* The checkbox is always visible, not revealed on hover like the other row actions:
            a control you cannot find cannot start a selection, and on a touch screen there is
            no hover at all. */}
        {onSelect ? (
          <span className="msg-check">
            <input
              type="checkbox"
              checked={!!selected}
              onChange={(e) => onSelect(m.id, (e.nativeEvent as MouseEvent).shiftKey)}
              aria-label={t("inbox.selectRow", { subject: m.subject || t("inbox.noSubject") })}
            />
          </span>
        ) : null}
        <span className="msg-avatar">
          <Monogram name={sender} />
        </span>
        {/* The link is the row's text; its ::after stretches over the whole row so the
            empty space is tappable too. */}
        <Link
          to={href}
          className="msg-link"
          onClick={() => {
            if (wide) onOpen(m.id);
          }}
        >
          {/* Outgoing mail is addressed *to* somebody; naming the peer as the sender would
              read as "this person wrote to me", so the row says who it went to instead. */}
          <span className="msg-sender">{sent ? `${t("msg.toPrefix")} ${m.headerTo || m.aliasAddress}` : sender}</span>
          <span className="msg-subject">
            {m.threadCount && m.threadCount > 1 ? (
              // The badge is the conversation's size, so a row that stands for three messages
              // never reads like a single one.
              <span className="msg-thread-count" title={t("inbox.nInThread", { n: m.threadCount })}>
                {m.threadCount}
              </span>
            ) : null}
            {m.subject || t("inbox.noSubject")}
          </span>
          <span className="msg-line">
            <span className="msg-alias">{sent ? m.aliasAddress : arrivalLabel(m, scoped)}</span>
            {m.preview ? <span className="msg-preview">{m.preview}</span> : null}
            <span className="msg-badges">
              {sent && m.sendStatus ? (
                <span className={`pill ${sendPill(m.sendStatus)}`}>{t(`send.status.${m.sendStatus}`)}</span>
              ) : null}
              {!sent && m.authVerdict === AuthVerdict.Spoofed ? (
                // Never echo a forger's payload in the list — the detail view explains it.
                <span className="pill error">{t("inbox.unverified")}</span>
              ) : null}
              {m.ruleTag ? <span className="badge" title={t("inbox.filedTag")}>{m.ruleTag}</span> : null}
              {m.attachmentCount > 0 ? (
                <span className="badge" title={t("inbox.nAttachments", { n: m.attachmentCount })}>📎 {m.attachmentCount}</span>
              ) : null}
            </span>
          </span>
        </Link>
        <span className="msg-aside">
          <span className="msg-time">{relativeTime(m.receivedAt)}</span>
          {/* A star is the one mark the owner makes that no rule can reproduce, so it is the
              one action promoted out of the hover menu and onto every row. */}
          {onStar ? (
            <button
              type="button"
              className={`star ${m.starred ? "is-on" : ""}`}
              aria-pressed={m.starred}
              aria-label={t(m.starred ? "msg.unstar" : "msg.star")}
              title={t(m.starred ? "msg.unstar" : "msg.star")}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onStar(m);
              }}
            >
              {m.starred ? "★" : "☆"}
            </button>
          ) : null}
          {/* Getting the code is this app's main job; opening the message to reach it is a
              round trip the row can skip. A forged code stays hidden, as in the detail. */}
          {m.authVerdict !== AuthVerdict.Spoofed && !sent && m.primaryCode ? <CodeChip code={m.primaryCode} /> : null}
        </span>
      </div>
    </li>
  );
}

