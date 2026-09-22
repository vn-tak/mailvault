import { sendPill } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { MessageRecipient, SendStatus } from "@mailvault/shared";

/**
 * What happened to a message after it left.
 *
 * One line per destination, because that is how it actually went: a message to three people
 * can arrive at one and be refused by two, and any single word about it would be true for at
 * most one of them. The summary above the lines is the same answer reduced to one state, which
 * is what the list badge shows.
 */
export function DeliveryReport({
  status,
  error,
  recipients,
}: {
  status: SendStatus | null;
  error: string | null;
  recipients: MessageRecipient[];
}) {
  const failed = !!status && sendPill(status) === "error";
  return (
    <div className={`banner mt ${failed ? "error" : ""}`}>
      <span className="muted">{t(`send.status.${status ?? "QUEUED"}`)}</span>
      {error ? <div className="faint detail">{error}</div> : null}
      {recipients.length > 0 ? (
        <>
          <div className="faint">{t("msg.deliveryPerAddress")}</div>
          <ul className="recip-status">
            {recipients.map((r) => (
              <li key={r.address}>
                <span className="addr">{r.address}</span>
                {r.list !== "to" ? <span className="faint">{r.list}</span> : null}
                <span className={`pill ${sendPill(r.status)}`}>{t(`send.status.${r.status}`)}</span>
                {r.smtpCode ? <span className="faint mono">{r.smtpCode}</span> : null}
                {r.detail ? <span className="faint detail">{r.detail}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="faint detail">{t("msg.noDeliveryYet")}</div>
      )}
    </div>
  );
}
