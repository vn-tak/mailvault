import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ApiClientError } from "../lib/api";
import { fullTime } from "../lib/format";
import type { MessageDetail, RecipientSuggestion, SendOutcome } from "@mailvault/shared";
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
 * The original, folded into the reply the way any mail client does it.
 *
 * The quote is built from the body the owner is looking at, so it cannot be pointed at
 * somebody else's message, and it is capped: quoting a 400 kB log dump into a reply would
 * push the answer past the size a single message may be.
 */
function quoteOf(m: MessageDetail, max = 6000): string {
  const body = (m.textBody ?? "").trim();
  if (!body) return "";
  const clipped = body.length > max ? `${body.slice(0, max)}\n…` : body;
  const who = m.headerFrom ?? m.envelopeFrom;
  const when = fullTime(m.receivedAt);
  const quoted = clipped
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return `\n\n── ${t("composer.quotedFrom", { who, when })} ──\n${quoted}`;
}


/**
 * One recipient line, completed from this mailbox's own correspondence.
 *
 * Only the fragment being typed is matched, and only the tail of the field is replaced on
 * pick, so completing "cus" never rewrites the addresses already committed before it. The
 * list is a real combobox because Enter here means "accept the suggestion", not "send" — a
 * mailbox must not fire off a message because somebody finished an address.
 */
function RecipientField({
  id,
  label,
  hint,
  value,
  onPick,
}: {
  /** Stable because it is what the label points at: derived from a translated string, two
   *  Vietnamese labels could collapse to the same id and unlatch both fields. */
  id: string;
  label: string;
  hint: string;
  value: string;
  onPick: (next: string) => void;
}) {
  const [items, setItems] = useState<RecipientSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Everything after the last separator is the token worth completing.
  const tailStart = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"), value.lastIndexOf("\n")) + 1;
  const tail = value.slice(tailStart);
  const token = tail.trim();

  useEffect(() => {
    if (token.length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      api
        .recipients(token)
        .then((r) => {
          if (stale) return;
          setItems(r.items);
          setActive(0);
          setOpen(r.items.length > 0);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [token]);

  function complete(suggestion: RecipientSuggestion) {
    onPick(`${value.slice(0, tailStart)}${suggestion.address}, `);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
      return;
    }
    if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
      e.preventDefault();
      complete(items[active] ?? items[0]!);
      return;
    }
    if (e.key === "Escape") {
      // Stops before the modal's own Escape handler, so the first Escape closes the list and
      // the second one leaves the composer.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="field recipient-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => {
          onPick(e.target.value);
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={hint}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${id}-opt-${active}` : undefined}
      />
      {/* The input names this list through aria-controls; giving the list the same accessible
          name as the field would make the field itself ambiguous to locate. */}
      {open ? (
        <ul className="recip-list" id={`${id}-list`} role="listbox">
          {items.map((it, i) => (
            <li
              key={it.address}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : ""}
              onMouseDown={(e) => {
                // mousedown, not click: the input's blur would otherwise close the list first.
                e.preventDefault();
                complete(it);
              }}
            >
              <span className="recip-name">{it.name ?? it.address}</span>
              {it.name && it.name !== it.address ? <span className="recip-addr faint">{it.address}</span> : null}
              {it.outgoing ? <span className="recip-tag faint">{t("composer.youWrote")}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
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
  const [text, setText] = useState(() => (replyTo ? quoteOf(replyTo) : ""));
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
            <RecipientField id="compose-to" label={t("composer.to")} hint="someone@example.com" value={to} onPick={setTo} />
            {recipientCount > 0 ? <div className="field-hint">{t("composer.recipients", { n: recipientCount })}</div> : null}
            <details className="composer-cc">
              <summary>{t("composer.cc")}</summary>
              <RecipientField id="compose-cc" label={t("composer.cc")} hint="someone-else@example.com" value={cc} onPick={setCc} />
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
