import {
  ArrowRight,
  BookOpen,
  Check,
  LineChart as LineChartIcon,
  LogOut,
  Moon,
  Plus,
  Shield,
  Sun,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { auth, signOut } from '@/auth';
import { StreakCard } from '@/components/checkin/streak-card';
import { DouglasInboxWidget } from '@/components/library/douglas-inbox-widget';
import { EmotionPerfTable } from '@/components/scoring/emotion-perf-table';
import { DrawdownStreaksCard, ExpectancyCard } from '@/components/scoring/expectancy-card';
import { PairTopFive } from '@/components/scoring/pair-top-five';
import { RDistribution } from '@/components/scoring/r-distribution';
import { ScoreGaugeGrid, ScoreGaugeGridSkeleton } from '@/components/scoring/score-gauge-grid';
import { SessionPerfBars } from '@/components/scoring/session-perf-bars';
import { TrackRecordChart } from '@/components/scoring/track-record-chart';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Pill } from '@/components/ui/pill';
import { getCheckinStatus, getStreak } from '@/lib/checkin/service';
import { getDashboardAnalytics, type RangeKey } from '@/lib/scoring/dashboard-data';
import { getLatestBehavioralScore } from '@/lib/scoring/service';
import { countTradesByStatus } from '@/lib/trades/service';
import { cn } from '@/lib/utils';

import { MarkDouglasCard } from './mark-douglas-card';

export const metadata = {
  title: 'Tableau de bord · Fxmily',
};
export const dynamic = 'force-dynamic';

const PARIS_TZ = 'Europe/Paris';

const VALID_RANGES = new Set<RangeKey>(['7d', '30d', '3m', '6m', 'all']);

function parseRange(input: string | undefined): RangeKey {
  return input && VALID_RANGES.has(input as RangeKey) ? (input as RangeKey) : '30d';
}

function frenchToday(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const raw = fmt.format(now);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function greeting(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: PARIS_TZ,
    hour: '2-digit',
    hour12: false,
  });
  const h = Number(fmt.format(now));
  if (h < 6) return 'Bonne nuit';
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

interface DashboardPageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = session.user.id;
  const timezone = session.user.timezone || 'Europe/Paris';
  const sp = await searchParams;
  const range = parseRange(sp?.range);

  const [counts, checkinStatus, streak, latestScore] = userId
    ? await Promise.all([
        countTradesByStatus(userId),
        getCheckinStatus(userId, timezone),
        getStreak(userId, timezone),
        getLatestBehavioralScore(userId),
      ])
    : [
        { open: 0, closed: 0 },
        { today: '', morningSubmitted: false, eveningSubmitted: false },
        { current: 0, todayFilled: false, today: '' },
        null,
      ];

  const fullName = session.user.name?.trim() || session.user.email?.split('@')[0] || 'Membre';
  const firstName = fullName.split(' ')[0]!;
  const isAdmin = session.user.role === 'admin';
  const totalTrades = counts.open + counts.closed;

  return (
    <main className="flex min-h-dvh flex-col bg-[var(--bg)]">
      {/* Sticky header */}
      <header className="bg-[var(--bg)]/95 sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-[var(--b-default)] px-4 backdrop-blur lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="grid h-5 w-5 place-items-center rounded-[5px] border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[10px] font-bold text-[var(--acc)]">
            F
          </div>
          <span className="f-display text-[13px] font-semibold tracking-[-0.01em]">Fxmily</span>
        </Link>
        <span className="text-[var(--t-4)]">/</span>
        <span className="text-[12px] text-[var(--t-1)]">{fullName}</span>
        {isAdmin ? <Pill tone="acc">ADMIN</Pill> : null}

        <div className="flex-1" />

        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <button
            type="submit"
            className="rounded-control inline-flex h-7 items-center gap-1.5 border border-transparent px-2.5 text-[11px] text-[var(--t-3)] transition-colors hover:border-[var(--b-default)] hover:text-[var(--t-1)]"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </form>
      </header>

      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
        {/* Title row */}
        <section className="mb-6 flex flex-col gap-2">
          <div className="t-eyebrow flex items-center gap-2">
            <span>{frenchToday()}</span>
          </div>
          <h1
            className="f-display h-rise text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-[var(--t-1)] sm:text-[36px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            {greeting()} {firstName}.
          </h1>
          <p className="t-lead">
            La discipline avant le marché. Logge ton plan, mesure ton mental, oublie les bougies.
          </p>
        </section>

        {/* KPI strip 4-cell — counts + streak */}
        <section className="mb-6">
          <div className="border-edge-top rounded-card relative grid grid-cols-2 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] shadow-[var(--sh-card)] sm:grid-cols-4">
            <KpiCell
              label="Trades total"
              value={totalTrades.toString()}
              hint={totalTrades === 0 ? 'Premier jour' : 'cumulés'}
            />
            <KpiCell
              label="En cours"
              value={counts.open.toString()}
              hint="ouverts"
              tone={counts.open > 0 ? 'warn' : 'mute'}
            />
            <KpiCell
              label="Clôturés"
              value={counts.closed.toString()}
              hint="ce mois"
              tone={counts.closed > 0 ? 'ok' : 'mute'}
            />
            <KpiCell
              label="Streak"
              value={streak.current.toString()}
              hint={
                streak.current === 0
                  ? 'à démarrer'
                  : streak.todayFilled
                    ? 'jours d’affilée'
                    : 'à confirmer'
              }
              tone={streak.current === 0 ? 'mute' : streak.todayFilled ? 'acc' : 'warn'}
            />
          </div>
        </section>

        {/* J5 — Check-in du jour */}
        <section className="mb-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card primary className="flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="t-eyebrow">Check-in du jour</span>
                <Pill tone="acc" dot="live">
                  ACTIF
                </Pill>
              </div>
              <Link
                href="/checkin"
                className="inline-flex items-center gap-1 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
              >
                Tout voir
                <ArrowRight className="h-3 w-3" strokeWidth={1.75} />
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <CheckinSlotChip
                slot="morning"
                submitted={checkinStatus.morningSubmitted}
                href="/checkin/morning"
              />
              <CheckinSlotChip
                slot="evening"
                submitted={checkinStatus.eveningSubmitted}
                href="/checkin/evening"
              />
            </div>
          </Card>

          <StreakCard streak={streak.current} todayFilled={streak.todayFilled} />
        </section>

        {/* J6 — Behavioral scores (4 gauges) */}
        <section className="mb-6">
          <Suspense fallback={<ScoreGaugeGridSkeleton />}>
            <ScoreGaugeGrid score={latestScore} />
          </Suspense>
        </section>

        {/* J6 — Track record (R cumulé + R-dist + expectancy + DD) */}
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
            <TrackRecordSection userId={userId!} timezone={timezone} range={range} />
          </Suspense>
        </section>

        {/* J6 — Patterns (emotion×outcome + sessions + paires) */}
        <section className="mb-6 flex flex-col gap-3" aria-labelledby="patterns-heading">
          <div className="flex items-center gap-2">
            <h2 id="patterns-heading" className="t-eyebrow">
              Patterns
            </h2>
          </div>
          <Suspense fallback={<PatternsSkeleton />}>
            <PatternsSection userId={userId!} timezone={timezone} range={range} />
          </Suspense>
        </section>

        {/* Mark Douglas card (canonical TIER 4) */}
        <section className="mb-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card primary className="flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="t-eyebrow">Journal de trading</span>
              </div>
            </div>
            <p className="t-body text-[var(--t-2)]">
              Logge chaque trade : capture avant entrée, plan, R:R prévu. Au moment de la sortie,
              renseigne le résultat et l&apos;émotion.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Link href="/journal/new" className={cn(btnVariants({ kind: 'primary', size: 'm' }))}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                Nouveau trade
                <Kbd inline className="ml-1">
                  N
                </Kbd>
              </Link>
              <Link href="/journal" className={cn(btnVariants({ kind: 'secondary', size: 'm' }))}>
                Voir mes trades
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Link>
            </div>
          </Card>

          <MarkDouglasCard />
        </section>

        {/* Admin section (conditional) */}
        {isAdmin ? (
          <section className="mb-6">
            <div className="mb-3 flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-[var(--acc)]" strokeWidth={1.75} />
              <span className="t-eyebrow">Espace admin</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Link href="/admin/members" className="block">
                <Card interactive className="flex items-start gap-3 p-4">
                  <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
                    <Users className="h-4 w-4" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="t-h3 text-[var(--t-1)]">Membres</h3>
                    <p className="t-cap mt-0.5 text-[var(--t-3)]">
                      Voir la liste, statuts, dernières activités.
                    </p>
                  </div>
                  <ArrowRight
                    className="mt-1.5 h-3.5 w-3.5 shrink-0 text-[var(--t-4)]"
                    strokeWidth={1.75}
                  />
                </Card>
              </Link>
              <Link href="/admin/invite" className="block">
                <Card interactive className="flex items-start gap-3 p-4">
                  <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
                    <Plus className="h-4 w-4" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="t-h3 text-[var(--t-1)]">Inviter un membre</h3>
                    <p className="t-cap mt-0.5 text-[var(--t-3)]">
                      Lien personnel valable 7 jours, unique.
                    </p>
                  </div>
                  <ArrowRight
                    className="mt-1.5 h-3.5 w-3.5 shrink-0 text-[var(--t-4)]"
                    strokeWidth={1.75}
                  />
                </Card>
              </Link>
            </div>
          </section>
        ) : null}

        {/* J7.7 — Mark Douglas widget (replaces stale "Bibliothèque MD J7" coming-soon) */}
        <section className="mb-6" aria-label="Module Mark Douglas">
          <DouglasInboxWidget userId={session.user.id} />
        </section>

        {/* Coming soon section */}
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-[var(--t-3)]" strokeWidth={1.75} />
            <span className="t-eyebrow">Bientôt</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ComingSoonCard
              title="Rapport hebdo IA"
              jalon="J8"
              desc="Analyse Claude livrée chaque dimanche."
            />
            <ComingSoonCard
              title="Notifications push"
              jalon="J9"
              desc="Push contextuels sur tes fiches Mark Douglas."
            />
          </div>
        </section>

        {/* Footer kbd hint */}
        <footer className="mt-8 flex items-center justify-between border-t border-[var(--b-default)] pt-4 text-[10px] tabular-nums text-[var(--t-4)]">
          <span className="t-foot">Aucun conseil de marché. Discipline avant tout.</span>
          <span className="inline-flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>?</Kbd>
            raccourcis
          </span>
        </footer>
      </div>
    </main>
  );
}

// ----- J6 sections (server async) ------------------------------------------

/**
 * Skeletons that match the final section dimensions to avoid layout shift
 * (J6.6 H2 fix — previously a flat 300px / 260px skel collapsed when the
 * real content rendered at ~600px+).
 */
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

// ----- KPI / chip / placeholder cells ---------------------------------------

function KpiCell({
  label,
  value,
  hint,
  tone = 'default',
  soon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'mute' | 'warn' | 'ok' | 'acc';
  soon?: boolean;
}) {
  const valColor =
    tone === 'ok'
      ? 'text-[var(--ok)]'
      : tone === 'warn'
        ? 'text-[var(--warn)]'
        : tone === 'acc'
          ? 'text-[var(--acc)]'
          : tone === 'mute'
            ? 'text-[var(--t-3)]'
            : 'text-[var(--t-1)]';
  return (
    <div className="flex flex-col gap-1.5 border-b border-r border-[var(--b-default)] p-4 last:border-r-0 sm:border-b-0 [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-b-0 sm:[&:nth-child(2)]:border-r">
      <span className="t-eyebrow">{label}</span>
      <span
        className={cn(
          'f-mono text-[22px] font-semibold tabular-nums leading-none tracking-[-0.02em]',
          valColor,
        )}
      >
        {value}
      </span>
      {hint ? (
        <span className="t-mono-cap flex items-center gap-1">
          {soon ? <Pill tone="cy">SOON</Pill> : null}
          <span>{hint}</span>
        </span>
      ) : null}
    </div>
  );
}

function ComingSoonCard({ title, jalon, desc }: { title: string; jalon: string; desc: string }) {
  return (
    <Card className="flex flex-col gap-2 p-4 opacity-70">
      <div className="flex items-center justify-between">
        <h4 className="t-h3 text-[var(--t-2)]">{title}</h4>
        <Pill tone="cy">{jalon}</Pill>
      </div>
      <p className="t-cap text-[var(--t-4)]">{desc}</p>
    </Card>
  );
}

function CheckinSlotChip({
  slot,
  submitted,
  href,
}: {
  slot: 'morning' | 'evening';
  submitted: boolean;
  href: '/checkin/morning' | '/checkin/evening';
}) {
  const isMorning = slot === 'morning';
  const Icon = isMorning ? Sun : Moon;
  const label = isMorning ? 'Matin' : 'Soir';
  const sub = isMorning ? 'Sommeil · routine' : 'Discipline · stress';
  return (
    <Link href={href} className="block">
      <div
        className={cn(
          'rounded-control flex items-center gap-3 border bg-[var(--bg-1)] px-3 py-2.5 transition-all',
          submitted
            ? 'border-[var(--b-acc)] bg-[var(--acc-dim-2)]'
            : 'border-[var(--b-default)] hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)]',
        )}
      >
        <div
          className={cn(
            'rounded-control grid h-8 w-8 shrink-0 place-items-center border',
            submitted
              ? 'border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--acc)]'
              : 'border-[var(--b-default)] text-[var(--t-3)]',
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="flex flex-1 flex-col leading-tight">
          <span className="text-[13px] font-semibold text-[var(--t-1)]">{label}</span>
          <span className="t-cap text-[var(--t-4)]">{sub}</span>
        </div>
        {submitted ? (
          <Check className="h-4 w-4 text-[var(--acc)]" strokeWidth={2} aria-label="fait" />
        ) : (
          <ArrowRight
            className="h-3.5 w-3.5 text-[var(--t-4)]"
            strokeWidth={1.75}
            aria-label="à faire"
          />
        )}
      </div>
    </Link>
  );
}
