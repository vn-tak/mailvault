import { useCallback, useEffect, useState } from "react";

/**
 * A ~40-line hash router. Chosen over a router dependency to keep the SPA tiny; a
 * private personal tool doesn't need history-mode routing, nested loaders, or SSR.
 * Routes live under the URL hash (e.g. #/inbox/m123) so the Worker's SPA fallback
 * serves index.html for every path and the client owns navigation.
 */
function currentLocation(): { path: string; query: URLSearchParams } {
  const raw = window.location.hash.slice(1) || "/";
  const [path, qs] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(qs ?? "") };
}

export function navigate(to: string, replace = false): void {
  const target = `#${to}`;
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

export function useRoute(): { path: string; query: URLSearchParams } {
  const [loc, setLoc] = useState(currentLocation);
  useEffect(() => {
    const onChange = () => setLoc(currentLocation());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return loc;
}

/** Match "/messages/:id" against "/messages/abc" -> { id: "abc" }, or null. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const ap = path.split("/").filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i]!;
    const val = ap[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(val);
    else if (seg !== val) return null;
  }
  return params;
}

export function Link({
  to,
  className,
  children,
  onClick,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const handle = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onClick?.();
      navigate(to);
    },
    [to, onClick],
  );
  return (
    <a href={`#${to}`} className={className} onClick={handle}>
      {children}
    </a>
  );
}
