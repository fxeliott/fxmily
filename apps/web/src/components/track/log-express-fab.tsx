'use client';

import { ArrowRight, Plus } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { HABIT_KIND_ENTRIES } from './habit-kinds';

/**
 * V2.1.4 TRACK — global "Log express" FAB + bottom-sheet.
 *
 * A calm floating affordance: from any authenticated screen, two taps to
 * log one of the 5 pillars (→ the existing `/track/<kind>/new` wizard).
 *
 * Auth model (divergence from the original blueprint — simpler, smaller
 * blast radius): NO `useSession` / `SessionProvider`. `proxy.ts` (Next 16
 * middleware) already redirects unauthenticated users away from every
 * non-public route, so "rendered on a non-public route" ⇒ "authenticated"
 * by construction. The FAB is therefore purely `usePathname`-driven —
 * hidden on public routes + on the wizard routes themselves (anti-
 * recursion / anti-clutter). This avoids adding a client SessionProvider
 * to the root layout for zero functional gain.
 *
 * On `not-found.tsx` / `error.tsx` the FAB DOES render — that is an
 * accepted decision (code-review V2.1.4 T2-2): those pages render inside
 * the root layout and are only reachable by authenticated users (proxy
 * redirects unauth page requests to /login before they render), so a
 * quick-log affordance there is harmless. `global-error.tsx` renders its
 * own `<html>` (not this layout) → the FAB is correctly absent there.
 *
 * Modal a11y is delegated to the existing Radix-Dialog-based `<Sheet>`
 * primitive (focus-trap, Escape, aria-modal, focus-return-to-trigger,
 * scroll-lock, aria-hidden background) — the same primitive shipped by
 * `<AnnotateTradeButton>` (J4, a11y-audited in prod). Not reinvented.
 * Focus returns to the FAB on close because Radix restores focus to
 * `document.activeElement`-at-open (the FAB the user activated), even
 * though it is a plain button and not a `SheetTrigger`.
 *
 * Anti-Black-Hat (Mark Douglas / Yu-kai Chou), enforced here:
 *   - NO badge / count / streak / "non loggé aujourd'hui" pressure
 *   - NO pulsing / idle / entrance animation (the FAB never demands
 *     attention); the only motion is an `active:` press response to a
 *     deliberate user touch — Douglas-compliant, not an attention-grab
 *   - dismiss is exactly as easy as logging (overlay tap, Escape,
 *     explicit close button), no confirmshaming, no interstitial
 *   - all 5 kinds always enabled, no completed/pending distinction
 *     (that belongs to `<TodayHabitCards>` on /track)
 */

/** Routes (prefix-matched) where the FAB must NOT render. */
const HIDDEN_PREFIXES: readonly string[] = [
  // Public / unauthenticated surface. Mirrors the page routes in
  // auth.config.ts's public whitelist (non-page entries like /api/auth,
  // /_next, /favicon are correctly omitted). `/forgot-password` and
  // `/reset-password` are forward-compat placeholders (J1.5 magic-link
  // deferred — no live route yet) kept in sync defensively.
  '/login',
  '/onboarding',
  '/forgot-password',
  '/reset-password',
  '/legal',
  // Wizard destinations — FAB there would be recursive / cluttered.
  // Kept in sync with HABIT_KIND_ENTRIES hrefs (asserted by a test).
  '/track/sleep/new',
  '/track/nutrition/new',
  '/track/caffeine/new',
  '/track/sport/new',
  '/track/meditation/new',
  '/checkin/morning',
  '/checkin/evening',
  '/journal/new',
  '/review/new',
  '/reflect/new',
];

/**
 * Pure suppression predicate (unit-tested — this is the critical
 * anti-recursion / public-hide invariant). Hidden when: root splash,
 * a `/journal/<id>/close` wizard, or under any `HIDDEN_PREFIXES` entry
 * (exact or as a path segment, never a substring like `/login` vs
 * `/loginx`).
 */
export function isLogExpressHidden(pathname: string): boolean {
  if (pathname === '/') return true;
  if (/^\/journal\/[^/]+\/close$/.test(pathname)) return true;
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function LogExpressFab(): React.JSX.Element | null {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (isLogExpressHidden(pathname)) return null;

  // Order matters: close the sheet BEFORE navigating so Radix releases
  // the focus-trap + scroll-lock + background aria-hidden before the
  // route changes (reordering this re-introduces the documented Radix
  // "aria-hidden / scroll-lock retained after navigation" class of bug).
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Logger un pilier"
        aria-haspopup="dialog"
        className="fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 grid h-14 w-14 place-items-center rounded-full bg-[var(--acc)] text-[var(--acc-fg)] shadow-[var(--sh-toast)] transition-[color,box-shadow,transform] hover:bg-[var(--acc-hi)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] active:scale-95"
      >
        <Plus className="h-6 w-6" strokeWidth={2} aria-hidden />
      </button>

      <SheetContent
        side="bottom"
        showCloseButton
        className="rounded-t-card max-h-[60dvh] overflow-y-auto border-x-0 border-t border-b-0 border-[var(--b-default)] bg-[var(--bg-1)] pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="t-h2 text-[var(--t-1)]">Logger un pilier</SheetTitle>
          <SheetDescription className="t-body text-[var(--t-3)]">
            Choisis le pilier à enregistrer. Aucun jugement, juste le miroir de ta pratique.
          </SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col gap-2 px-4 pb-2">
          {HABIT_KIND_ENTRIES.map((e) => (
            <li key={e.kind}>
              <button
                type="button"
                onClick={() => go(e.href)}
                className="rounded-input flex min-h-11 w-full items-center gap-3 border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-3 text-left text-[14px] text-[var(--t-1)] transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              >
                <e.Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className="flex-1 font-medium">{e.label}</span>
                <ArrowRight className="h-4 w-4 text-[var(--t-3)]" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
