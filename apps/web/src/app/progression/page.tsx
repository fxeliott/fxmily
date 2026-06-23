import {
  ArrowRight,
  ArrowUpRight,
  LineChart as LineChartIcon,
  Minus,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { MethodMirrorCard } from '@/components/progression/method-mirror-card';
import { WeeklyRecapCard } from '@/components/progression/weekly-recap-card';
import { BehaviorRadar } from '@/components/scoring/behavior-radar';
import { DrawdownStreaksCard, ExpectancyCard } from '@/components/scoring/expectancy-card';
import { RDistribution } from '@/components/scoring/r-distribution';
import { ScoreGaugeGrid } from '@/components/scoring/score-gauge-grid';
import { ScoreTrendChart } from '@/components/scoring/score-trend-chart';
import { TrackRecordChart } from '@/components/scoring/track-record-chart';
import { DisciplineYearHeatmap } from '@/components/track/discipline-year-heatmap';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Card } from '@/components/ui/card';
import { Sparkline } from '@/components/ui/sparkline';
import { getDisciplineYearHeatmap } from '@/lib/checkin/service';
import { getMethodMirror } from '@/lib/method-mirror/service';
import { getDashboardAnalytics, type RangeKey } from '@/lib/scoring/dashboard-data';
import {
  getBehavioralScoreHistory,
  getLatestBehavioralScore,
  type BehavioralScoreTrendPoint,
} from '@/lib/scoring/service';
import type { SerializedBehavioralScore } from '@/lib/scoring';
import { getMemberWeeklyRecap } from '@/lib/weekly-report/member-recap';

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
  title: 'Où j’en suis',
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
  const [latestScore, scoreHistory, yearHeatmap] = await Promise.all([
    getLatestBehavioralScore(userId),
    getBehavioralScoreHistory(userId, { sinceDays: 90 }),
    getDisciplineYearHeatmap(userId, timezone),
  ]);

  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto w-full max-w-[var(--w-app)] flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 2xl:px-12">
        <ProgressionHero score={latestScore} history={scoreHistory} />

        {/* Récap hebdo CHIFFRÉ — « Ta semaine en chiffres » (S14). Première
            surface membre avec un delta semaine-vs-semaine calme (réutilise
            l'agrégation de l'email weekly-digest). Stream via Suspense : les 2
            slices hebdo (~6 queries chacune) ne bloquent pas le shell. Posture
            §2 + anti-Black-Hat : delta vert si hausse, gris sinon, jamais rouge. */}
        <section className="wow-reveal mb-6" aria-labelledby="weekly-recap-heading">
          <h2 id="weekly-recap-heading" className="sr-only">
            Ta semaine en chiffres
          </h2>
          <Suspense fallback={<WeeklyRecapSkeleton />}>
            <WeeklyRecapSection userId={userId} />
          </Suspense>
        </section>

        {/* Profil comportemental — la forme memorisable (4 dimensions + ghost
            ~30 j) AVANT le detail chiffre des jauges. Posture §2 : jamais punitif. */}
        <section className="wow-reveal mb-6" aria-labelledby="radar-heading">
          <h2 id="radar-heading" className="sr-only">
            Ton profil comportemental
          </h2>
          <BehaviorRadar score={latestScore} history={scoreHistory} />
        </section>

        {/* Scores comportementaux du jour (4 jauges) */}
        <section className="wow-reveal mb-6" aria-labelledby="progression-scores-heading">
          <h2 id="progression-scores-heading" className="sr-only">
            Scores comportementaux
          </h2>
          <ScoreGaugeGrid score={latestScore} history={scoreHistory} />
        </section>

        {/* Régularité année — heatmap calendaire des check-ins (GitHub-style,
            non-punitive §31.2). Miroir calme de la constance. */}
        <section className="wow-reveal mb-6" aria-labelledby="year-heatmap-heading">
          <h2 id="year-heatmap-heading" className="sr-only">
            Régularité des check-ins sur 12 mois
          </h2>
          <Card primary className="p-5">
            <DisciplineYearHeatmap heatmap={yearHeatmap} />
          </Card>
        </section>

        {/* S24 — « Ta fidélité à la méthode » : miroir d'adhérence aux règles
            dures (fenêtre 13-16h, 1 trade/jour, coupure 20h, visée RR3) sur 30
            jours. Comble le gap « statut-jour only » : SessionTimeline montre la
            règle DU JOUR, ceci l'agrège dans le temps. Stream via Suspense (1
            query). Posture §2 + §31.2 : process, calme, jamais rouge punitif. */}
        <section className="wow-reveal mb-6" aria-labelledby="method-mirror-section-heading">
          <h2 id="method-mirror-section-heading" className="sr-only">
            Ta fidélité à la méthode
          </h2>
          <Suspense fallback={<MethodMirrorSkeleton />}>
            <MethodMirrorSection userId={userId} />
          </Suspense>
        </section>

        {/* Trajectoire des scores dans le temps */}
        <section className="wow-reveal mb-6" aria-labelledby="score-trend-heading">
          <h2 id="score-trend-heading" className="sr-only">
            Évolution de tes scores comportementaux
          </h2>
          <ScoreTrendChart data={scoreHistory} />
        </section>

        {/* Track record — R cumulé + expectancy + drawdown + distribution R */}
        <section
          className="wow-reveal mb-6 flex flex-col gap-3"
          aria-labelledby="track-record-heading"
        >
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

        {/* S19 — pont réciproque vers le pendant PROSPECTIF. « Où j'en suis »
            (rétrospectif) et « Mes objectifs » (où je vais) sont jumelles mais
            ne se liaient pas : le membre ignorait que la 2e moitié existe. */}
        <Link
          href="/objectifs"
          className="wow-hover-glow rounded-card group flex items-center justify-between gap-3 border border-[var(--b-acc)] bg-[var(--acc-dim-2)] p-4 transition-colors hover:bg-[var(--acc-dim)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] sm:p-5"
        >
          <div className="flex flex-col gap-0.5">
            <span className="t-eyebrow text-[var(--acc-hi)]">Et maintenant</span>
            <span className="text-[15px] font-semibold text-[var(--t-1)]">
              Où tout ça te mène — Mes objectifs
            </span>
            <span className="t-cap text-[var(--t-3)]">
              Ton cap, ta trajectoire vers la Maîtrise et tes prochains gestes.
            </span>
          </div>
          <ArrowRight
            className="h-5 w-5 shrink-0 text-[var(--acc)] transition-transform duration-200 group-hover:translate-x-0.5"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </Link>
      </div>
    </main>
  );
}

/**
 * ProgressionHero (S18) — remplace le `<header>` texte nu (zone la plus fade) par
 * une carte hero glass cohérente avec le NorthStarHero du dashboard : eyebrow +
 * titre display + lead À GAUCHE, récap chiffré coloré (score discipline +
 * micro-trajectoire + delta calme) À DROITE. Présentationnel pur — réutilise les
 * données déjà fetchées en tête de page (aucune query ajoutée).
 *
 * Posture §2 / anti-Black-Hat : la discipline est un score de PROCESS, jamais un
 * P&L. Le delta monte en vert `--ok` (renforcement positif autorisé) et reste
 * gris neutre `--t-3` à plat OU en repli — JAMAIS rouge, jamais punitif (miroir
 * exact du TrendBadge du hero dashboard).
 */
function ProgressionHero({
  score,
  history,
}: {
  score: SerializedBehavioralScore | null;
  history: BehavioralScoreTrendPoint[];
}) {
  const points = history.map((p) => p.discipline).filter((n): n is number => n !== null);
  const value = score?.disciplineScore ?? null;
  const first = points[0];
  const last = points[points.length - 1];
  const delta = first !== undefined && last !== undefined ? last - first : null;
  const rising = delta !== null && delta >= 2;
  const hasSpark = points.length >= 2;

  return (
    <section aria-labelledby="progression-hero-heading" className="wow-reveal mb-6">
      <Card
        primary
        glass
        edge={false}
        className="dash-hero relative overflow-hidden p-6 backdrop-blur-[16px] backdrop-saturate-150 lg:p-7"
      >
        <div className="relative grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-center lg:gap-8">
          {/* ---- Gauche : intro ---- */}
          <div className="flex flex-col gap-2">
            <span className="t-eyebrow text-[var(--t-3)]">Ma progression</span>
            <h1
              id="progression-hero-heading"
              className="f-display h-rise leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)]"
              style={{
                fontFeatureSettings: '"ss01" 1',
                fontSize: 'clamp(1.75rem, 1.45rem + 1.3vw, 2.25rem)',
              }}
            >
              Où j’en suis
            </h1>
            <p className="t-lead max-w-[58ch]">
              Tes scores comportementaux, leur trajectoire et ton track record — la photo de ta
              discipline dans le temps. Tu observes, tu ne te fais pas punir.
            </p>
          </div>

          {/* ---- Droite : récap chiffré discipline ---- */}
          <div className="rounded-card flex flex-col gap-2.5 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-4 lg:p-5">
            <span className="t-eyebrow text-[var(--acc-hi)]">Discipline du moment</span>
            <div className="flex items-end gap-3">
              <span className="f-mono text-[40px] leading-none font-bold tracking-[-0.03em] text-[var(--t-1)] tabular-nums">
                {value === null ? '—' : <AnimatedNumber value={value} />}
                {value !== null ? (
                  <span className="text-[18px] font-medium text-[var(--t-3)]">/100</span>
                ) : null}
              </span>
              {delta !== null ? (
                <span
                  className={`mb-1 inline-flex items-center gap-1 text-[12px] font-semibold ${
                    rising ? 'text-[var(--ok)]' : 'text-[var(--t-3)]'
                  }`}
                >
                  {rising ? (
                    <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <Minus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  )}
                  {rising ? `+${delta}` : 'stable'}
                  <span className="sr-only">
                    {rising ? 'en hausse sur la période' : 'tendance stable sur la période'}
                  </span>
                </span>
              ) : null}
            </div>
            {hasSpark ? (
              <Sparkline
                data={points}
                width={210}
                height={44}
                fill
                showLastDot
                color="var(--acc)"
                className="mt-0.5 w-full"
                ariaLabel={`Trajectoire de ton score discipline : ${points.length} relevés, de ${first} à ${last} sur 100.`}
              />
            ) : (
              <p className="t-cap inline-flex items-center gap-1.5 text-[var(--t-3)]">
                <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                Ta trajectoire apparaît dès quelques jours de recul.
              </p>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}

async function MethodMirrorSection({ userId }: { userId: string }) {
  const mirror = await getMethodMirror(userId);
  return <MethodMirrorCard mirror={mirror} />;
}

function MethodMirrorSkeleton() {
  return (
    <div
      className="skel rounded-card-lg h-[316px] border border-[var(--b-default)] bg-[var(--bg-1)]"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement de ta fidélité à la méthode"
    />
  );
}

async function WeeklyRecapSection({ userId }: { userId: string }) {
  const recap = await getMemberWeeklyRecap(userId);
  // Inactive member / no current slice → render nothing (the rest of the page
  // still shows the member's scores). Never a fabricated empty card.
  if (recap === null) return null;
  return <WeeklyRecapCard current={recap.current} previous={recap.previous} />;
}

function WeeklyRecapSkeleton() {
  return (
    <div
      className="skel rounded-card h-[208px] border border-[var(--b-default)] bg-[var(--bg-1)] sm:h-[188px]"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement de ta semaine en chiffres"
    />
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
