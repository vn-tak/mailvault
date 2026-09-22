import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { NEW_MAIL_EVENT } from "../lib/live";
import { t } from "../lib/i18n";

/**
 * "Mail arrived" as a notice, not a silent refetch.
 *
 * The socket carries no content (SECURITY.md §6.4), and neither does this: the count comes
 * from the same authenticated list route the inbox uses, so the only thing said out loud is
 * how many unread messages the owner could already see if they were looking. Who sent them
 * stays behind the API call that requires a session.
 */
export function NewMailToast() {
  const [count, setCount] = useState<number | null>(null);
  const baseline = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const total = () =>
      api
        .listMessages({ filter: "unread", limit: 1 })
        .then((r) => r.total)
        .catch(() => null);

    void total().then((v) => {
      if (v !== null) baseline.current = v;
    });

    const onNewMail = async () => {
      const now = await total();
      if (now === null || !alive) return;
      const before = baseline.current;
      baseline.current = now;
      if (before === null || now <= before) return;
      setCount(now - before);
    };

    window.addEventListener(NEW_MAIL_EVENT, onNewMail);
    return () => {
      alive = false;
      window.removeEventListener(NEW_MAIL_EVENT, onNewMail);
    };
  }, []);

  useEffect(() => {
    if (count === null) return;
    const timer = setTimeout(() => setCount(null), 8000);
    return () => clearTimeout(timer);
  }, [count]);

  if (count === null) return null;

  return (
    <div className="toast-host" role="status">
      <div className="toast">
        <span className="msg-count">{t("toast.newMail", { n: count })}</span>
        <span className="actions">
          <button
            className="small primary"
            onClick={() => {
              setCount(null);
              navigate("/inbox");
            }}
          >
            {t("toast.view")}
          </button>
          <button className="ghost small" aria-label={t("common.close")} onClick={() => setCount(null)}>
            ✕
          </button>
        </span>
      </div>
    </div>
  );
}
