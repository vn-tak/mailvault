import { useEffect } from "react";
import { Link, matchRoute, useRoute } from "./lib/router";
import { connectLive } from "./lib/live";
import { t, useLang } from "./lib/i18n";
import { Dashboard } from "./pages/Dashboard";
import { Domains } from "./pages/Domains";
import { Aliases } from "./pages/Aliases";
import { AliasDetail } from "./pages/AliasDetail";
import { Inbox } from "./pages/Inbox";
import { MessageDetail } from "./pages/MessageDetail";
import { Settings } from "./pages/Settings";

const NAV = [
  { to: "/", key: "nav.dashboard" },
  { to: "/domains", key: "nav.domains" },
  { to: "/aliases", key: "nav.aliases" },
  { to: "/inbox", key: "nav.inbox" },
  { to: "/settings", key: "nav.settings" },
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

  useEffect(() => connectLive().stop, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" /> MailVault
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={isActive(path, n.to) ? "active" : ""}>
              {t(n.key)}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Route />
      </main>
    </div>
  );
}
