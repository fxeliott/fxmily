import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { CheckinDayList } from '@/components/checkin/checkin-day-list';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DisciplineYearHeatmap } from '@/components/track/discipline-year-heatmap';
import { Card } from '@/components/ui/card';
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
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
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
            emptyState={
              <Card className="flex flex-col items-center gap-3 p-6 text-center">
                <p className="t-body text-[var(--t-3)]">
                  Tu n&apos;as encore rempli aucun check-in.
                </p>
                <p className="t-cap text-[var(--t-4)]">
                  Ton historique matin / soir apparaîtra ici dès ton premier check-in.
                </p>
                <Link
                  href="/checkin"
                  className="rounded-control mt-1 inline-flex items-center gap-1.5 border border-[var(--b-acc)] bg-[var(--acc-dim)] px-3 py-1.5 text-[13px] font-medium text-[var(--acc-hi)] transition-colors hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
                >
                  Faire mon check-in
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </Link>
              </Card>
            }
          />
        </section>
      </div>
    </main>
  );
}
