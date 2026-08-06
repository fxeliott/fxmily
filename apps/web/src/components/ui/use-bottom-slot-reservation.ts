'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * The reservation MUST be written before the browser paints: with a plain
 * `useEffect` the page paints once at full height, then shrinks — a visible jump
 * on the very frame the banner appears (and a CLS hit on the entry page).
 *
 * But these islands are `'use client'` components, and Next server-renders those
 * for the initial HTML, where React warns that `useLayoutEffect` does nothing.
 * The warning is right and harmless here (the islands render `null` on the
 * server by design), yet a permanent warning in the SSR logs is how real ones
 * stop being read. The branch is on the environment, not on state, so the hook
 * order is stable in each runtime.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Publish the vertical band a fixed bottom-slot island really occupies, so the
 * page can reserve it instead of letting the island sit on top of the content.
 *
 * ## The defect this exists to close (measured in production, 2026-08-05)
 *
 * The cookie banner is `position: fixed` at the bottom of the viewport and
 * reserved NO space. On the repo's priority viewport (iPhone SE, 375×667) it
 * occupied y=443..655 — a third of the screen — straight over the home page's
 * two calls to action and over the primary submit of `/login` and
 * `/forgot-password`. `document.elementFromPoint()` at the centre of
 * "Se connecter" returned the banner's own paragraph, not the button: a member
 * tapped the main action of the app and nothing happened, with nothing on screen
 * to explain why. Visually it looked fine, which is exactly why it survived.
 *
 * `<A2HSHint>` and `<IOSInstallHint>` copy the same geometry verbatim, so they
 * carry the same defect. Hence a shared hook rather than a fix on one component:
 * enrolling an island is one line, and `bottom-slot-reservation.test.ts` fails
 * loudly for any island that skips it.
 *
 * ## Why the band is measured and not a constant
 *
 * The copy wraps differently at 375px than at 1440px, the `bottom` offset
 * resolves `env(safe-area-inset-bottom)` on notched phones, and a globals.css
 * media query lifts these islands above the Log-Express FAB. A hardcoded height
 * would be wrong on the exact viewport this project prioritises.
 *
 * - `offsetHeight` is the layout box, so it is immune to the `animate-cookie-rise`
 *   entry transform (a `getBoundingClientRect()` read during that animation
 *   reports the island still off-screen, and would publish a band of ~0).
 * - `getComputedStyle().bottom` returns the USED value in px, so `max()`,
 *   `env()` and the FAB-lift media query are all already resolved.
 *
 * Each island writes its OWN variable and removes only that one: `--slot-<name>`
 * when it sits in the bottom slot, `--slot-top-<name>` when a CSS rule has moved
 * it to the top (it then reserves scroll room up there instead — WCAG 2.4.11).
 * globals.css takes the `max()` of each family, so a hidden island (the hints are
 * `display:none` while the banner is up) can never clobber a visible one's value,
 * whatever order the effects run in.
 *
 * @param ref    the island's root element
 * @param active whether the island is currently rendered
 * @param slot   its `data-slot` value — also the CSS variable suffix
 */
export function useBottomSlotReservation(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  slot: string,
): void {
  // A route change can mount/unmount the Log-Express FAB, which moves these
  // islands up via a globals.css `:has()` rule. That changes the band without
  // changing the island's size, so a ResizeObserver alone would miss it.
  const pathname = usePathname();

  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement;
    const property = `--slot-${slot}`;
    const propertyTop = `--slot-top-${slot}`;
    // Block body on purpose: `removeProperty` returns the old value, and an
    // expression-bodied arrow would leak that `string` past the `: void`.
    const clear = (): void => {
      root.style.removeProperty(property);
      root.style.removeProperty(propertyTop);
    };

    const el = ref.current;
    if (!active || !el) {
      clear();
      return;
    }

    const publish = (): void => {
      const height = el.offsetHeight;
      // A hidden island (the CSS arbitration hides the hints under the cookie
      // banner) must reserve nothing — publishing 0 is correct, publishing its
      // pre-hidden height would leave a dead gap at the bottom of every page.
      if (height === 0) {
        clear();
        return;
      }
      const style = window.getComputedStyle(el);
      // WHERE the island sits is read from the SIGNAL the CSS rule sets when it
      // moves it (`--slot-anchored`), never inferred from its geometry — so the
      // position and the space reserved for it cannot drift apart.
      //
      // The first version compared `top < bottom` instead, and got it wrong in
      // phone landscape: at 667×375 the used values are top 58.5 and bottom 136,
      // so it read "anchored at the top" for an island anchored at the BOTTOM
      // covering 48% of the screen — and dropped the reservation exactly where
      // it mattered most. The variable that broke it was the viewport HEIGHT,
      // not its width, so the check run at 800×852 could not see it. Caught by a
      // fresh-context review, then reproduced on the deployed build.
      const anchoredTop = style.getPropertyValue('--slot-anchored').trim() === 'top';
      // The offset that matters is the one on the anchored side. Both are USED
      // values: unlike a rect they survive the entry animation and are stable
      // under scroll (measured identical at scrollY 0 and 1000).
      const offset = Number.parseFloat(anchoredTop ? style.top : style.bottom);
      // An island only ever occupies ONE slot: drop the band it no longer holds,
      // otherwise a stale value would keep reserving space on the other side.
      root.style.removeProperty(anchoredTop ? property : propertyTop);
      root.style.setProperty(
        anchoredTop ? propertyTop : property,
        `${Math.ceil(height + (Number.isFinite(offset) ? offset : 0))}px`,
      );
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    window.addEventListener('resize', publish);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publish);
      clear();
    };
  }, [ref, active, slot, pathname]);
}
