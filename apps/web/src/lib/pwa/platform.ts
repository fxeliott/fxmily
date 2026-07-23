/**
 * PWA platform detection — pure, dependency-free helpers shared by the install
 * flow (`/install` page, `<InstallGuide>`, `<IOSInstallHint>`).
 *
 * Kept deliberately tiny and side-effect-free so it is unit-testable in Vitest's
 * default `node` environment (no jsdom): `detectPlatform` is pure, and
 * `isStandalone` is SSR-guarded (`typeof window === 'undefined'` → false) so it
 * can be exercised on the server branch directly and stubbed for the browser
 * branches via `vi.stubGlobal('window', …)`.
 */

export type Platform = 'ios' | 'android' | 'desktop';

/**
 * Classify a User-Agent string into one of three install experiences.
 *
 * - iOS (iPhone / iPad / iPod) → manual Share-sheet "Add to Home Screen" flow.
 * - Android → Chromium `beforeinstallprompt` (or browser-menu fallback).
 * - everything else → desktop Chromium prompt (or browser-menu fallback).
 *
 * Pure and case-insensitive. Note: iPadOS 13+ Safari masquerades as a desktop
 * "Macintosh" UA. We disambiguate with a runtime touch signal
 * (`navigator.maxTouchPoints`): a "Macintosh" UA reporting more than one touch
 * point is an iPad (real Macs report 0). Client callers should pass
 * `navigator.maxTouchPoints`; the default of 0 keeps the function pure and
 * SSR-safe (a bare "Macintosh" UA stays 'desktop').
 */
export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  const s = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return 'ios';
  if (/android/.test(s)) return 'android';
  // iPadOS 13+ Safari reports a "Macintosh" UA; a positive touch count
  // (real Macs report 0) reveals it is actually an iPad.
  if (maxTouchPoints > 1 && s.includes('macintosh')) return 'ios';
  return 'desktop';
}

/**
 * Is the app currently running as an installed / standalone PWA?
 *
 * True when EITHER the standard `display-mode: standalone` media query matches
 * (Chromium, and iOS when launched from a manifest-installed icon) OR the legacy
 * iOS Safari `navigator.standalone` flag is set.
 *
 * SSR-safe: returns `false` when `window` is undefined so it never throws during
 * server rendering. Fails closed (returns `false`) if `matchMedia` throws.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  // Legacy iOS Safari flag (predates display-mode support on iOS).
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav?.standalone === true) return true;

  if (typeof window.matchMedia === 'function') {
    try {
      return window.matchMedia('(display-mode: standalone)').matches;
    } catch {
      return false;
    }
  }

  return false;
}
