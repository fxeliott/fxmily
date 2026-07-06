import { ArrowLeft, ArrowRight, CalendarCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { CheckinDayList } from '@/components/checkin/checkin-day-list';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DisciplineYearHeatmap } from '@/components/track/discipline-year-heatmap';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { getOffDaySet, isOffDay } from '@/lib/checkin/off-days';
import { getDisciplineYearHeatmap, listMemberCheckins } from '@/lib/checkin/service';

/**
 * F7 — « Mon historique » : la page membre qui regroupe TOUS ses check-in/out
 * (tracking). Miroir calme de la constance : la heatmap année en tête pour la
 * vue d'ensemble, puis le détail jour par jour (matin/soir), rattrapages
 * inclus. Read-only — les gestes (remplir, rattraper) se font depuis le hub.
 *
 * Posture §2 (aucun contenu de marché) + anti-Black-Hat §31.2 (un jour vide est
 * une absence muette, jamais un échec rouge).
 */
export const metadata = {
  title: 'Mon historique de check-ins',
};

// Reads cookies (auth) + DB — dynamic so each member sees their own fresh state.
export const dynamic = 'force-dynamic';

export default async function CheckinHistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const userId = session.user.id;
  const timezone = session.user.timezone || 'Europe/Paris';

  const [checkins, yearHeatmap] = await Promise.all([
    listMemberCheckins(userId),
    getDisciplineYearHeatmap(userId, timezone),
  ]);

  // Tour 14 — mark the OFF days among the listed days so an unfilled slot on an
  // off day reads « Jour off » (a chosen rest), never « Non rempli. » (§31.2).
  // The check-ins are date-desc, so the window spans from the OLDEST listed day
  // to the newest; one indexed range query resolves the member's off context,
  // then the pure predicate flags each distinct listed date. Empty when the
  // member has no check-in yet (the list renders its empty state anyway).
  const listedDates = [...new Set(checkins.map((c) => c.date))].sort();
  const offDates = new Set<string>();
  if (listedDates.length > 0) {
    const offCtx = await getOffDaySet(userId, listedDates[0]!, listedDates.at(-1)!);
    for (const d of listedDates) {
      if (isOffDay(d, offCtx)) offDates.add(d);
    }
  }

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 lg:py-10">
        <header className="flex flex-col gap-3">
          <Link
            href="/checkin"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Retour au check-in
          </Link>

          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow">Ton suivi</span>
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Mon historique
            </h1>
            <p className="t-lead">
              Tous tes check-ins matin et soir, réunis. La régularité d&apos;abord, puis le détail
              de chaque jour. Tu observes ta constance, tu ne te fais pas punir.
            </p>
          </div>
        </header>

        {/* Régularité année — heatmap calendaire (GitHub-style, non-punitive
            §31.2), miroir calme de la constance, comme sur « Où j'en suis ». */}
        <section className="wow-reveal" aria-labelledby="history-heatmap-heading">
          <h2 id="history-heatmap-heading" className="sr-only">
            Régularité de tes check-ins sur 12 mois
          </h2>
          <Card primary className="p-5">
            <DisciplineYearHeatmap heatmap={yearHeatmap} />
          </Card>
        </section>

        {/* Détail jour par jour — même rendu que le panel admin (source unique),
            rattrapages compris. Empty-state gracieux tant qu'aucun check-in. */}
        <section aria-labelledby="history-days-heading">
          <h2 id="history-days-heading" className="sr-only">
            Détail de tes check-ins jour par jour
          </h2>
          <CheckinDayList
            checkins={checkins}
            offDates={offDates}
            emptyState={
              <Card className="py-2">
                <EmptyState
                  icon={CalendarCheck}
                  headingLevel="h3"
                  headline="Ton suivi commence à ton premier check-in"
                  lead="Rien encore rempli, c'est normal : ton historique matin et soir se posera ici dès aujourd'hui."
                  guides={[
                    'Ouvre le check-in du matin avant le marché.',
                    'Referme ta journée par le bilan du soir.',
                    'Chaque jour rempli apparaît ici, matin et soir réunis.',
                  ]}
                  ctaPrimary={
                    <>
                      Faire mon check-in
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                    </>
                  }
                  ctaHref="/checkin"
                />
              </Card>
            }
          />
        </section>
      </div>
    </main>
  );
}
