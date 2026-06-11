import {
  ArrowRight,
  CalendarRange,
  GraduationCap,
  Inbox,
  LineChart as LineChartIcon,
  LogOut,
  Plus,
  Shield,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { auth, signOut } from '@/auth';
import { CalendarStatusWidget } from '@/components/calendar/calendar-status-widget';
import { StreakCard } from '@/components/checkin/streak-card';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DrawnRule } from '@/components/dashboard/drawn-rule';
import { DashboardReflectWidget } from '@/components/dashboard/reflect-widget';
import { TodayGuidance } from '@/components/dashboard/today-guidance';
import { DouglasInboxWidget } from '@/components/library/douglas-inbox-widget';
import { ProfileStatusWidget } from '@/components/onboarding/profile-status-widget';
import { EmotionPerfTable } from '@/components/scoring/emotion-perf-table';
import { DrawdownStreaksCard, ExpectancyCard } from '@/components/scoring/expectancy-card';
import { PairTopFive } from '@/components/scoring/pair-top-five';
import { RDistribution } from '@/components/scoring/r-distribution';
import { ScoreGaugeGrid, ScoreGaugeGridSkeleton } from '@/components/scoring/score-gauge-grid';
import { ScoreTrendChart, ScoreTrendChartSkeleton } from '@/components/scoring/score-trend-chart';
import { SessionPerfBars } from '@/components/scoring/session-perf-bars';
import { TrackRecordChart } from '@/components/scoring/track-record-chart';
import {
  HabitCorrelationSection,
  HabitCorrelationSkeleton,
} from '@/components/track/habit-correlation-section';
import { HabitKindTabPicker } from '@/components/track/habit-kind-tab-picker';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { HoverLift } from '@/components/ui/hover-lift';
import { Kbd } from '@/components/ui/kbd';
import { Pill } from '@/components/ui/pill';
import { countPendingAccessRequests } from '@/lib/access-request/service';
import { getStreak } from '@/lib/checkin/service';
import { habitKindSchema } from '@/lib/schemas/habit-log';
import { getDashboardAnalytics, type RangeKey } from '@/lib/scoring/dashboard-data';
import { getBehavioralScoreHistory, getLatestBehavioralScore } from '@/lib/scoring/service';
import { countTradesByStatus } from '@/lib/trades/service';
import { cn } from '@/lib/utils';

import { PreTradeAnalyticsCard } from '@/components/pre-trade/pre-trade-analytics-card';
import { PreTradeCorrelationCard } from '@/components/pre-trade/pre-trade-correlation-card';

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
  searchParams: Promise<{ range?: string; corr?: string; done?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = session.user.id;
  const timezone = session.user.timezone || 'Europe/Paris';
  const sp = await searchParams;
  const range = parseRange(sp?.range);
  const corrParsed = habitKindSchema.safeParse(sp?.corr);
  const corrKind = corrParsed.success ? corrParsed.data : 'sleep';
  // Keep an explicit ?range across a pillar switch (don't reset the
  // track-record chart); omit it when the member never chose one, and
  // normalize via parseRange so a garbage value isn't propagated.
  const corrPreserved = sp?.range
    ? new URLSearchParams({ range: parseRange(sp.range) }).toString()
    : '';

  // NOTE — the daily check-in status is read INSIDE the "Ton aujourd'hui" panel
  // (getDailyGuidance) now, not here: the old static check-in card was removed
  // (the panel owns the time-aware check-in surfacing, no duplicate query).
  const [counts, streak, latestScore] = userId
    ? await Promise.all([
        countTradesByStatus(userId),
        getStreak(userId, timezone),
        getLatestBehavioralScore(userId),
      ])
    : [{ open: 0, closed: 0 }, { current: 0, todayFilled: false, today: '' }, null];

  const fullName = session.user.name?.trim() || session.user.email?.split('@')[0] || 'Membre';
  const firstName = fullName.split(' ')[0]!;
  const isAdmin = session.user.role === 'admin';
  const totalTrades = counts.open + counts.closed;

  // V2.5 — pending self-service access requests count for the admin card badge.
  const pendingAccessRequests = isAdmin ? await countPendingAccessRequests() : 0;

  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      {/* DS-v3 J3 — ambient mesh + drifting orbs behind the glass panels */}
      <DashboardAmbient />
      {/* Sticky header — full-bleed bar, content aligned to the body width */}
      <header className="sticky top-0 z-20 border-b border-[var(--b-default)] bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto flex h-12 w-full max-w-[var(--w-app)] items-center gap-3 px-4 lg:px-8 2xl:px-12">
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
        </div>
      </header>

      <div className="relative mx-auto w-full max-w-[var(--w-app)] flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 2xl:px-12">
        {/* Title row */}
        <section className="mb-6 flex flex-col gap-2">
          <div className="t-eyebrow flex items-center gap-2">
            <span>{frenchToday()}</span>
          </div>
          <h1
            className="f-display h-rise leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)]"
            style={{
              fontFeatureSettings: '"ss01" 1',
              fontSize: 'clamp(1.75rem, 1.45rem + 1.3vw, 2.25rem)',
            }}
          >
            {greeting()} {firstName}.
          </h1>
          <p className="t-lead">
            La discipline avant le marché. Logge ton plan, mesure ton mental, oublie les bougies.
          </p>
          <DrawnRule className="mt-1 max-w-[220px]" />
        </section>

        {/* KPI strip 4-cell — counts + streak */}
        <section className="mb-6" aria-labelledby="kpi-heading">
          <h2 id="kpi-heading" className="sr-only">
            Statistiques d&apos;activité
          </h2>
          <div className="glass-panel border-edge-top rounded-card relative grid grid-cols-2 overflow-hidden backdrop-blur-[16px] backdrop-saturate-150 sm:grid-cols-4">
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

        {/* Session 5 — Guidage quotidien « Ton aujourd'hui » (DoD §30 #3). THE
            single time-aware "now" hub: the check-in due for the current slot,
            TODAY's calendar blocks, a meeting today, the Monday mindset QCM. It
            REPLACES the old static "Check-in du jour" card (the panel owns the
            check-in surfacing now — no duplicate call-to-action on the page).
            Posture §2 + anti-Black-Hat (§31.2). StreakCard rides alongside. */}
        <div className="mb-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Suspense fallback={<TodayGuidanceSkeleton />}>
            <TodayGuidance userId={userId!} timezone={timezone} />
          </Suspense>
          <StreakCard streak={streak.current} todayFilled={streak.todayFilled} />
        </div>

        {/* V2.4 — Onboarding profile status (Session 2 hardening). The profiling
            pipeline (30-q interview → batch local Claude → MemberProfile
            → /profile) was fully built but had NO entry point in the member
            journey — /dashboard carried zero link to it, so new members never
            discovered the flagship "profilage initial" (SPEC §28). This calm
            status widget is the missing bridge ; it routes every member into
            building their profile. Four states, anti-Black-Hat, posture §2. */}
        <section className="mb-6" aria-labelledby="profile-widget-heading">
          <h2 id="profile-widget-heading" className="sr-only">
            Mon profil de trader
          </h2>
          <Suspense fallback={<ProfileStatusSkeleton />}>
            <ProfileStatusWidget userId={userId!} />
          </Suspense>
        </section>

        {/* §26 — Calendrier adaptatif : weekly-schedule questionnaire status.
            Calm CTA "Organise ta semaine" when the member hasn't filled this
            week's questionnaire, discreet "rempli" ack otherwise. Anti-Black-Hat
            (no streak/score). The generated calendar surface (/calendrier) is
            J-C4 — this widget routes to the questionnaire only. */}
        <section className="mb-6" aria-labelledby="calendar-widget-heading">
          <h2 id="calendar-widget-heading" className="sr-only">
            Organisation de la semaine
          </h2>
          <Suspense fallback={<CalendarStatusSkeleton />}>
            <CalendarStatusWidget userId={userId!} />
          </Suspense>
        </section>

        {/* J6 — Behavioral scores (4 gauges) */}
        <section className="mb-6" aria-labelledby="scores-heading">
          <h2 id="scores-heading" className="sr-only">
            Scores comportementaux
          </h2>
          <Suspense fallback={<ScoreGaugeGridSkeleton />}>
            <ScoreGaugeGrid score={latestScore} />
          </Suspense>
        </section>

        {/* Session 3 §28/§21 — behavioral scores OVER TIME. The gauges above
            show today; this shows the trajectory (am I progressing?). Member's
            own persisted scores only — posture §2 safe, no AI, no admin report.
            The nightly cron fills the series; <2 snapshots → calm placeholder. */}
        <section className="mb-6" aria-labelledby="score-trend-heading">
          <h2 id="score-trend-heading" className="sr-only">
            Évolution de tes scores comportementaux
          </h2>
          <Suspense fallback={<ScoreTrendChartSkeleton />}>
            <ScoreTrendSection userId={userId!} />
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

        {/* V2.3 — Pre-trade circuit breaker trigger (ADR-003 Trigger A).
            Card lime calme positioned ABOVE the Journal section so a member
            who is about to open `/journal/new` sees the "Pause 30s" prompt
            first. Non-bloquant per ADR-003 §Alt 2 — Fxmily NEVER blocks a
            trade, the wizard is a mirror. */}
        <section className="mb-6" aria-labelledby="pre-trade-heading">
          <HoverLift className="block">
            <Link
              href="/pre-trade/new"
              className="rounded-card block border border-[var(--b-acc)] bg-[var(--acc-dim)] p-5 transition-colors hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]">
                    <ShieldCheck className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="t-eyebrow text-[var(--acc)]">Pré-trade</span>
                    <h2
                      id="pre-trade-heading"
                      className="text-[15px] font-semibold text-[var(--t-1)]"
                    >
                      Pause 30 secondes avant ton prochain trade
                    </h2>
                    <p className="text-[12px] leading-relaxed text-[var(--t-2)]">
                      Un miroir de ton exécution, pas une barrière.
                    </p>
                  </div>
                </div>

                {/* §23 — les 4 questions en chips : remplissent la largeur du
                    bandeau sur grand écran (fini le creux central), wrap sous lg. */}
                <ul
                  className="flex flex-wrap items-center gap-2"
                  aria-label="Les 4 questions du pré-trade : raison, émotion, plan, stop-loss"
                >
                  {['Raison', 'Émotion', 'Plan', 'Stop-loss'].map((q) => (
                    <li
                      key={q}
                      className="rounded-pill inline-flex items-center border border-[var(--b-acc)] bg-[var(--acc-dim-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--acc)]"
                    >
                      {q}
                    </li>
                  ))}
                </ul>

                <span
                  className={cn(
                    btnVariants({ kind: 'primary', size: 'm' }),
                    'pointer-events-none shrink-0 self-start lg:self-auto',
                  )}
                >
                  Commencer
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                </span>
              </div>
            </Link>
          </HoverLift>
        </section>

        {/* Mark Douglas card (canonical TIER 4) */}
        <section
          className="mb-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]"
          aria-labelledby="journal-md-heading"
        >
          <Card primary glass className="flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <h2 id="journal-md-heading" className="t-eyebrow">
                  Journal de trading
                </h2>
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

        {/* §23 full-width — twin pre-trade analytics tiled 2-up on wide
            screens (thematic pair : execution patterns + reason×outcome
            correlation). Stack single-column below lg. */}
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {/* V2.3 ext #2 — Session HH frontend (Dashboard analytics widget pre-trade).
            Lecture honnête des patterns d'exécution sur 30j : distribution
            reasonToTrade + plan alignment rate + stoploss predefined rate.
            Server Component async (fetch direct via loadPreTradeAnalyticsData
            server-only). CSS bars natives (pas de Recharts → 0 KB JS client
            ajouté). Posture Mark Douglas neutre — `acc` lime UNIQUEMENT sur
            `edge`, `t-3` slate sur fomo/revenge/boredom (Yu-kai Chou
            anti-Black-Hat invariant : aucun rouge sur les "biais"). */}
          <PreTradeAnalyticsCard userId={userId!} />

          {/* V2.3 ext #4 — Session II frontend (différenciateur Fxmily).
            Table-compare empirique des 4 raisons (edge / fomo / revenge /
            boredom) × performance réelle (win-rate + R moyen) sur 30j.
            Server Component async (loadPreTradeCorrelationData server-only),
            grid 4-colonnes responsive, 0 Recharts / 0 Client island.
            Posture Mark Douglas STRICT : tone `acc` UNIQUEMENT sur `edge`,
            slate sur 3 autres, AUCUNE comparaison automatique. Win-rate
            JAMAIS rouge — le membre observe, ne se fait pas punir. */}
          <PreTradeCorrelationCard userId={userId!} />
        </div>

        {/* Admin section (conditional) */}
        {isAdmin ? (
          <section className="mb-6" aria-labelledby="admin-heading">
            <div className="mb-3 flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-[var(--acc)]" strokeWidth={1.75} />
              <h2 id="admin-heading" className="t-eyebrow">
                Espace admin
              </h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <HoverLift className="block">
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
              </HoverLift>
              <HoverLift className="block">
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
              </HoverLift>
              <HoverLift className="block">
                <Link href="/admin/access-requests" className="block">
                  <Card interactive className="flex items-start gap-3 p-4">
                    <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
                      <Inbox className="h-4 w-4" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="t-h3 text-[var(--t-1)]">Demandes d&apos;accès</h3>
                        {pendingAccessRequests > 0 ? (
                          <Pill tone="acc">{pendingAccessRequests}</Pill>
                        ) : null}
                      </div>
                      <p className="t-cap mt-0.5 text-[var(--t-3)]">
                        {pendingAccessRequests > 0
                          ? `${pendingAccessRequests} demande${pendingAccessRequests > 1 ? 's' : ''} en attente.`
                          : 'Valider les demandes publiques /rejoindre.'}
                      </p>
                    </div>
                    <ArrowRight
                      className="mt-1.5 h-3.5 w-3.5 shrink-0 text-[var(--t-4)]"
                      strokeWidth={1.75}
                    />
                  </Card>
                </Link>
              </HoverLift>
            </div>
          </section>
        ) : null}

        {/* J7.7 — Mark Douglas widget (replaces stale "Bibliothèque MD J7" coming-soon) */}
        <section className="mb-6" aria-label="Module Mark Douglas">
          <DouglasInboxWidget userId={session.user.id} />
        </section>

        {/* V1.8 — REFLECT module entry (replaces stale "J8 Rapport hebdo" /
            "J9 Notifications" coming-soon : J8/J9 sont LIVE, ces cartes
            étaient devenues fausses). Le module REFLECT a sa propre
            identité visuelle blue+black sur `/review` + `/reflect` (cf.
            `.v18-theme` overlay). Le widget reste en DS-v2 lime sur le
            dashboard avec un dot accent blue pour signaler la destination. */}
        <section className="mb-6" aria-label="Module REFLECT">
          <DashboardReflectWidget userId={session.user.id} />
        </section>

        {/* Session 3 — Découvrabilité du débrief mensuel. La synthèse IA
            mensuelle (/debrief-mensuel) n'était atteignable que par push / email
            / URL directe : aucun point d'entrée sur le hub. Carte calme
            anti-Black-Hat (pas de badge/streak/fanfare), posture §2 (prendre du
            recul, jamais de conseil de marché). S'auto-explique même sans
            débrief encore généré (la page porte son propre empty-state). */}
        <section className="mb-6" aria-label="Débrief mensuel">
          <HoverLift className="block">
            <Link
              href="/debrief-mensuel"
              className="rounded-card block border border-[var(--b-default)] bg-[var(--bg-2)] p-4 transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-1)] text-[var(--t-3)]">
                    <CalendarRange className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <span className="t-eyebrow text-[var(--t-3)]">Débrief mensuel</span>
                    <p className="text-[15px] font-semibold text-[var(--t-1)]">
                      Ta synthèse du mois
                    </p>
                    <p className="text-[12px] leading-relaxed text-[var(--t-3)]">
                      Progression, trading réel et entraînement — pour prendre du recul. Aucun
                      conseil de marché.
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-[var(--t-3)]" aria-hidden="true" />
              </div>
            </Link>
          </HoverLift>
        </section>

        {/* §23 full-width — TRACK + slot formation tuilés 2-up sur grand écran
            (évite les bandeaux étirés vides). TRACK reste DS-v2 lime
            (discipline forte) — pas de V18 overlay ; le slot formation reste
            muté/non-cliquable. h-full → cartes de hauteur égale. */}
        <div className="mb-6 grid items-stretch gap-4 lg:grid-cols-2">
          <section aria-label="Module TRACK" className="h-full">
            <HoverLift className="block h-full">
              <Link
                href="/track"
                className="rounded-card block h-full border border-[var(--b-default)] bg-[var(--bg-2)] p-4 transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <span className="t-eyebrow text-[var(--acc)]">Suivi des habitudes</span>
                    <p className="text-[15px] font-semibold text-[var(--t-1)]">
                      Tes 5 piliers de pratique
                    </p>
                    <p className="text-[12px] leading-relaxed text-[var(--t-3)]">
                      Sommeil, nutrition, café, sport, méditation — les conditions qui alimentent
                      ton exécution.
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 shrink-0 text-[var(--t-3)]" aria-hidden />
                </div>
              </Link>
            </HoverLift>
          </section>

          {/* V2.1.6 — Suivi-formation/cursus (#4 séquence §21.6) placeholder
            UI calme. Décision Eliot 2026-05-20 : la dépendance "projet
            pédagogie externe" est retirée ; ce slot est exposé comme
            marker non-cliquable pour les membres. L'activation V1.x se
            fera via `/spec` dédié + build séparé sur décision Eliot
            ultérieure (jamais bundlés §18.4). Tone neutre/mute,
            anti-Black-Hat : pas de teaser engageant, pas d'animation,
            pas de hover-state cliquable. */}
          <section aria-label="Module Suivi formation (à venir)" className="h-full">
            <div
              className="rounded-card flex h-full items-center gap-3 border border-[var(--b-default)] bg-[var(--bg-2)] p-4"
              aria-describedby="formation-soon-desc"
            >
              <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-1)] text-[var(--t-3)]">
                <GraduationCap className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="t-eyebrow-lg text-[var(--t-3)]">Suivi formation</span>
                  <Pill tone="mute">À venir</Pill>
                </div>
                <p
                  id="formation-soon-desc"
                  className="text-[12px] leading-relaxed text-[var(--t-3)]"
                >
                  Le module de suivi de ta progression sur la formation Fxmily arrivera plus tard.
                  On t&apos;avertira quand il sera prêt.
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* V2.1.3 — Habit × Trade correlation (the documented Fxmily
            differentiator). Replaces the stale "Corrélations bien-être"
            coming-soon card — it's LIVE now. Statistical honesty is the
            product posture (Mark Douglas) : insufficient_data state,
            sample size always visible, no fabricated coefficient. */}
        <section className="mb-6 flex flex-col gap-3" aria-labelledby="habit-corr-heading">
          <div className="flex items-center gap-2">
            <span id="habit-corr-heading" className="t-eyebrow">
              Corrélations habitudes × trading
            </span>
          </div>
          <HabitKindTabPicker
            selected={corrKind}
            labelId="habit-corr-heading"
            pathname="/dashboard"
            preservedQuery={corrPreserved}
          />
          <Suspense key={corrKind} fallback={<HabitCorrelationSkeleton />}>
            <HabitCorrelationSection userId={userId!} timezone={timezone} habitKind={corrKind} />
          </Suspense>
        </section>

        {/* Footer kbd hint */}
        <footer className="mt-8 flex items-center justify-between border-t border-[var(--b-default)] pt-4 text-[10px] text-[var(--t-4)] tabular-nums">
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

function CalendarStatusSkeleton() {
  return (
    <div
      className="skel rounded-card h-[104px] border border-[var(--b-default)] bg-[var(--bg-1)]"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement de l'organisation de la semaine"
    />
  );
}

function TodayGuidanceSkeleton() {
  return (
    <div
      className="skel rounded-card h-[280px] border border-[var(--b-default)] bg-[var(--bg-1)]"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement de ton aujourd'hui"
    />
  );
}

function ProfileStatusSkeleton() {
  return (
    <div
      className="skel rounded-card h-[116px] border border-[var(--b-default)] bg-[var(--bg-1)]"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement de ton profil"
    />
  );
}

async function ScoreTrendSection({ userId }: { userId: string }) {
  const history = await getBehavioralScoreHistory(userId, { sinceDays: 90 });
  return <ScoreTrendChart data={history} />;
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
    <div className="flex flex-col gap-1.5 border-r border-b border-[var(--b-default)] p-4 last:border-r-0 sm:border-b-0 [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r sm:[&:nth-child(2)]:border-b-0">
      <span className="t-eyebrow">{label}</span>
      <span
        className={cn(
          'f-mono text-[22px] leading-none font-semibold tracking-[-0.02em] tabular-nums',
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
