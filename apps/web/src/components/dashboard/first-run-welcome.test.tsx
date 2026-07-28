// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FirstRunWelcome } from './first-run-welcome';

import type { CheckinCtaResult } from '@/lib/checkin/checkin-cta';

/**
 * J8 scope 4 — guard the CALL SITE, not just the helper.
 *
 * WHY THIS FILE EXISTS.
 * `src/lib/checkin/checkin-cta.test.ts` pins the HELPER: given an instant and a
 * timezone, `checkinCta` returns the right slot. It never renders anything. So
 * the regression that actually shipped — `href="/checkin/morning"` hardcoded in
 * this component, sending an evening member into the morning wizard — would
 * come back with the whole suite GREEN: re-hardcode line ~168 and every
 * timezone case still passes, because none of them look at the DOM.
 *
 * That is the same hole `tests/e2e/guide-catalog-render.spec.ts` closes for
 * /guide ("guard what the PAGE renders, not what the catalog holds"). This file
 * applies that standard here.
 *
 * WHY RTL AND NOT AN E2E.
 * `<FirstRunWelcome>` is a server component but a SYNCHRONOUS, dependency-free
 * one: it imports only `next/link`, `lucide-react`, `Card`, `btnVariants`, `cn`
 * and a TYPE (erased at compile time). No `auth()`, no Prisma, no `server-only`
 * marker anywhere in its graph — so it mounts under RTL exactly as React
 * renders it on the server. An e2e would need a seeded brand-new member (0
 * trades, 0 streak) just to reach the first-run branch: far more machinery for
 * strictly less assertion power over this component.
 */

const MORNING: CheckinCtaResult = {
  slot: 'morning',
  href: '/checkin/morning',
  label: 'Faire mon check-in du matin',
};

const EVENING: CheckinCtaResult = {
  slot: 'evening',
  href: '/checkin/evening',
  label: 'Faire mon check-in du soir',
};

afterEach(() => cleanup());

describe('FirstRunWelcome — the check-in CTA follows the slot it is given', () => {
  it('evening slot => the CTA points at the EVENING wizard', () => {
    render(<FirstRunWelcome cta={EVENING} />);

    const link = screen.getByRole('link', { name: /Commencer mon check-in du soir/ });
    expect(link).toHaveAttribute('href', '/checkin/evening');
  });

  it('morning slot => the CTA points at the MORNING wizard', () => {
    render(<FirstRunWelcome cta={MORNING} />);

    const link = screen.getByRole('link', { name: /Commencer mon check-in du matin/ });
    expect(link).toHaveAttribute('href', '/checkin/morning');
  });

  /**
   * THE anti-regression assertion. A hardcoded `/checkin/morning` would leave
   * both tests above green (the morning one trivially, the evening one because
   * its accessible name is derived from `cta.slot`, which stays correct) — the
   * only thing that betrays it is a morning href surviving on an evening
   * render. This is the case that rots silently in production.
   */
  it('evening slot => NO link to the morning wizard survives anywhere in the render', () => {
    const { container } = render(<FirstRunWelcome cta={EVENING} />);

    expect(container.querySelector('a[href="/checkin/morning"]')).toBeNull();
  });

  it('morning slot => symmetrically, no evening link leaks in', () => {
    const { container } = render(<FirstRunWelcome cta={MORNING} />);

    expect(container.querySelector('a[href="/checkin/evening"]')).toBeNull();
  });

  /**
   * The icon carries the same meaning as the href (Sunrise/Sunset is the
   * convention set by `app/guide/page.tsx`). It is `aria-hidden`, so it has no
   * accessible name to query — lucide's own `lucide-*` class is the stable
   * handle. A ternary flipped the wrong way is invisible to every assertion
   * above, yet it is exactly what a member sees.
   */
  it('the icon tracks the slot (Sunset in the evening, Sunrise in the morning)', () => {
    const evening = render(<FirstRunWelcome cta={EVENING} />);
    const eveningCta = evening.container.querySelector('a[href="/checkin/evening"]');
    expect(eveningCta?.querySelector('.lucide-sunset')).not.toBeNull();
    expect(eveningCta?.querySelector('.lucide-sunrise')).toBeNull();

    cleanup();

    const morning = render(<FirstRunWelcome cta={MORNING} />);
    const morningCta = morning.container.querySelector('a[href="/checkin/morning"]');
    expect(morningCta?.querySelector('.lucide-sunrise')).not.toBeNull();
    expect(morningCta?.querySelector('.lucide-sunset')).toBeNull();
  });

  /**
   * §31.2 — an off day owes nothing, so the check-in steps back to secondary.
   * That must not change WHERE it points: the slot logic and the emphasis logic
   * are independent, and conflating them is how "the CTA is secondary today"
   * quietly becomes "the CTA is wrong today".
   */
  it('an off day changes the emphasis, never the destination', () => {
    const { container } = render(<FirstRunWelcome cta={EVENING} todayIsOff />);

    const link = screen.getByRole('link', { name: /Commencer mon check-in du soir/ });
    expect(link).toHaveAttribute('href', '/checkin/evening');
    expect(container.querySelector('a[href="/checkin/morning"]')).toBeNull();
  });
});
