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
 * How — or whether — the CURRENT desktop browser can install a web app.
 *
 * `'desktop'` from `detectPlatform` is not one experience but four, and they are
 * not interchangeable: three of the four cannot follow Chromium's instructions.
 *
 * - `'chromium'`   — Chrome / Edge / Brave …: an install affordance in the
 *                    address bar (and `beforeinstallprompt`).
 * - `'safari-dock'`— Safari on macOS: *File ▸ Add to Dock…*, shipped with macOS
 *                    Sonoma (Safari 17). No address-bar icon, no ⋮ menu.
 * - `'none'`       — Firefox desktop: cannot install a web app from a manifest
 *                    at all. Showing it steps would be a lie.
 * - `'unknown'`    — anything we cannot positively identify: say so, don't guess.
 *
 * Sources (MDN, "Making PWAs installable"): "Safari supports Add to Dock
 * (File > Add to Dock...) on macOS Sonoma (Safari 17) and later"; "Firefox does
 * not support installing PWAs using a manifest file."
 */
export type DesktopInstallPath = 'chromium' | 'safari-dock' | 'none' | 'unknown';

/**
 * Classify the desktop install path, preferring CAPABILITY over User-Agent.
 *
 * `hasInstallPromptApi` is the presence of `onbeforeinstallprompt` on `window`:
 * a direct, unspoofable statement by the engine that it implements the Chromium
 * install flow. We trust it first, precisely because it cannot rot the way a UA
 * pattern does — a future Chromium fork renaming itself still answers `true`.
 *
 * UA sniffing only breaks the tie the platform gives us no feature for: Safari
 * and Firefox both lack the API, yet one CAN install and the other CANNOT, so no
 * amount of feature detection separates them. We keep that sniff as narrow as
 * possible (a positive `Firefox/`/`FxiOS` token, else Safari's `Version/…Safari/`
 * pair with every Chromium-fork token excluded) and degrade to `'unknown'`
 * rather than assume.
 *
 * Pure: pass the two inputs, get the answer. Callers on the client pass
 * `'onbeforeinstallprompt' in window`.
 */
export function detectDesktopInstallPath(
  ua: string,
  hasInstallPromptApi: boolean,
): DesktopInstallPath {
  if (hasInstallPromptApi) return 'chromium';

  const s = ua.toLowerCase();
  if (/firefox\/|fxios\//.test(s)) return 'none';

  // Safari proper: ships a `Version/x` token next to `Safari/x`. Every Chromium
  // fork also carries `safari/` for legacy reasons, so they must be excluded by
  // name; `chrome/` alone is not enough (Edge is `edg/`, Opera `opr/`).
  const chromiumFork =
    /chrome\/|chromium\/|edg\/|edga\/|edgios\/|opr\/|opera\/|crios\/|samsungbrowser\//;
  if (/version\/\d/.test(s) && /safari\//.test(s) && !chromiumFork.test(s)) return 'safari-dock';

  return 'unknown';
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
