import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { lang, tellServiceWorker } from "./lib/i18n";
// Bundled, not fetched: the Worker's CSP allows `font-src 'self' data:`, and both families
// carry the Vietnamese range the interface is written in.
import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker is only useful (and only allowed) on a secure origin. Registering it
// is not consent to notifications — that happens in Settings → notifications.
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    // A worker has no localStorage, so the language choice has to be pushed to it.
    void navigator.serviceWorker.ready.then(() => tellServiceWorker(lang())).catch(() => undefined);
  });
}
