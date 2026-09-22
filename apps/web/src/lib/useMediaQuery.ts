import { useEffect, useState } from "react";

/**
 * A media query as state. Used where the layout is genuinely a different product — a
 * two-pane reader on a wide screen, a stacked route on a handset — rather than where CSS
 * can do it. The listener keeps it correct when a window is dragged across that line.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
