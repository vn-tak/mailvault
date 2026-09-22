import { useEffect, useMemo } from "react";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { selectableMailboxes } from "../../lib/mailboxes";
import { navigate } from "../../lib/router";
import { t } from "../../lib/i18n";
import { NEW_MAIL_EVENT } from "../../lib/live";
import { IconGlobe, IconInbox } from "../Icons";

/**
 * The mailboxes, in the rail, where switching between them is navigation.
 *
 * They used to sit in a dropdown inside the inbox toolbar, which meant the thing the owner
 * does most — "show me this domain's mail" — was filed under filtering beside the search box,
 * and could only carry a name because a `select` sizes itself to its longest option. As a
 * list they can carry the unread count too, which is the fact the dropdown was hiding.
 *
 * Only domains that can actually receive are offered: an empty list for a broken mailbox is a
 * mystery, while a missing entry with a reason on the Domains screen is not.
 */
export function MailboxRail({ current }: { current?: string }) {
  const domains = useAsync(() => api.listDomains(), []);
  const counters = useAsync(() => api.messageCounters(), []);

  useEffect(() => {
    const refresh = () => counters.reload();
    window.addEventListener(NEW_MAIL_EVENT, refresh);
    return () => window.removeEventListener(NEW_MAIL_EVENT, refresh);
  }, [counters]);

  const mailboxes = useMemo(
    () =>
      selectableMailboxes(
        (domains.data?.items ?? []).map((d) => ({ domainId: d.id, name: d.name, mailStatus: d.mailStatus })),
        current,
      ),
    [domains.data, current],
  );

  if (mailboxes.length === 0) return null;
  const totalUnread = counters.data?.inbox.unread ?? 0;

  return (
    <nav className="rail-mailboxes" aria-label={t("rail.mailboxes")}>
      <span className="rail-heading">{t("rail.mailboxes")}</span>
      <ul>
        <li>
          <button type="button" className={current ? "" : "active"} onClick={() => navigate("/inbox")}>
            <IconInbox size={14} />
            <span className="mbx-name">{t("inbox.allMailboxes")}</span>
            {totalUnread > 0 ? <span className="mbx-count">{totalUnread}</span> : null}
          </button>
        </li>
        {mailboxes.map((m) => {
          const unread = counters.data?.mailboxes.find((b) => b.domainId === m.domainId)?.unread ?? 0;
          return (
            <li key={m.domainId}>
              <button
                type="button"
                className={current === m.domainId ? "active" : ""}
                aria-current={current === m.domainId ? "page" : undefined}
                onClick={() => navigate(`/inbox?domain=${m.domainId}`)}
              >
                <IconGlobe size={14} />
                <span className="mbx-name">{m.name}</span>
                {unread > 0 ? <span className="mbx-count">{unread}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
