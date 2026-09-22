import { t } from "../../lib/i18n";

/**
 * The unsubscribe the sender offered.
 *
 * Only for a message whose sender authentication aligned. An unsubscribe address is
 * attacker-authored text like any other link, and the one thing it proves when it is hit is
 * that a live human read the mail — which is precisely what a forger is buying. So an
 * unverified sender gets a line explaining why nothing is offered, not a button.
 */
export function UnsubscribeCard({ url, mailto, oneClick }: { url: string | null; mailto: string | null; oneClick: boolean }) {
  return (
    <div className="card unsubscribe mt">
      <div className="row spread wrap" style={{ gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <strong>{t("msg.unsubscribe")}</strong>
          <div className="faint" style={{ fontSize: 13 }}>
            {oneClick ? t("msg.unsubscribeOneClick") : t("msg.unsubscribeLink")}
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {url ? (
            <a className="small primary" href={url} target="_blank" rel="noopener noreferrer nofollow">
              {t("msg.unsubscribeGo")}
            </a>
          ) : null}
          {mailto ? (
            <a className="small ghost" href={mailto}>
              {t("msg.unsubscribeMail")}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** `List-Unsubscribe` carries `<https://a>`, `<mailto:b>` — either order, sometimes one. */
export function parseUnsubscribe(raw: string | null): { url: string | null; mailto: string | null } {
  const uris = [...(raw ?? "").matchAll(/<\s*([^>\s]+)\s*>/g)].map((m) => m[1] ?? "");
  return {
    url: uris.find((u) => u.startsWith("https://") || u.startsWith("http://")) ?? null,
    mailto: uris.find((u) => u.startsWith("mailto:")) ?? null,
  };
}
