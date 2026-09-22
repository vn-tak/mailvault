import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { t, setLang, lang, type Lang } from "../lib/i18n";
import { setTheme, theme, themeName } from "../lib/theme";
import { relativeTime, senderName } from "../lib/format";
import { IconAlias, IconGauge, IconGlobe, IconInbox, IconSearch, IconSliders } from "./Icons";
import type { Alias, Domain, MessageSummary } from "@mailvault/shared";

/**
 * One place to go anywhere. The palette exists because the alternative was five screens
 * each with its own way to filter: a mailbox switcher here, a search field there, a select
 * for domains. Typing is faster than all of them and it is the same gesture everywhere.
 *
 * Search is server-side, not a client filter over what happens to be loaded — the point is
 * to find the message from last month, which is not in this tab's memory.
 */

interface Item {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon?: React.ReactNode;
  run: () => void;
}

function commands(): Item[] {
  const other = theme() === "paper" ? "graphite" : "paper";
  const otherLang: Lang = lang() === "vi" ? "en" : "vi";
  return [
    { id: "new-alias", group: t("pal.group.actions"), label: t("dash.newAlias"), icon: <IconAlias size={16} />, run: () => navigate("/aliases?new=1") },
    { id: "sync", group: t("pal.group.actions"), label: t("dom.sync"), sub: t("pal.sub.readonly"), icon: <IconGlobe size={16} />, run: () => navigate("/domains?run=sync") },
    { id: "verify", group: t("pal.group.actions"), label: t("dom.verify"), sub: t("dom.verifyTitle"), icon: <IconGauge size={16} />, run: () => navigate("/domains?run=verify") },
    { id: "theme", group: t("pal.group.actions"), label: t("pal.switchTo", { name: themeName(other) }), icon: <IconGauge size={16} />, run: () => setTheme(other) },
    { id: "lang", group: t("pal.group.actions"), label: t("pal.switchTo", { name: otherLang === "vi" ? "Tiếng Việt" : "English" }), icon: <IconSliders size={16} />, run: () => setLang(otherLang) },
    { id: "go-inbox", group: t("pal.group.go"), label: t("nav.inbox"), icon: <IconInbox size={16} />, run: () => navigate("/inbox") },
    { id: "go-aliases", group: t("pal.group.go"), label: t("nav.aliases"), icon: <IconAlias size={16} />, run: () => navigate("/aliases") },
    { id: "go-domains", group: t("pal.group.go"), label: t("nav.domains"), icon: <IconGlobe size={16} />, run: () => navigate("/domains") },
    { id: "go-dash", group: t("pal.group.go"), label: t("nav.dashboard"), icon: <IconGauge size={16} />, run: () => navigate("/") },
    { id: "go-settings", group: t("pal.group.go"), label: t("nav.settings"), icon: <IconSliders size={16} />, run: () => navigate("/settings") },
  ];
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const query = q.trim();

  useEffect(() => {
    if (query.length < 1) {
      setMessages([]);
      setAliases([]);
      setDomains([]);
      setBusy(false);
      return;
    }
    const id = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      Promise.all([
        api.listMessages({ q: query, limit: 6, filter: "all" }).catch(() => null),
        api.listAliases(query, "all").catch(() => null),
        api.listDomains().catch(() => null),
      ])
        .then(([m, a, d]) => {
          if (id !== seq.current) return;
          setMessages(m?.items ?? []);
          setAliases(a?.items ?? []);
          setDomains((d?.items ?? []).filter((x) => x.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5));
        })
        .finally(() => {
          if (id === seq.current) setBusy(false);
        });
    }, 160);
    return () => clearTimeout(timer);
  }, [query]);

  const items = useMemo<Item[]>(() => {
    const cmds = commands();
    if (!query) {
      // Idle: the commands and the screens, which is what someone with an empty box wants.
      return cmds;
    }
    const found: Item[] = [
      ...messages.map((m) => ({
        id: `m-${m.id}`,
        group: t("pal.group.mail"),
        label: m.subject || t("inbox.noSubject"),
        sub: `${senderName(m.headerFrom, m.envelopeFrom)} · ${relativeTime(m.receivedAt)}`,
        run: () => navigate(`/messages/${m.id}`),
      })),
      ...aliases.map((a) => ({
        id: `a-${a.id}`,
        group: t("pal.group.aliases"),
        label: a.label || a.address,
        sub: a.label ? a.address : undefined,
        icon: <IconAlias size={16} />,
        run: () => navigate(`/aliases/${a.id}`),
      })),
      ...domains.map((d) => ({
        id: `d-${d.id}`,
        group: t("pal.group.domains"),
        label: d.name,
        sub: t("pal.openMailbox"),
        icon: <IconGlobe size={16} />,
        run: () => navigate(`/inbox?domain=${d.id}`),
      })),
    ];
    const needle = query.toLowerCase();
    const matching = cmds.filter((c) => c.label.toLowerCase().includes(needle));
    return [...found, ...matching];
  }, [query, messages, aliases, domains]);

  useEffect(() => setActive(0), [items.length, query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [active, items.length]);

  function choose(item: Item) {
    onClose();
    item.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      // A palette has one text field and one list; arrow keys move inside it.
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      if (items.length === 0) return;
      e.preventDefault();
      setActive((i) =>
        e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length,
      );
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = items[active];
      if (item) choose(item);
    }
  }

  let lastGroup = "";

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("pal.title")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette-input">
          <IconSearch size={18} />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `pal-opt-${active}` : undefined}
            aria-autocomplete="list"
            value={q}
            placeholder={t("pal.placeholder")}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {busy ? <span className="spinner" /> : null}
        </div>

        <div className="palette-list" id="palette-list" role="listbox" ref={listRef} aria-label={t("pal.results")}>
          {items.length === 0 && (
            <div className="palette-empty">{busy ? t("pal.searching") : t("pal.empty")}</div>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const on = i === active;
            return (
              <div key={item.id}>
                {header ? <div className="palette-group">{header}</div> : null}
                <div
                  id={`pal-opt-${i}`}
                  role="option"
                  aria-selected={on}
                  data-active={on}
                  className="palette-opt"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(item)}
                >
                  {item.icon ? <span className="palette-opt-icon">{item.icon}</span> : null}
                  <span className="palette-opt-label">{item.label}</span>
                  {item.sub ? <span className="palette-opt-sub">{item.sub}</span> : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="palette-foot">
          <span>{t("pal.hint")}</span>
          {query ? <span className="num">{items.length}</span> : null}
        </div>
      </div>
    </div>
  );
}
