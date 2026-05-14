import { ArrowRight, BrainCircuit, NotebookPen } from 'lucide-react';
import Link from 'next/link';

import { listMyRecentReviews } from '@/lib/weekly-review/service';
import { listRecentReflections } from '@/lib/reflection/service';

interface DashboardReflectWidgetProps {
  userId: string;
}

/**
 * V1.8 REFLECT — dashboard entry-point widget.
 *
 * Server Component. Reads recent counts for both wizards so the cards
 * surface "Tu as déjà N réflexions" social proof (anti-empty-state).
 *
 * Visual identity : lime/DS-v2 (matches the dashboard host), NOT the
 * `.v18-theme` blue overlay. The blue identity kicks in once the member
 * arrives at `/review` or `/reflect` — this widget is the "doorway"
 * inside the lime house. Tiny blue dot accent on each icon hints at
 * the destination zone.
 */
export async function DashboardReflectWidget({ userId }: DashboardReflectWidgetProps) {
  const [recentReviews, recentReflections] = await Promise.all([
    listMyRecentReviews(userId, 1),
    listRecentReflections(userId, 30),
  ]);
  const reviewCount = recentReviews.length; // 0 or 1 (we only check existence)
  const reflectionCount = recentReflections.length;
  const lastReviewDate = recentReviews[0]?.weekStart ?? null;

  return (
    <div data-slot="dashboard-reflect-widget">
      <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{
            background: 'oklch(0.62 0.19 254)',
            boxShadow: '0 0 8px oklch(0.62 0.19 254 / 0.5)',
          }}
        />
        <span className="t-eyebrow">Module REFLECT</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/review"
          className="rounded-card-lg group relative flex flex-col gap-2 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] p-4 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-[var(--b-acc)] hover:shadow-[var(--sh-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          aria-label={`Revue hebdomadaire — ${reviewCount > 0 ? `dernière soumise le ${lastReviewDate}` : 'aucune pour l’instant'}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div
              aria-hidden="true"
              className="rounded-pill flex h-9 w-9 items-center justify-center"
              style={{
                background: 'oklch(0.62 0.19 254 / 0.16)',
                color: 'oklch(0.82 0.115 247)',
              }}
            >
              <NotebookPen size={16} strokeWidth={2.2} />
            </div>
            <ArrowRight
              aria-hidden="true"
              size={14}
              strokeWidth={2.2}
              className="text-[var(--t-3)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--t-2)]"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="t-h2 text-[var(--t-1)]">Revue hebdomadaire</p>
            <p className="t-cap mt-1 text-[var(--t-3)]">
              5 questions process · ~5 min · le miroir de ton exécution
            </p>
            {reviewCount > 0 ? (
              <p className="t-cap mt-2 font-mono tabular-nums text-[var(--t-2)]">
                Dernière soumise : {lastReviewDate}
              </p>
            ) : (
              <p className="t-cap mt-2 text-[var(--t-3)]">Aucune revue pour l’instant</p>
            )}
          </div>
        </Link>

        <Link
          href="/reflect"
          className="rounded-card-lg group relative flex flex-col gap-2 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] p-4 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-[var(--b-acc)] hover:shadow-[var(--sh-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          aria-label={`Réflexion ABCD — ${reflectionCount} réflexion${reflectionCount > 1 ? 's' : ''} ces 30 derniers jours`}
        >
          <div className="flex items-start justify-between gap-2">
            <div
              aria-hidden="true"
              className="rounded-pill flex h-9 w-9 items-center justify-center"
              style={{
                background: 'oklch(0.62 0.19 254 / 0.16)',
                color: 'oklch(0.82 0.115 247)',
              }}
            >
              <BrainCircuit size={16} strokeWidth={2.2} />
            </div>
            <ArrowRight
              aria-hidden="true"
              size={14}
              strokeWidth={2.2}
              className="text-[var(--t-3)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--t-2)]"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="t-h2 text-[var(--t-1)]">Réflexion ABCD</p>
            <p className="t-cap mt-1 text-[var(--t-3)]">
              Quand la pensée vient en éclair · structure CBT en 4 étapes
            </p>
            <p className="t-cap mt-2 font-mono tabular-nums text-[var(--t-2)]">
              {reflectionCount} sur 30 derniers jours
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
