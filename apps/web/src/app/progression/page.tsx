import { LineChart as LineChartIcon } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DrawdownStreaksCard, ExpectancyCard } from '@/components/scoring/expectancy-card';
import { RDistribution } from '@/components/scoring/r-distribution';
import { ScoreGaugeGrid } from '@/components/scoring/score-gauge-grid';
import { ScoreTrendChart } from '@/components/scoring/score-trend-chart';
import { TrackRecordChart } from '@/components/scoring/track-record-chart';
import { getDashboardAnalytics, type RangeKey } from '@/lib/scoring/dashboard-data';
import { getBehavioralScoreHistory, getLatestBehavioralScore } from '@/lib/scoring/service';

/**
 * « Où j'en suis » — V2 refonte J2 (intention de guidage #1).
 *
 * Reçoit les surfaces analytiques RÉTROSPECTIVES migrées hors du dashboard
 * (qui redevient un hub d'action) : les 4 scores comportementaux du jour, leur
 * trajectoire dans le temps, et le track record (R cumulé + expectancy + DD +
 * distribution R). Posture §2 : aucune donnée n'est un conseil de marché ; les
 * scores ne sont jamais rouges-punitifs (cf. composants). « Où je vais »
 * (projection, objectifs) arrive en J4/J5.
 */
export const metadata = {
  title: 'Où j’en suis · Fxmily',
};
export const dynamic = 'force-dynamic';

const VALID_RANGES = new Set<RangeKey>(['7d', '30d', '3m', '6m', 'all']);

function parseRange(input: string | undefined): RangeKey {
  return input && VALID_RANGES.has(input as RangeKey) ? (input as RangeKey) : '30d';
}

interface ProgressionPageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function ProgressionPage({ searchParams }: ProgressionPageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = session.user.id;
  if (!userId) redirect('/login');
  const timezone = session.user.timezone || 'Europe/Paris';
  const sp = await searchParams;
  const range = parseRange(sp?.range);

  // Scores du jour + trajectoire lus au top (légers) ; le track record (analytics
  // lourdes) stream via Suspense pour garder le shell rapide (pas de N+1 : 1 fetch
  // analytics dans TrackRecordSection).
  const [latestScore, scoreHistory] = await Promise.all([
    getLatestBehavioralScore(userId),
    getBehavioralScoreHistory(userId, { sinceDays: 90 }),
  ]);

  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto w-full max-w-[var(--w-app)] flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 2xl:px-12">
        <header className="mb-6 flex flex-col gap-2">
          <span className="t-eyebrow text-[var(--t-3)]">Ma progression</span>
          <h1
            className="f-display h-rise leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)]"
            style={{
              fontFeatureSettings: '"ss01" 1',
              fontSize: 'clamp(1.75rem, 1.45rem + 1.3vw, 2.25rem)',
            }}
          >
            Où j’en suis
          </h1>
          <p className="t-lead max-w-[62ch]">
            Tes scores comportementaux, leur trajectoire et ton track record — la photo de ta
            discipline dans le temps. Tu observes, tu ne te fais pas punir.
          </p>
        </header>

        {/* Scores comportementaux du jour (4 jauges) */}
        <section className="mb-6" aria-labelledby="scores-heading">
          <h2 id="scores-heading" className="sr-only">
            Scores comportementaux
          </h2>
          <ScoreGaugeGrid score={latestScore} />
        </section>

        {/* Trajectoire des scores dans le temps */}
        <section className="mb-6" aria-labelledby="score-trend-heading">
          <h2 id="score-trend-heading" className="sr-only">
            Évolution de tes scores comportementaux
          </h2>
          <ScoreTrendChart data={scoreHistory} />
        </section>

        {/* Track record — R cumulé + expectancy + drawdown + distribution R */}
        <section className="mb-6 flex flex-col gap-3" aria-labelledby="track-record-heading">
          <div className="flex items-center gap-2">
            <LineChartIcon
              className="h-3.5 w-3.5 text-[var(--t-3)]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <h2 id="track-record-heading" className="t-eyebrow">
              Track record
            </h2>
          </div>
          <Suspense fallback={<TrackRecordSkeleton />}>
            <TrackRecordSection userId={userId} timezone={timezone} range={range} />
          </Suspense>
        </section>
      </div>
    </main>
  );
}

async function TrackRecordSection({
  userId,
  timezone,
  range,
}: {
  userId: string;
  timezone: string;
  range: RangeKey;
}) {
  const analytics = await getDashboardAnalytics(userId, timezone, range);
  return (
    <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
      <TrackRecordChart
        data={analytics.equity.points}
        estimatedExcluded={analytics.equity.estimatedExcluded}
        range={range}
      />
      <div className="flex flex-col gap-3">
        <ExpectancyCard expectancy={analytics.expectancy} />
        <DrawdownStreaksCard
          drawdown={analytics.drawdown}
          observedMaxLoss={analytics.streaks.observedMaxLoss}
          observedMaxWin={analytics.streaks.observedMaxWin}
        />
      </div>
      <div className="lg:col-span-2">
        <RDistribution buckets={analytics.rDistribution} />
      </div>
    </div>
  );
}

function TrackRecordSkeleton() {
  return (
    <div
      className="flex flex-col gap-3"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement du track record"
    >
      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="skel rounded-card-lg h-[316px] border border-[var(--b-default)] bg-[var(--bg-1)]" />
        <div className="flex flex-col gap-3">
          <div className="skel rounded-card-lg h-[150px] border border-[var(--b-default)] bg-[var(--bg-1)]" />
          <div className="skel rounded-card-lg h-[150px] border border-[var(--b-default)] bg-[var(--bg-1)]" />
        </div>
        <div className="skel rounded-card-lg h-[252px] border border-[var(--b-default)] bg-[var(--bg-1)] lg:col-span-2" />
      </div>
    </div>
  );
}
