import { useEffect } from "react";
import { Link, matchRoute, useRoute } from "./lib/router";
import { connectLive, useLiveStatus } from "./lib/live";
import { t, useLang } from "./lib/i18n";
import { useTheme } from "./lib/theme";
import { IconAlias, IconGauge, IconGlobe, IconInbox, IconSliders, VaultMark } from "./components/Icons";
import { Dashboard } from "./pages/Dashboard";
import { Domains } from "./pages/Domains";
import { Aliases } from "./pages/Aliases";
import { AliasDetail } from "./pages/AliasDetail";
import { Inbox } from "./pages/Inbox";
import { MessageDetail } from "./pages/MessageDetail";
import { Settings } from "./pages/Settings";

const NAV = [
  { to: "/", key: "nav.dashboard", Icon: IconGauge },
  { to: "/domains", key: "nav.domains", Icon: IconGlobe },
  { to: "/aliases", key: "nav.aliases", Icon: IconAlias },
  { to: "/inbox", key: "nav.inbox", Icon: IconInbox },
  { to: "/settings", key: "nav.settings", Icon: IconSliders },
];

function isActive(path: string, to: string): boolean {
  if (to === "/") return path === "/";
  return path === to || path.startsWith(to + "/");
}

function Route() {
  const { path, query } = useRoute();
  const msg = matchRoute("/messages/:id", path);
  if (msg?.id) return <MessageDetail id={msg.id} />;
  const alias = matchRoute("/aliases/:id", path);
  if (alias?.id) return <AliasDetail id={alias.id} />;
  if (path === "/domains") return <Domains />;
  if (path === "/aliases") return <Aliases openNew={query.get("new") === "1"} />;
  if (path === "/inbox") return <Inbox aliasId={query.get("alias") ?? undefined} domainId={query.get("domain") ?? undefined} />;
  if (path === "/settings") return <Settings />;
  if (path === "/" || path === "") return <Dashboard />;
  return (
    <div className="page">
      <h1>{t("common.notFound")}</h1>
      <p className="muted">
        <Link to="/">{t("common.backToDashboard")}</Link>
      </p>
    </div>
  );
}

export function App() {
  const { path } = useRoute();
  useLang();
  useTheme();
  const live = useLiveStatus();

  useEffect(() => connectLive().stop, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <VaultMark />
          </span>
          <span className="brand-text">
            <b>MailVault</b>
            <span>{t("brand.tag")}</span>
          </span>
        </div>
        <nav className="nav" aria-label={t("nav.menu")}>
          {NAV.map((n) => {
            const Icon = n.Icon;
            return (
              <Link key={n.to} to={n.to} className={isActive(path, n.to) ? "active" : ""}>
                <Icon />
                {t(n.key)}
              </Link>
            );
          })}
        </nav>
        <div className="spacer" />
        {/* The socket is the only thing that makes "it refreshes itself" true, so its state
            is stated rather than assumed. */}
        <div className="rail-foot">
          <span className="row" style={{ gap: 7 }}>
            <span className={`live-dot ${live === "live" ? "" : live === "connecting" ? "idle" : "warn"} ${live === "live" ? "is-pulsing" : ""}`} />
            {t(live === "live" ? "live.on" : live === "connecting" ? "live.connecting" : "live.off")}
          </span>
          <span>{t("live.hint")}</span>
        </div>
      </aside>
      <main className="main">
        <Route />
      </main>
    </div>
  );
}
