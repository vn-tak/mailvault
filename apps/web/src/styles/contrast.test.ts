import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Contrast is a design constraint, not a review comment. These pairs are the combinations a
 * screen actually paints — meta text on a card, a link on a card, a status word on its own
 * tint — and the numbers are WCAG's own relative-luminance ratio. A token change that makes
 * `--faint` too quiet to read at 11px fails here rather than on a phone in sunlight.
 */

// jsdom gives import.meta.url an http form, so resolve from the workspace root instead.
const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `tokens.css has no ${selector} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1] as string] = m[2] as string;
  return out;
}

const rgb = (hex: string): [number, number, number] => {
  const c = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as [number, number, number];
};

const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const ratio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Small text: 4.5:1. `min` is where a pair is only ever large or bold. */
const pairs: Array<[string, string, string, number]> = [
  ["--text", "--bg", "body text on the page", 4.5],
  ["--text", "--surface", "body text on a card", 4.5],
  ["--text", "--sunken", "text in a code well", 4.5],
  ["--muted", "--surface", "secondary text on a card", 4.5],
  ["--faint", "--surface", "meta text on a card", 4.5],
  ["--faint", "--surface-2", "meta text on a raised strip", 4.5],
  ["--accent", "--surface", "a link on a card", 4.5],
  ["--accent", "--accent-tint", "the accent on its own tint", 4.5],
  ["--ok", "--surface", "a verified status word", 4.5],
  ["--warn", "--surface", "a warning word", 4.5],
  ["--danger", "--surface", "a danger word", 4.5],
  ["--primary-ink", "--primary", "the label on a primary button", 4.5],
];

describe("colour tokens stay readable", () => {
  for (const [selector, label] of [["", "graphite"], ["[data-theme=\"paper\"]", "paper"]] as const) {
    const tokens = block(selector || ":root");
    it(`${label}: every pair clears its ratio`, () => {
      for (const [fg, bg, name, min] of pairs) {
        const f = tokens[fg];
        const b = tokens[bg];
        expect(f, `${label} is missing ${fg}`).toBeTruthy();
        expect(b, `${label} is missing ${bg}`).toBeTruthy();
        expect(ratio(f as string, b as string), `${label}: ${name}`).toBeGreaterThanOrEqual(min);
      }
    });

    it(`${label}: the three status colours are told apart by hue, not lightness`, () => {
      /*
       * In the light theme every status colour has to sit dark to pass contrast, so
       * lightness separates nothing — the hues have to. A 6px dot is the only difference
       * between "ready" and "conflict" in a few places, and no reader should have to guess
       * a hue that is 15° away from another. (Every one of them also carries a word.)
       */
      const hue = (hex: string) => {
        const [r, g, b] = rgb(hex);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        if (d === 0) return -1;
        const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return (h * 60 + 360) % 360;
      };
      const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
      const ok = hue(tokens["--ok"] as string);
      const warn = hue(tokens["--warn"] as string);
      const danger = hue(tokens["--danger"] as string);
      expect(apart(ok, warn), `${label}: verified and warning are too close in hue`).toBeGreaterThanOrEqual(30);
      expect(apart(warn, danger), `${label}: warning and danger are too close in hue`).toBeGreaterThanOrEqual(20);
      expect(apart(ok, danger), `${label}: verified and danger are too close in hue`).toBeGreaterThanOrEqual(60);
    });
  }
});
