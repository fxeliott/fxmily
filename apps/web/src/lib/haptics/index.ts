'use client';

/**
 * Haptic feedback for the checkin wizards (J5 audit UI HIGH H3 — TIER 4
 * follow-up).
 *
 * Cross-platform feature-detect + fallback layer:
 *   1. **Android / Chromium** — `navigator.vibrate(pattern)` natively works.
 *   2. **iOS Safari ≤ 17** — no support, no fallback, the call is a silent
 *      no-op (vibrate returns false / undefined on iOS).
 *   3. **iOS Safari 18+** — `navigator.vibrate` still doesn't exist, but
 *      Apple shipped a non-standard hack: a `<input type="checkbox" switch>`
 *      element triggers a system tactile cue when its `change` event fires.
 *      We detect iOS, programmatically click a hidden switch input, and
 *      Safari emits the haptic.
 *
 * Respect `prefers-reduced-motion` — if the user opted out, haptics are
 * disabled too (audit chained — vibration is a "motion-equivalent"
 * sensation, WCAG 2.3.3 spirit).
 *
 * The functions are intentionally fire-and-forget. Never throw, never
 * await. If the underlying primitive fails the user sees nothing.
 */

const TAP_PATTERN = 8;
const SUCCESS_PATTERN = [12, 30, 12];
const ERROR_PATTERN = [40, 50, 40, 50, 40];

let cachedReducedMotion: boolean | null = null;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  // Cache because matchMedia is cheap but not free, and the user's preference
  // doesn't usually flip mid-session. We could subscribe to a media query
  // listener if we wanted live updates — not worth the complexity for
  // optional sensory feedback.
  if (cachedReducedMotion === null) {
    try {
      cachedReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      cachedReducedMotion = false;
    }
  }
  return cachedReducedMotion;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ identifies as Mac, but it has touch — combo signal works.
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.maxTouchPoints > 1 && /Mac/.test(ua);
}

function tryVibrate(pattern: number | number[]): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  try {
    return navigator.vibrate(pattern) === true;
  } catch {
    return false;
  }
}

function tryIosSwitchHaptic(): void {
  if (typeof document === 'undefined') return;
  try {
    const label = document.createElement('label');
    label.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;';
    label.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'checkbox';
    // The `switch` attribute is non-standard but recognized by Safari 18+
    // and triggers the system haptic on programmatic toggle. Older Safari
    // ignores it harmlessly.
    input.setAttribute('switch', '');
    label.appendChild(input);
    document.body.appendChild(label);

    label.click();

    // Remove next tick — Safari needs the element in the DOM long enough
    // for the click event to dispatch.
    setTimeout(() => {
      try {
        label.remove();
      } catch {
        /* noop */
      }
    }, 0);
  } catch {
    /* no haptic — silent fail */
  }
}

/**
 * Light tap — used on step transitions in the wizard. Fires & forgets.
 */
export function hapticTap(): void {
  if (prefersReducedMotion()) return;
  if (tryVibrate(TAP_PATTERN)) return;
  if (isIOS()) tryIosSwitchHaptic();
}

/**
 * Success cue — a slightly richer pattern. Used on submit success.
 */
export function hapticSuccess(): void {
  if (prefersReducedMotion()) return;
  if (tryVibrate(SUCCESS_PATTERN)) return;
  if (isIOS()) tryIosSwitchHaptic();
}

/**
 * Error cue — used on validation failure / submit error.
 */
export function hapticError(): void {
  if (prefersReducedMotion()) return;
  if (tryVibrate(ERROR_PATTERN)) return;
  if (isIOS()) tryIosSwitchHaptic();
}
