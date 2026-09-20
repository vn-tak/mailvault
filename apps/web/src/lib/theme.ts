import { useEffect, useState } from "react";

/**
 * Theme choice, mirroring lib/i18n.ts: a display preference, so localStorage is the right
 * place and nothing secret or session-shaped is ever stored there.
 *
 * The default is `system`, because a mail client opened at a desk in daylight and on a phone
 * at night is not one theme's job. An explicit choice wins over the media query and survives
 * a reload. The Worker's CSP forbids inline scripts, so the theme is applied when this module
 * is imported — a few milliseconds after first paint at worst, and only on the first visit.
 */

export type Theme = "graphite" | "paper";
export type ThemeChoice = "system" | Theme;

export const THEME_CHOICES: ThemeChoice[] = ["system", "graphite", "paper"];
const STORAGE_KEY = "mailvault-theme";

export function resolveTheme(choice: ThemeChoice, prefersLight: boolean): Theme {
  if (choice === "graphite" || choice === "paper") return choice;
  return prefersLight ? "paper" : "graphite";
}

function readStored(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "graphite" || v === "paper" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

function prefersLight(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: light)").matches;
}

let choice: ThemeChoice = readStored();
let applied: Theme = resolveTheme(choice, prefersLight());
const listeners = new Set<() => void>();

function apply(): void {
  applied = resolveTheme(choice, prefersLight());
  if (typeof document !== "undefined") document.documentElement.dataset.theme = applied;
}

apply();

if (typeof window !== "undefined" && window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  // Only the system choice follows the device; an explicit one is the owner's call.
  mq.addEventListener?.("change", () => {
    if (choice === "system") {
      apply();
      for (const fn of listeners) fn();
    }
  });
}

export function themeChoice(): ThemeChoice {
  return choice;
}

export function theme(): Theme {
  return applied;
}

export function setTheme(next: ThemeChoice): void {
  choice = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode: the choice just won't survive a reload */
  }
  apply();
  for (const fn of listeners) fn();
}

export function themeName(t: Theme): string {
  return t === "paper" ? "Paper" : "Graphite";
}

/** Re-renders the tree when the theme changes. */
export function useTheme(): { choice: ThemeChoice; theme: Theme } {
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  return { choice, theme: applied };
}
