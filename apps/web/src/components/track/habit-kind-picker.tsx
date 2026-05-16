import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

import { HABIT_KIND_ENTRIES } from './habit-kinds';

/**
 * V2.1 TRACK — 5-pillar picker grid surface.
 *
 * Server Component (zero client JS) — pure Link to per-kind wizard routes.
 * As of V2.1.1 all five kinds are shippable (sleep / nutrition / caffeine /
 * sport / meditation), so every chip links to its 2-step wizard.
 *
 * Mobile-first : `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (touch-target
 * sized chips ≥ 44×44 WCAG 2.5.5 AAA + `min-h-11`).
 *
 * Distinct from `<TodayHabitCards>` :
 *   - `<TodayHabitCards>` = STATUS aujourd'hui (logué / pending) per kind
 *   - `<HabitKindPicker>` = NAVIGATION vers le wizard sans dépendance à
 *     l'état "logué aujourd'hui" (les cartes du picker linkent même si
 *     déjà logué — re-log permis, upsert idempotent en service layer)
 */

export function HabitKindPicker() {
  return (
    <section aria-labelledby="track-picker-heading" className="space-y-3">
      <header className="flex items-baseline justify-between gap-4">
        <h2 id="track-picker-heading" className="t-eyebrow-lg text-[var(--t-3)]">
          Logger un pilier
        </h2>
      </header>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {HABIT_KIND_ENTRIES.map((e) => (
          <li key={e.kind}>
            <Link
              href={e.href}
              className="rounded-input block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              aria-label={`Logger ${e.label.toLowerCase()}`}
            >
              <span
                className={cn(
                  'rounded-input flex min-h-11 items-center gap-3 border px-3 py-3 text-[14px] transition-colors',
                  'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-1)] hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)]',
                )}
              >
                <e.Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className="flex-1 font-medium">{e.label}</span>
                <ArrowRight className="h-4 w-4 text-[var(--t-3)]" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
