import type { SVGProps } from "react";

/**
 * The whole icon set, drawn here rather than installed: twenty-some paths, no dependency,
 * no icon font, and every one of them inherits `currentColor` so a single token change
 * re-colours the set. Decorative by definition — anything that carries meaning has its own
 * text label next to it.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* The mark: an envelope held inside a closed arch — mail that stays put. */
export function VaultMark({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d="M4 20V10a8 8 0 0 1 16 0v10" />
      <path d="M8 14h8M8 17.5h5" />
    </svg>
  );
}

export function IconGauge(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="m14.5 10.5-3.2 3.7" />
      <circle cx="12" cy="14.6" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconGlobe(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4M12 3.8c2.4 2.6 2.4 13.8 0 16.4M12 3.8c-2.4 2.6-2.4 13.8 0 16.4" />
    </Icon>
  );
}

export function IconAlias(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="3.4" />
      <path d="M15.4 12v1.6a2.4 2.4 0 0 0 4.8 0V12a8.2 8.2 0 1 0-4.6 7.3" />
    </Icon>
  );
}

export function IconInbox(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M3.6 13.5 6 5.4A1.8 1.8 0 0 1 7.7 4h8.6a1.8 1.8 0 0 1 1.7 1.4l2.4 8.1" />
      <path d="M3.6 13.5h4.1l1 2.4h6.6l1-2.4h4.1v4.3a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z" />
    </Icon>
  );
}

export function IconSliders(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 6h14M5 12h14M5 18h14" />
      <circle cx="9.5" cy="6" r="2" fill="var(--surface)" />
      <circle cx="15" cy="12" r="2" fill="var(--surface)" />
      <circle cx="8" cy="18" r="2" fill="var(--surface)" />
    </Icon>
  );
}

export function IconSun(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4" />
    </Icon>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </Icon>
  );
}

export function IconAuto(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 3.8v16.4" />
      <path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" fill="currentColor" stroke="none" opacity=".55" />
    </Icon>
  );
}

/* ── Empty-state line art ───────────────────────────────────────────────── */

/* Drawn on a 96×64 grid so it holds the width of a phone card without dominating it. */
function Art({ children }: { children: React.ReactNode }) {
  return (
    <svg width="96" height="64" viewBox="0 0 96 64" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function ArtMailbox() {
  return (
    <Art>
      <path d="M24 52V26a24 24 0 0 1 48 0v26" />
      <path d="M18 52h60" />
      <rect x="36" y="30" width="24" height="15" rx="2.5" />
      <path d="m36 32 12 8 12-8" />
    </Art>
  );
}

export function ArtSearch() {
  return (
    <Art>
      <path d="M22 20h34M22 30h26M22 40h18" opacity=".5" />
      <circle cx="63" cy="35" r="13" />
      <path d="m73 45 9 9" />
    </Art>
  );
}

export function ArtAlias() {
  return (
    <Art>
      <circle cx="48" cy="32" r="10" />
      <path d="M58 32v4a9 9 0 0 1 18 0v-4a28 28 0 1 0-17 25.6" />
      <path d="M20 52h14m-7-7v14" opacity=".55" />
    </Art>
  );
}

export function ArtDomain() {
  return (
    <Art>
      <circle cx="48" cy="32" r="22" />
      <path d="M26 32h44M48 10c7 8 7 36 0 44M48 10c-7 8-7 36 0 44" />
      <path d="M33 18c9 5 21 5 30 0M33 46c9-5 21-5 30 0" opacity=".55" />
    </Art>
  );
}
