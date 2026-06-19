import { ArrowLeft, CalendarRange } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MonthlyDebriefReader } from '@/components/monthly-debrief/monthly-debrief-reader';
import { MonthlyDebriefTimeline } from '@/components/monthly-debrief/monthly-debrief-timeline';
import { formatMonthLabelFr } from '@/lib/monthly-debrief/format';
import {
  getMonthlyDebriefById,
  listMyRecentMonthlyDebriefs,
  markMonthlyDebriefSeen,
} from '@/lib/monthly-debrief/service';
import { reportWarning } from '@/lib/observability';
import type { SerializedMonthlyDebrief } from '@/lib/monthly-debrief/types';

export const metadata = {
  title: 'Débrief mensuel',
};

export const dynamic = 'force-dynamic';

interface MonthlyDebriefPageProps {
  searchParams: Promise<{ id?: string }>;
}

/**
 * V1.4 — `/debrief-mensuel` landing + lecture (SPEC §25.4).
 *
 * Server Component. **No wizard** — the monthly debrief is an AI synthesis,
 * the member only reads it. DS-v2 standard chrome; the dual-section body
 * (incl. the cyan §21.7 entraînement frame + the EU AI Act 50(1) banner) is
 * rendered by the shared `<MonthlyDebriefReader>` (same component the admin
 * read-only panel uses — single audit surface, never `.v18-theme`).
 *
 * Auth gate carbone (status active). Calm Mark Douglas reveal — no
 * XP/streak/fanfare (anti Black-Hat, SPEC §25.2). `?id=` picks which month
 * to read; default = the most recent.
 */
export default async function MonthlyDebriefPage({ searchParams }: MonthlyDebriefPageProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');
  const userId = session.user.id;

  const sp = await searchParams;
  const recent = await listMyRecentMonthlyDebriefs(userId, 12);

  let selected: SerializedMonthlyDebrief | null = null;
  if (sp.id) {
    selected = recent.find((d) => d.id === sp.id) ?? (await getMonthlyDebriefById(userId, sp.id));
  }
  selected ??= recent[0] ?? null;

  // S6 audit — stamp the first view so the dashboard "débrief prêt" nudge goes
  // quiet once the member has read it (anti-Black-Hat §25.2). Best-effort: a
  // transient DB hiccup must never 500 the member's debrief page; the nudge
  // simply re-shows next time. Idempotent (stamps only when seenAt is null).
  if (selected && selected.seenAt === null) {
    try {
      await markMonthlyDebriefSeen(userId, selected.id);
    } catch {
      // Non-fatal — the seen stamp is a convenience, not load-bearing (the page
      // still renders; the nudge simply re-shows next visit). But align with the
      // documented mirror (`markAdaptiveCalendarDisclosureShown`, calendrier/
      // page.tsx) and emit a Sentry warning so a CHRONIC write failure (e.g. a
      // `seen_at` column not migrated on some env, a constraint/deadlock) is
      // visible to ops instead of silently re-flashing the dashboard nudge
      // forever. PII-free (userId is a structured audit column, never free-text).
      reportWarning('monthly-debrief.seen', 'stamp_failed', { userId });
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Tableau de bord
        </Link>

        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
            Débrief mensuel
          </span>
          <h1
            className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Mon débrief mensuel
          </h1>
        </div>

        <p className="t-body leading-[1.6] text-[var(--t-2)]">
          Une synthèse de ton mois écoulé — progression, trading réel et pratique
          d&apos;entraînement — pour prendre du recul. Aucune analyse de marché, aucun conseil de
          trade : seulement ton comportement et ton exécution.
        </p>
      </header>

      {selected ? (
        <article className="flex flex-col gap-5">
          <h2 className="t-h2 text-[var(--t-1)]">{formatMonthLabelFr(selected.monthStart)}</h2>
          <MonthlyDebriefReader debrief={selected} />
        </article>
      ) : (
        <div
          className="rounded-card-lg border border-dashed border-[var(--b-strong)] p-6 text-center"
          data-empty="true"
        >
          <p className="t-body text-[var(--t-2)]">
            Ton premier débrief mensuel arrivera au début du mois prochain. Il fait le point sur ta
            progression — ce n&apos;est pas un score, c&apos;est un recul.
          </p>
        </div>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="t-h2 text-[var(--t-1)]">Tes débriefs</h2>
          <p className="t-cap text-[var(--t-3)]">{recent.length} / 12</p>
        </div>
        <MonthlyDebriefTimeline debriefs={recent} selectedId={selected?.id} />
      </section>
    </main>
  );
}
