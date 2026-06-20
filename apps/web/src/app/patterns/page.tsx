import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { PreTradeAnalyticsCard } from '@/components/pre-trade/pre-trade-analytics-card';
import { PreTradeCorrelationCard } from '@/components/pre-trade/pre-trade-correlation-card';
import { EmotionPerfTable } from '@/components/scoring/emotion-perf-table';
import { PairTopFive } from '@/components/scoring/pair-top-five';
import { SessionPerfBars } from '@/components/scoring/session-perf-bars';
import { SetupQualityCard } from '@/components/scoring/setup-quality-card';
import {
  HabitCorrelationSection,
  HabitCorrelationSkeleton,
} from '@/components/track/habit-correlation-section';
import { HabitKindTabPicker } from '@/components/track/habit-kind-tab-picker';
import { habitKindSchema } from '@/lib/schemas/habit-log';
import { getDashboardAnalytics, type RangeKey } from '@/lib/scoring/dashboard-data';

/**
 * « Patterns » — V2 refonte J2 (intention de guidage).
 *
 * Reçoit les surfaces d'ANALYSE COMPORTEMENTALE migrées hors du dashboard :
 * patterns émotion×résultat + sessions + paires, lecture honnête du pré-trade
 * (exécution + corrélation raison×perf), et corrélations habitudes×trading.
 * Posture §2 / anti-Black-Hat STRICT : `acc` uniquement sur `edge`, jamais de
 * rouge punitif, honnêteté statistique (taille d'échantillon visible, pas de
 * coefficient fabriqué).
 */
export const metadata = {
  title: 'Patterns',
};
export const dynamic = 'force-dynamic';

const VALID_RANGES = new Set<RangeKey>(['7d', '30d', '3m', '6m', 'all']);

function parseRange(input: string | undefined): RangeKey {
  return input && VALID_RANGES.has(input as RangeKey) ? (input as RangeKey) : '30d';
}

interface PatternsPageProps {
  searchParams: Promise<{ range?: string; corr?: string }>;
}

export default async function PatternsPage({ searchParams }: PatternsPageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = session.user.id;
  if (!userId) redirect('/login');
  const timezone = session.user.timezone || 'Europe/Paris';
  const sp = await searchParams;
  const range = parseRange(sp?.range);
  const corrParsed = habitKindSchema.safeParse(sp?.corr);
  const corrKind = corrParsed.success ? corrParsed.data : 'sleep';
  const corrPreserved = sp?.range
    ? new URLSearchParams({ range: parseRange(sp.range) }).toString()
    : '';

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
            Patterns
          </h1>
          <p className="t-lead max-w-[62ch]">
            Ce que tes données révèlent sur ton exécution : émotions, sessions, paires, et le lien
            entre tes habitudes et ton trading. Une lecture honnête — jamais un verdict.
          </p>
        </header>

        {/* Patterns — émotion×résultat + sessions + paires */}
        <section className="wow-reveal mb-6 flex flex-col gap-3" aria-labelledby="patterns-heading">
          <div className="flex items-center gap-2">
            <h2 id="patterns-heading" className="t-eyebrow">
              Patterns d’exécution
            </h2>
          </div>
          <Suspense fallback={<PatternsSkeleton />}>
            <PatternsSection userId={userId} timezone={timezone} range={range} />
          </Suspense>
        </section>

        {/* Qualité de setup (Steenbarger) + plafond de risque (Tharp) — mesure
            l'ACTE de grader/sizer, jamais le P&L (posture §2). */}
        <section
          className="wow-reveal mb-6 flex flex-col gap-3"
          aria-labelledby="setup-quality-heading"
        >
          <div className="flex items-center gap-2">
            <h2 id="setup-quality-heading" className="t-eyebrow">
              Qualité de setup &amp; risque
            </h2>
          </div>
          <Suspense fallback={<SetupQualitySkeleton />}>
            <SetupQualitySection userId={userId} timezone={timezone} range={range} />
          </Suspense>
        </section>

        {/* Pré-trade — exécution honnête + corrélation raison×performance */}
        <section
          className="wow-reveal mb-6 flex flex-col gap-3"
          aria-labelledby="patterns-pretrade-heading"
        >
          <div className="flex items-center gap-2">
            <h2 id="patterns-pretrade-heading" className="t-eyebrow">
              Pré-trade
            </h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <PreTradeAnalyticsCard userId={userId} />
            <PreTradeCorrelationCard userId={userId} />
          </div>
        </section>

        {/* Corrélations habitudes × trading (différenciateur Fxmily) */}
        <section
          className="wow-reveal mb-6 flex flex-col gap-3"
          aria-labelledby="habit-corr-heading"
        >
          <div className="flex items-center gap-2">
            <span id="habit-corr-heading" className="t-eyebrow">
              Corrélations habitudes × trading
            </span>
          </div>
          <HabitKindTabPicker
            selected={corrKind}
            labelId="habit-corr-heading"
            pathname="/patterns"
            preservedQuery={corrPreserved}
          />
          <Suspense key={corrKind} fallback={<HabitCorrelationSkeleton />}>
            <HabitCorrelationSection userId={userId} timezone={timezone} habitKind={corrKind} />
          </Suspense>
        </section>
      </div>
    </main>
  );
}

async function PatternsSection({
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
    <div className="grid gap-3 lg:grid-cols-2">
      <EmotionPerfTable rows={analytics.emotionPerf} totalTrades={analytics.closedCount} />
      <SessionPerfBars sessions={analytics.sessionPerf} />
      <div className="lg:col-span-2">
        <PairTopFive pairs={analytics.pairTopFive} />
      </div>
    </div>
  );
}

function PatternsSkeleton() {
  return (
    <div
      className="flex flex-col gap-3"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement des patterns"
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="skel rounded-card-lg h-[280px] border border-[var(--b-default)] bg-[var(--bg-1)]" />
        <div className="skel rounded-card-lg h-[280px] border border-[var(--b-default)] bg-[var(--bg-1)]" />
        <div className="skel rounded-card-lg h-[240px] border border-[var(--b-default)] bg-[var(--bg-1)] lg:col-span-2" />
      </div>
    </div>
  );
}

async function SetupQualitySection({
  userId,
  timezone,
  range,
}: {
  userId: string;
  timezone: string;
  range: RangeKey;
}) {
  // Same (userId, timezone, range) as PatternsSection → React 19 cache() dedup,
  // zero extra DB query.
  const analytics = await getDashboardAnalytics(userId, timezone, range);
  return (
    <SetupQualityCard
      setupQuality={analytics.setupQuality}
      riskDiscipline={analytics.riskDiscipline}
    />
  );
}

function SetupQualitySkeleton() {
  return (
    <div
      className="flex flex-col gap-3"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement de la qualité de setup"
    >
      <div className="skel rounded-card-lg h-[240px] border border-[var(--b-default)] bg-[var(--bg-1)]" />
      <div className="skel rounded-card-lg h-[120px] border border-[var(--b-default)] bg-[var(--bg-1)]" />
    </div>
  );
}
