import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { relativeTime, senderName } from "../lib/format";
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
  onOpen,
}: {
  m: MessageSummary;
  scoped: boolean;
  fresh: boolean;
  active: boolean;
  wide: boolean;
  onOpen: (id: string) => void;
}) {
  const sender = senderName(m.headerFrom, m.envelopeFrom);
  const sent = m.direction === MessageDirection.Out;
  const href = wide ? `/inbox?open=${encodeURIComponent(m.id)}` : `/messages/${m.id}`;
  return (
    <li
      className={`msg ${m.isRead ? "" : "unread"} ${fresh ? "is-live" : ""} ${active ? "is-active" : ""} ${sent ? "is-sent" : ""}`}
      data-verdict={m.authVerdict}
      data-msg-id={m.id}
    >
      <div className="msg-row">
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
                <span className={`pill ${m.sendStatus === "FAILED" || m.sendStatus === "BOUNCED" ? "error" : "muted"}`}>
                  {t(`send.status.${m.sendStatus}`)}
                </span>
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
          {/* Getting the code is this app's main job; opening the message to reach it is a
              round trip the row can skip. A forged code stays hidden, as in the detail. */}
          {m.authVerdict !== AuthVerdict.Spoofed && !sent && m.primaryCode ? <CodeChip code={m.primaryCode} /> : null}
        </span>
      </div>
    </li>
  );
}

