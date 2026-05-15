import {
  ArrowRight,
  Brain,
  Coffee,
  Dumbbell,
  Moon,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * V2.1 TRACK — 5-pillar picker grid surface.
 *
 * Server Component (zero client JS) — pure Link to per-kind wizard routes.
 * V2.1.0 ships only `sleep` as clickable ; the 4 other kinds are visible
 * but disabled (`aria-disabled`) with a "Bientôt" pill to signal they're
 * scaffolded in V2.1.1+.
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

interface PickerEntry {
  kind: 'sleep' | 'nutrition' | 'caffeine' | 'sport' | 'meditation';
  label: string;
  Icon: LucideIcon;
  shippable: boolean;
  href: string;
}

const ENTRIES: PickerEntry[] = [
  { kind: 'sleep', label: 'Sommeil', Icon: Moon, shippable: true, href: '/track/sleep/new' },
  {
    kind: 'nutrition',
    label: 'Nutrition',
    Icon: UtensilsCrossed,
    shippable: false,
    href: '/track/nutrition/new',
  },
  { kind: 'caffeine', label: 'Café', Icon: Coffee, shippable: false, href: '/track/caffeine/new' },
  { kind: 'sport', label: 'Sport', Icon: Dumbbell, shippable: false, href: '/track/sport/new' },
  {
    kind: 'meditation',
    label: 'Méditation',
    Icon: Brain,
    shippable: false,
    href: '/track/meditation/new',
  },
];

export function HabitKindPicker() {
  return (
    <section aria-labelledby="track-picker-heading" className="space-y-3">
      <header className="flex items-baseline justify-between gap-4">
        <h2
          id="track-picker-heading"
          className="text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase"
        >
          Logger un pilier
        </h2>
      </header>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ENTRIES.map((e) => {
          const content = (
            <span
              className={cn(
                'rounded-input flex min-h-11 items-center gap-2.5 border px-3 py-2.5 text-[14px] transition-colors',
                e.shippable
                  ? 'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-1)] hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)] focus-visible:border-[var(--b-acc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]'
                  : 'cursor-not-allowed border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]',
              )}
            >
              <e.Icon className="h-5 w-5 shrink-0" aria-hidden />
              <span className="flex-1 font-medium">{e.label}</span>
              {e.shippable ? (
                <ArrowRight className="h-4 w-4 text-[var(--t-3)]" aria-hidden />
              ) : (
                <span className="rounded-pill border border-[var(--b-default)] px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] text-[var(--t-3)] uppercase">
                  Bientôt
                </span>
              )}
            </span>
          );
          return (
            <li key={e.kind}>
              {e.shippable ? (
                <Link
                  href={e.href}
                  className="block outline-none"
                  aria-label={`Logger ${e.label.toLowerCase()}`}
                >
                  {content}
                </Link>
              ) : (
                <div
                  role="link"
                  aria-disabled="true"
                  aria-label={`${e.label} — disponible dans une prochaine version`}
                >
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
