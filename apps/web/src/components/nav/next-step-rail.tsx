import { ArrowRight, Check, MapPin } from 'lucide-react';
import Link from 'next/link';

import { auth } from '@/auth';
import { HoverLift } from '@/components/ui/hover-lift';
import { deriveNextStep } from '@/lib/daily-guidance/next-step';
import { getDailyGuidance } from '@/lib/daily-guidance/service';
import { DAY_SLOT_LABELS } from '@/lib/daily-guidance/slot';
import { cn } from '@/lib/utils';

/**
 * Cross-page wayfinding rail — the member is NEVER lost (§32-2 extended
 * beyond the dashboard; PROMPT-MAITRE §15 "l'utilisateur ne se perd jamais").
 *
 * Mounted at the top of the member CONSULTATION pages (journal, training,
 * séances, patterns…) — never on the dashboard (its full "Ton aujourd'hui"
 * panel already owns the day, and the same CTA must never appear twice) and
 * never on input wizards (check-in, pre-trade…), where it would distract.
 *
 * Pure Server Component: one `getDailyGuidance` read (React `cache()` dedupes
 * it with any page-level call in the same render); the wayfinding decision
 * itself lives in `deriveNextStep` (unit-tested). Three calm states:
 *   - the current action lives elsewhere → "Maintenant : …" linking to it;
 *   - the member is already on the current action's page → quiet "Tu es au
 *     bon endroit" ack + "Ensuite : …" linking to the next pending action;
 *   - nothing pending → "Journée complète" ack linking back to /dashboard.
 *
 * Posture §2 + anti-Black-Hat §31.2 (BLOQUANT): pure wayfinding — NO streak,
 * NO counter, NO countdown, NO red. Renders nothing for admins, signed-out
 * visitors, or when guidance fails (wayfinding must never take a page down).
 */

interface NextStepRailProps {
  /** Pathname of the hosting page (e.g. `/journal`) — decides "you are here". */
  currentPath: string;
  /** Spacing hook for hosts whose container has no flex `gap` (e.g. `mb-6`). */
  className?: string;
}

export async function NextStepRail({ currentPath, className }: NextStepRailProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === 'admin') return null;

  let guidance;
  try {
    guidance = await getDailyGuidance(session.user.id, session.user.timezone || 'Europe/Paris');
  } catch {
    // Wayfinding is a garnish: a transient DB hiccup must never 500 the page.
    return null;
  }

  const step = deriveNextStep(guidance.actions, currentPath);
  const slotLabel = DAY_SLOT_LABELS[guidance.slot];

  return (
    <nav
      aria-label="Prochaine étape du jour"
      data-slot="next-step-rail"
      data-state={step.kind}
      className={className}
    >
      {step.target ? (
        <HoverLift className="block">
          <Link
            href={step.target.href}
            className={cn(
              'rounded-control flex min-h-11 items-center gap-3 border px-3.5 py-2.5',
              'border-[var(--b-acc)] bg-[var(--acc-dim)] transition-colors',
              'hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
            )}
          >
            <span
              aria-hidden="true"
              className="rounded-pill grid h-7 w-7 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]"
            >
              <MapPin size={14} strokeWidth={2.2} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              {step.onCurrentSurface ? (
                <span className="t-cap mr-2 text-[var(--t-2)]">Tu es au bon endroit.</span>
              ) : null}
              <span className="t-cap font-semibold text-[var(--acc)]">
                {step.kind === 'here-next' ? 'Ensuite' : 'Maintenant'}
              </span>
              <span className="sr-only"> : </span>
              <span className="t-body ml-2 font-medium text-[var(--t-1)]">{step.target.title}</span>
            </span>
            <span className="t-cap hidden shrink-0 text-[var(--t-3)] sm:inline">
              <span className="sr-only">, </span>
              {slotLabel}
            </span>
            <ArrowRight
              aria-hidden="true"
              size={16}
              strokeWidth={2.2}
              className="shrink-0 text-[var(--acc)]"
            />
          </Link>
        </HoverLift>
      ) : (
        <Link
          href="/dashboard"
          className={cn(
            'rounded-control flex min-h-11 items-center gap-3 border px-3.5 py-2.5',
            'border-[var(--b-default)] bg-[var(--bg-1)] transition-colors',
            'hover:border-[var(--b-acc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
          )}
        >
          <span
            aria-hidden="true"
            className="rounded-pill grid h-7 w-7 shrink-0 place-items-center border border-[var(--b-default)] text-[var(--t-3)]"
          >
            <Check size={14} strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {step.onCurrentSurface ? (
              <span className="t-cap mr-2 text-[var(--t-2)]">Tu es au bon endroit.</span>
            ) : null}
            <span className="t-body font-medium text-[var(--t-1)]">
              {step.kind === 'all-done'
                ? 'Journée complète : rien d’autre à faire pour le moment.'
                : 'Rien d’autre à faire pour le moment.'}
            </span>
          </span>
          <span className="t-cap hidden shrink-0 text-[var(--t-3)] sm:inline">
            <span className="sr-only">, </span>
            Ton tableau de bord
          </span>
          <ArrowRight
            aria-hidden="true"
            size={16}
            strokeWidth={2.2}
            className="shrink-0 text-[var(--t-3)]"
          />
        </Link>
      )}
    </nav>
  );
}
