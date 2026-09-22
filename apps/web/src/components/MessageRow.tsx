import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { relativeTime, senderName } from "../lib/format";
import { arrivalLabel } from "../lib/mailboxes";
import { copyText } from "../lib/clipboard";
import { t } from "../lib/i18n";
import { Monogram } from "./ui";
import { AuthVerdict, type MessageSummary } from "@mailvault/shared";

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
  const href = wide ? `/inbox?open=${encodeURIComponent(m.id)}` : `/messages/${m.id}`;
  return (
    <li
      className={`msg ${m.isRead ? "" : "unread"} ${fresh ? "is-live" : ""} ${active ? "is-active" : ""}`}
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
          <span className="msg-sender">{sender}</span>
          <span className="msg-subject">{m.subject || t("inbox.noSubject")}</span>
          <span className="msg-line">
            <span className="msg-alias">{arrivalLabel(m, scoped)}</span>
            {m.preview ? <span className="msg-preview">{m.preview}</span> : null}
            <span className="msg-badges">
              {m.authVerdict === AuthVerdict.Spoofed ? (
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
          {m.authVerdict !== AuthVerdict.Spoofed && m.primaryCode ? <CodeChip code={m.primaryCode} /> : null}
        </span>
      </div>
    </li>
  );
}

