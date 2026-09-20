import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectLang, en, lang, setLang, t, vi } from "./i18n";

/*
 * The string layer is only safe if the two dictionaries stay aligned: a key the Vietnamese
 * side forgot silently falls back to English (intended), while a key *both* sides forgot
 * prints its own name on screen (not intended). These tests are what keep the two in step
 * as screens grow, because nothing else in the build checks it.
 */

/*
 * Node exposes a `localStorage` global of its own, and under Vitest it shadows the jsdom
 * one — an object with no working methods. A stand-in is installed here so the persistence
 * path is actually exercised; the module's own try/catch is what keeps a real browser
 * without storage (private mode) from failing.
 */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

const realStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: fakeStorage(), configurable: true, writable: true });
});

afterEach(() => {
  setLang("en");
  if (realStorage) Object.defineProperty(globalThis, "localStorage", realStorage);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
});

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("dictionary alignment", () => {
  it("has every English key in Vietnamese and the other way round", () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty string and no copy-paste of the key itself", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, key).not.toBe("");
      expect(value, key).not.toBe(key);
      expect(vi[key], key).not.toBe("");
    }
  });

  it("interpolates the same variables in both languages", () => {
    for (const key of Object.keys(en)) {
      expect(placeholders(vi[key] ?? ""), key).toEqual(placeholders(en[key] ?? ""));
    }
  });

  it("keeps every key namespaced by the screen it belongs to", () => {
    for (const key of Object.keys(en)) expect(key, key).toMatch(/^[a-z]+\.[A-Za-z0-9]+$/);
  });
});

describe("choosing the language", () => {
  it("prefers a stored choice over the browser", () => {
    expect(detectLang("en-US", "vi")).toBe("vi");
    expect(detectLang("vi-VN", "en")).toBe("en");
  });

  it("follows the browser when nothing was stored", () => {
    expect(detectLang("vi-VN", null)).toBe("vi");
    expect(detectLang("en-GB", null)).toBe("en");
    expect(detectLang("fr-FR", null)).toBe("en");
  });

  it("ignores a stored value that is not a language the app has", () => {
    expect(detectLang("vi", "de")).toBe("vi");
  });

  it("remembering the choice also labels the document", () => {
    setLang("vi");
    expect(lang()).toBe("vi");
    expect(localStorage.getItem("mailvault-lang")).toBe("vi");
    expect(document.documentElement.lang).toBe("vi");
  });
});

describe("reading a string", () => {
  it("fills in the variables a screen passes", () => {
    expect(t("inbox.showing", { from: 1, to: 50, total: 132 })).toBe("Showing 1–50 of 132");
  });

  it("leaves a hole rather than a placeholder when a variable is missing", () => {
    const out = t("inbox.showing", { from: 1 });
    expect(out).toContain("1");
    expect(out).not.toMatch(/\{\w+\}/);
  });

  it("shows the key itself when nobody has heard of it, so a typo is visible", () => {
    expect(t("dash.noSuchKey")).toBe("dash.noSuchKey");
  });

  it("falls back to English, not to the key, when Vietnamese is missing a string", () => {
    const held = vi["dash.title"] ?? "";
    delete vi["dash.title"];
    try {
      setLang("vi");
      expect(t("dash.title")).toBe("Dashboard");
    } finally {
      vi["dash.title"] = held;
    }
  });

  it("translates the same key differently per language", () => {
    expect(t("nav.inbox")).toBe("Inbox");
    setLang("vi");
    expect(t("nav.inbox")).toBe("Hộp thư");
  });
});
