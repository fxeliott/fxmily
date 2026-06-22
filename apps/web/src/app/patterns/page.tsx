import { Activity, Clock, Coffee, Heart, Layers } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { EmotionArcNote } from '@/components/patterns/emotion-arc-note';
import { EmotionPhasePicker } from '@/components/patterns/emotion-phase-picker';
import { type EmotionPhase, isEmotionPhase } from '@/lib/patterns/emotion-phase';
import { PreTradeAnalyticsCard } from '@/components/pre-trade/pre-trade-analytics-card';
import { PreTradeCorrelationCard } from '@/components/pre-trade/pre-trade-correlation-card';
import { EmotionPerfTable } from '@/components/scoring/emotion-perf-table';
import { HourlyRhythm } from '@/components/scoring/hourly-rhythm';
import { PairTopFive } from '@/components/scoring/pair-top-five';
import { SessionPerfBars } from '@/components/scoring/session-perf-bars';
import { SetupQualityCard } from '@/components/scoring/setup-quality-card';
import {
  HabitCorrelationSection,
  HabitCorrelationSkeleton,
} from '@/components/track/habit-correlation-section';
import { Card } from '@/components/ui/card';
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
  searchParams: Promise<{ range?: string; corr?: string; phase?: string }>;
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
  const phase: EmotionPhase = isEmotionPhase(sp?.phase) ? sp.phase : 'before';

  // Each picker preserves the OTHER pickers' params across its own switch.
  const buildPreserved = (drop: 'corr' | 'phase'): string => {
    const params = new URLSearchParams();
    if (sp?.range) params.set('range', parseRange(sp.range));
    if (drop !== 'corr' && corrParsed.success) params.set('corr', corrKind);
    if (drop !== 'phase' && isEmotionPhase(sp?.phase)) params.set('phase', phase);
    return params.toString();
  };
  const corrPreserved = buildPreserved('corr');
  const phasePreserved = buildPreserved('phase');

  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto w-full max-w-[var(--w-app)] flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 2xl:px-12">
        <PatternsHero />

        {/* Patterns — émotion×résultat (3 moments) + rythmes + sessions + paires */}
        <section className="wow-reveal mb-6 flex flex-col gap-3" aria-labelledby="patterns-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="patterns-heading" className="t-eyebrow">
              Patterns d’exécution
            </h2>
            <EmotionPhasePicker
              selected={phase}
              labelId="patterns-heading"
              pathname="/patterns"
              preservedQuery={phasePreserved}
            />
          </div>
          <Suspense key={phase} fallback={<PatternsSkeleton />}>
            <PatternsSection userId={userId} timezone={timezone} range={range} phase={phase} />
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

/**
 * PatternsHero (S18) — remplace le `<header>` texte nu (zone fade) par une carte
 * hero glass cohérente avec le NorthStarHero du dashboard. La page Patterns n'a
 * AUCUNE métrique chiffrée chargée au top-level (tout stream via Suspense), donc
 * plutôt qu'inventer un nombre (interdit, posture honnêteté), le récap est une
 * série de « lentilles » colorées : les 4 axes que la page va révéler. Chaque
 * lentille porte une teinte du spectre cool autorisé (bleu/indigo/cyan) — jamais
 * un hue hors-spectre. Présentationnel pur, zéro query ajoutée.
 *
 * Posture §2 / anti-Black-Hat : aucun verdict, aucune couleur P&L ; les chips
 * sont des repères d'orientation, pas des scores.
 */
function PatternsHero() {
  // 4 lentilles d'analyse. Teintes via tokens data-viz catégoriels NEUTRES
  // (flippent en light) — décoratives, jamais une grammaire direction/P&L.
  // S19.1 — lentilles cliquables = mini-sommaire + wow : chaque lentille pointe
  // vers l'ancre de la section qu'elle annonce (émotions/sessions/paires vivent
  // dans la section « Patterns d'exécution », habitudes dans sa propre section).
  const lenses = [
    {
      label: 'Émotions',
      Icon: Heart,
      href: '#patterns-heading',
      surf: 'border-[var(--dv-1-edge)] bg-[var(--dv-1-dim)]',
    },
    {
      label: 'Sessions',
      Icon: Clock,
      href: '#patterns-heading',
      surf: 'border-[var(--dv-2-edge)] bg-[var(--dv-2-dim)]',
    },
    {
      label: 'Paires',
      Icon: Layers,
      href: '#patterns-heading',
      surf: 'border-[var(--dv-3-edge)] bg-[var(--dv-3-dim)]',
    },
    {
      label: 'Habitudes',
      Icon: Coffee,
      href: '#habit-corr-heading',
      surf: 'border-[var(--dv-1-edge)] bg-[var(--dv-1-dim)]',
    },
  ] as const;

  return (
    <section aria-labelledby="patterns-hero-heading" className="wow-reveal mb-6">
      <Card
        primary
        glass
        edge={false}
        className="dash-hero relative overflow-hidden p-6 backdrop-blur-[16px] backdrop-saturate-150 lg:p-7"
      >
        <div className="relative grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-center lg:gap-8">
          {/* ---- Gauche : intro ---- */}
          <div className="flex flex-col gap-2">
            <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <Activity className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Ma progression
            </span>
            <h1
              id="patterns-hero-heading"
              className="f-display h-rise leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)]"
              style={{
                fontFeatureSettings: '"ss01" 1',
                fontSize: 'clamp(1.75rem, 1.45rem + 1.3vw, 2.25rem)',
              }}
            >
              Patterns
            </h1>
            <p className="t-lead max-w-[58ch]">
              Ce que tes données révèlent sur ton exécution : émotions, sessions, paires, et le lien
              entre tes habitudes et ton trading. Une lecture honnête — jamais un verdict.
            </p>
          </div>

          {/* ---- Droite : les 4 lentilles d'analyse ---- */}
          {/* S19.1 — mini-sommaire : chaque lentille est un lien d'ancre vers sa
              section. Hover/focus compositor-safe (border/bg + translate sous
              transition-transform), focus-visible:outline pour l'a11y clavier. */}
          <ul
            className="grid grid-cols-2 gap-2.5"
            aria-label="Aller à une section d’analyse : émotions, sessions, paires, habitudes"
          >
            {lenses.map(({ label, Icon, href, surf }) => (
              <li key={label}>
                <a
                  href={href}
                  className={`rounded-card flex items-center gap-2.5 border p-3 transition-[colors,transform] duration-200 ease-out hover:-translate-y-px hover:border-[var(--b-acc)] hover:bg-[var(--acc-dim-2)] focus-visible:-translate-y-px focus-visible:border-[var(--b-acc)] focus-visible:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] ${surf}`}
                >
                  <span
                    aria-hidden="true"
                    className="rounded-control grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-1)] text-[var(--t-2)]"
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <span className="text-[13px] font-semibold text-[var(--t-1)]">{label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </section>
  );
}

async function PatternsSection({
  userId,
  timezone,
  range,
  phase,
}: {
  userId: string;
  timezone: string;
  range: RangeKey;
  phase: EmotionPhase;
}) {
  const analytics = await getDashboardAnalytics(userId, timezone, range);
  const emotionRows =
    phase === 'during'
      ? analytics.emotionPerfDuring
      : phase === 'after'
        ? analytics.emotionPerfAfter
        : analytics.emotionPerf;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <EmotionPerfTable rows={emotionRows} totalTrades={analytics.closedCount} />
      <SessionPerfBars sessions={analytics.sessionPerf} />
      <HourlyRhythm hours={analytics.hourlyPerf} />
      {/* S15 #5 — intra-trade emotion-arc degradation (renders nothing below the
          calm sample threshold). Phase-independent (always before→during/after). */}
      <EmotionArcNote arc={analytics.emotionArc} />
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
