import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ApiClientError } from "../lib/api";
import type { MessageDetail, SendOutcome } from "@mailvault/shared";
import { t } from "../lib/i18n";
import { Modal } from "./ui";

/** A reason to refuse the send button, phrased in the interface language. */
const ERROR_KEYS: Record<string, string> = {
  UNKNOWN_SENDER: "send.err.unknownSender",
  SENDING_DISABLED: "send.err.sendingDisabled",
  BINDING_MISSING: "send.err.binding",
  NO_RECIPIENTS: "send.err.noRecipients",
  NO_TARGET: "send.err.noTarget",
  NO_ALIAS: "send.err.noAlias",
  TOO_MANY_RECIPIENTS: "send.err.tooMany",
  DAILY_LIMIT: "send.err.dailyLimit",
  SPOOFED_PARENT: "send.err.spoofedParent",
  EMPTY_BODY: "send.err.empty",
  TOO_LARGE: "send.err.tooLarge",
  BAD_ADDRESS: "send.err.badAddress",
  E_RECIPIENT_SUPPRESSED: "send.err.suppressed",
  E_DAILY_LIMIT_EXCEEDED: "send.err.dailyLimit",
  E_SENDER_NOT_VERIFIED: "send.err.sendingDisabled",
  E_TOO_MANY_RECIPIENTS: "send.err.tooMany",
  E_CONTENT_TOO_LARGE: "send.err.tooLarge",
};

function splitAddresses(raw: string): string[] {
  return raw
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Compose a new message, or answer one.
 *
 * In reply mode neither end is editable: the sender is the alias the message arrived on and
 * the recipient is whoever that message named, both decided by the Worker. Showing an
 * editable "To" the server would ignore would be worse than showing no field at all, so the
 * resolved party is shown as text instead.
 */
export function Composer({
  replyTo,
  sendableAliases,
  remaining,
  bindingMissing = false,
  onClose,
  onSent,
}: {
  replyTo?: MessageDetail | null;
  sendableAliases: { address: string; label: string | null }[];
  remaining: number;
  /** The server has no way to send at all — said once, up front, instead of on Submit. */
  bindingMissing?: boolean;
  onClose: () => void;
  onSent: (outcome: SendOutcome) => void;
}) {
  const isReply = !!replyTo;
  const [from, setFrom] = useState(replyTo?.aliasAddress ?? sendableAliases[0]?.address ?? "");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    body.current?.focus();
  }, []);

  const otherParty = useMemo(() => {
    if (!replyTo) return "";
    if (replyTo.direction === "OUT") return replyTo.headerTo ?? "";
    return replyTo.replyTo ?? replyTo.headerFrom ?? replyTo.envelopeFrom;
  }, [replyTo]);

  const recipientCount = splitAddresses(to).length + splitAddresses(cc).length;
  const canSend =
    !bindingMissing && (isReply ? text.trim().length > 0 : splitAddresses(to).length > 0 && text.trim().length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend || busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = isReply
        ? await api.reply(replyTo.id, { text })
        : await api.compose({
            fromAddress: from,
            to: splitAddresses(to),
            ...(splitAddresses(cc).length > 0 ? { cc: splitAddresses(cc) } : {}),
            subject,
            text,
          });
      onSent(outcome);
    } catch (err) {
      const code = (err as ApiClientError).code ?? "";
      const key = ERROR_KEYS[code];
      setError(key ? t(key) : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={t(isReply ? "composer.replyTitle" : "composer.title")} onClose={onClose}>
      <form onSubmit={submit} className="composer">
        {isReply ? (
          <div className="field">
            <label>{t("composer.answerTo")}</label>
            <div className="composer-static mono">{otherParty}</div>
            <div className="field-hint">{t("composer.fromRow", { alias: replyTo.aliasAddress })}</div>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="compose-from">{t("composer.from")}</label>
              {sendableAliases.length === 0 ? (
                <div className="composer-static">{t("composer.noAliases")}</div>
              ) : (
                <select id="compose-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                  {sendableAliases.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.label ? `${a.label} — ${a.address}` : a.address}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="field">
              <label htmlFor="compose-to">{t("composer.to")}</label>
              <input
                id="compose-to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="someone@example.com"
                autoComplete="off"
                required
              />
              {recipientCount > 0 && <div className="field-hint">{t("composer.recipients", { n: recipientCount })}</div>}
            </div>
            <details className="composer-cc">
              <summary>{t("composer.cc")}</summary>
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="someone-else@example.com" autoComplete="off" />
            </details>
            <div className="field">
              <label htmlFor="compose-subject">{t("composer.subject")}</label>
              <input id="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="compose-body">{t("composer.body")}</label>
          <textarea
            id="compose-body"
            ref={body}
            rows={isReply ? 6 : 10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("composer.bodyHint")}
          />
        </div>

        {bindingMissing && (
          <p className="banner error" role="alert">
            {t("composer.unavailable")}
          </p>
        )}
        {error && (
          <p className="banner banner--error" role="alert">
            {error}
          </p>
        )}

        <div className="row spread composer-foot">
          <span className="faint" style={{ fontSize: 13 }}>
            {t("composer.remaining", { n: remaining })}
          </span>
          <div className="row-end">
            <button type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="primary" disabled={!canSend || sendableAliases.length === 0} aria-busy={busy}>
              {t(busy ? "composer.sending" : "composer.send")}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
