import { useMemo } from "react";
import { api } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useAsync } from "../lib/useAsync";
import { relativeTime, senderName } from "../lib/format";
import { arrivalLabel, splitMailboxes } from "../lib/mailboxes";
import { t } from "../lib/i18n";
import { ErrorBanner, Loading } from "../components/ui";
import { MailStatus, type MailboxStat } from "@mailvault/shared";

function MailboxCard({ m }: { m: MailboxStat }) {
  const receiving = m.mailStatus === MailStatus.Ready;
  return (
    <Link to={`/inbox?domain=${m.domainId}`} className="mailbox">
      <span className="mailbox-name">{m.name}</span>
      <span className="mailbox-facts">
        <span>{t("common.nMessages", { n: m.total })}</span>
        {m.unread > 0 ? <span className="pill accent">{t("common.nUnread", { n: m.unread })}</span> : null}
        {m.lastReceivedAt ? <span>{t("common.last", { at: relativeTime(m.lastReceivedAt) })}</span> : null}
        {!receiving ? <span className="pill conflict">{t("dash.notReceiving")}</span> : null}
      </span>
    </Link>
  );
}

export function Dashboard() {
  const { data, error, loading } = useAsync(() => api.dashboard(), []);
  const { data: health } = useAsync(() => api.health(), []);

  const split = useMemo(() => splitMailboxes(data?.mailboxes ?? []), [data]);
  const hidden = split.overflow.length + split.empty.length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t("dash.title")}</h1>
        <div className="actions">
          <button className="primary" onClick={() => navigate("/aliases?new=1")}>
            {t("dash.newAlias")}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          {/* One line for the whole census. A degraded check gets a banner below, because
              a status that needs action should not be scannable as a footnote. */}
          <div className="statline">
            <span style={{ color: health?.ok === false ? "var(--warn)" : "var(--ok)", fontWeight: 600 }}>
              {"● "}
              {t(health ? (health.ok ? "dash.online" : "dash.degraded") : "dash.checking")}
            </span>
            <span>
              <strong>{data.activeDomains}</strong> {t("dash.domainsReceive", { n: data.totalDomains })}
            </span>
            <span>
              <strong>{data.totalAliases}</strong> {t("dash.aliases")}
            </span>
            <span>
              <strong>{data.unreadMessages}</strong> {t("dash.unread")}
            </span>
            <span>
              <strong>{data.totalMessages}</strong> {t("dash.stored")}
            </span>
          </div>

          {health && !health.ok && (
            <div className="banner error">
              {t("dash.healthFail", {
                what:
                  [
                    health.checks?.d1 === "error" && t("dash.hcD1"),
                    health.checks?.r2 === "error" && t("dash.hcR2"),
                    health.checks?.token === "error" && t("dash.hcToken"),
                  ]
                    .filter(Boolean)
                    .join(", ") || t("dash.hcAny"),
              })}
            </div>
          )}

          <div className="card card--flush">
            <div className="list-head">
              <h2 style={{ margin: 0 }}>{t("dash.mailboxes")}</h2>
              <span className="faint" style={{ fontSize: 13 }}>
                {t("dash.mailboxHint")}
              </span>
              <div className="head-actions">
                <button className="ghost small" onClick={() => navigate("/inbox")}>
                  {t("dash.allMail")}
                </button>
              </div>
            </div>
            <div style={{ padding: "var(--space-2)" }}>
              {split.shown.length === 0 ? (
                <div className="muted" style={{ fontSize: 14 }}>
                  {t("dash.empty")}
                </div>
              ) : (
                <div className="mailboxes">
                  {split.shown.map((m) => (
                    <MailboxCard key={m.domainId} m={m} />
                  ))}
                </div>
              )}
              {hidden > 0 && (
                <details className="more-mailboxes">
                  <summary>
                    {t("dash.otherDomains", {
                      n: hidden,
                      plural: t(hidden === 1 ? "dash.wordDomain" : "dash.wordDomains"),
                    })}
                    {/* Only worth saying when it is not obvious from the count above it. */}
                    {split.empty.length > 0 && split.empty.length !== hidden
                      ? ` ${t("dash.noMailYet", { n: split.empty.length })}`
                      : ""}
                  </summary>
                  <div className="chipset">
                    {[...split.overflow, ...split.empty].map((m) => (
                      <Link key={m.domainId} to={`/inbox?domain=${m.domainId}`} className="chip">
                        {m.name}
                        {m.total > 0 ? ` · ${m.total}` : ""}
                      </Link>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>

          <div className="card card--flush mt">
            <div className="list-head">
              <h2 style={{ margin: 0 }}>{t("dash.recent")}</h2>
              <div className="head-actions">
                <button className="ghost small" onClick={() => navigate("/inbox")}>
                  {t("dash.openInbox")}
                </button>
              </div>
            </div>
            {data.recentMessages.length === 0 ? (
              <p className="muted" style={{ padding: "var(--space-2)" }}>
                {t("dash.noMessages")}
              </p>
            ) : (
              <ul className="msglist">
                {data.recentMessages.map((m) => (
                  <li key={m.id} className={`msg ${m.isRead ? "" : "unread"}`}>
                    <Link to={`/messages/${m.id}`}>
                      <span className="msg-sender">{senderName(m.headerFrom, m.envelopeFrom)}</span>
                      <span className="msg-time">{relativeTime(m.receivedAt)}</span>
                      <span className="msg-subject">{m.subject || t("inbox.noSubject")}</span>
                      <span className="msg-alias">{arrivalLabel(m, false)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
