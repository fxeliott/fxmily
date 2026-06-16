import { ArrowRight, Plus, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { auth } from '@/auth';
import { CalendarStatusWidget } from '@/components/calendar/calendar-status-widget';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { FirstRunWelcome } from '@/components/dashboard/first-run-welcome';
import { JournalShortcut } from '@/components/dashboard/journal-shortcut';
import { NorthStarHero } from '@/components/dashboard/north-star-hero';
import { DashboardReflectWidget } from '@/components/dashboard/reflect-widget';
import { TodayGuidance } from '@/components/dashboard/today-guidance';
import { DouglasInboxWidget } from '@/components/library/douglas-inbox-widget';
import { ProfileStatusWidget } from '@/components/onboarding/profile-status-widget';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { HoverLift } from '@/components/ui/hover-lift';
import { Kbd } from '@/components/ui/kbd';
import { getStreak } from '@/lib/checkin/service';
import { getDailyGuidance } from '@/lib/daily-guidance/service';
import { getBehavioralScoreHistory, getLatestBehavioralScore } from '@/lib/scoring/service';
import { countTradesByStatus } from '@/lib/trades/service';
import { cn } from '@/lib/utils';

import { MarkDouglasCard } from './mark-douglas-card';

export const metadata = {
  title: 'Tableau de bord · Fxmily',
};
export const dynamic = 'force-dynamic';

const PARIS_TZ = 'Europe/Paris';

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

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = session.user.id;
  const timezone = session.user.timezone || 'Europe/Paris';

  // V2 refonte J2 — le dashboard est un HUB D'ACTION (où j'en suis / quoi faire),
  // PAS un mur d'analytics. Les surfaces rétrospectives (scores, trajectoire,
  // track record, patterns, pré-trade analytics, corrélations) ont migré vers
  // /progression + /patterns (nav « Ma progression »). On ne charge plus que les
  // données du hub : compteurs trades, streak, dernier score + trajectoire (pour
  // le hero), et le guidage du jour. `getDailyGuidance` + `getBehavioralScoreHistory`
  // lus une fois, partagés hero/TodayGuidance — pas de N+1.
  const [counts, streak, latestScore, guidance, scoreHistory] = userId
    ? await Promise.all([
        countTradesByStatus(userId),
        getStreak(userId, timezone),
        getLatestBehavioralScore(userId),
        getDailyGuidance(userId, timezone),
        getBehavioralScoreHistory(userId, { sinceDays: 90 }),
      ])
    : [{ open: 0, closed: 0 }, { current: 0, todayFilled: false, today: '' }, null, null, []];

  // North-star hero — la seule action la plus « maintenant » (primary todo first),
  // + un flag « tout fait » calme. Posture §2 / anti-Black-Hat (§31.2).
  const primaryAction =
    guidance?.actions.find((a) => a.emphasis === 'primary' && a.state === 'todo') ??
    guidance?.actions.find((a) => a.state === 'todo') ??
    null;
  const allDone = guidance !== null && !guidance.actions.some((a) => a.state === 'todo');

  const fullName = session.user.name?.trim() || session.user.email?.split('@')[0] || 'Membre';
  const firstName = fullName.split(' ')[0]!;
  const totalTrades = counts.open + counts.closed;
  // S9.1 "wave wow" — brand-new member (no trade, no streak) gets a warm,
  // animated first-run welcome instead of a wall of empty analytics.
  const isFirstRun = totalTrades === 0 && streak.current === 0;

  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      {/* DS-v3 J3 — ambient mesh + drifting orbs behind the glass panels */}
      <DashboardAmbient />
      {/* S4 DOD1-04 — makes the advertised `N` shortcut real (renders nothing) */}
      <JournalShortcut />

      <div className="relative mx-auto w-full max-w-[var(--w-app)] flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 2xl:px-12">
        {/* V2 refonte J1 — north-star hero : point focal unique (état du jour +
            prochaine action). Remplace l'ancien title-row dense et absorbe le streak. */}
        <NorthStarHero
          greeting={greeting()}
          firstName={firstName}
          dateLabel={frenchToday()}
          score={latestScore}
          history={scoreHistory}
          streak={{ current: streak.current, todayFilled: streak.todayFilled }}
          primaryAction={primaryAction}
          allDone={allDone}
        />

        {/* S9.1 — first-run welcome (new member only). */}
        {isFirstRun ? (
          <section className="mb-6" aria-labelledby="first-run-heading">
            <h2 id="first-run-heading" className="sr-only">
              Bienvenue sur Fxmily
            </h2>
            <FirstRunWelcome />
          </section>
        ) : null}

        {/* V2 refonte J1 — slim activity strip (streak dans le hero). */}
        <section className="mb-6" aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="sr-only">
            Activité de trading
          </h2>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <TradeStat label="Trades" value={totalTrades} />
            <StatDot />
            <TradeStat
              label="En cours"
              value={counts.open}
              tone={counts.open > 0 ? 'warn' : 'mute'}
            />
            <StatDot />
            <TradeStat
              label="Clôturés"
              value={counts.closed}
              tone={counts.closed > 0 ? 'ok' : 'mute'}
            />
          </div>
        </section>

        {/* Session 5 — Guidage quotidien « Ton aujourd'hui » (DoD §30 #3). Le hub
            time-aware : check-in du créneau, blocs calendrier du jour, réunion,
            QCM mindset du lundi. Full-width. Posture §2 + anti-Black-Hat. */}
        {guidance ? (
          <div className="mb-6">
            <TodayGuidance guidance={guidance} />
          </div>
        ) : null}

        {/* V2.4 — Onboarding profile status : le pont vers le profilage initial. */}
        <section className="mb-6" aria-labelledby="profile-widget-heading">
          <h2 id="profile-widget-heading" className="sr-only">
            Mon profil de trader
          </h2>
          <Suspense fallback={<ProfileStatusSkeleton />}>
            <ProfileStatusWidget userId={userId!} />
          </Suspense>
        </section>

        {/* §26 — Calendrier adaptatif : statut du questionnaire de la semaine. */}
        <section className="mb-6" aria-labelledby="calendar-widget-heading">
          <h2 id="calendar-widget-heading" className="sr-only">
            Organisation de la semaine
          </h2>
          <Suspense fallback={<CalendarStatusSkeleton />}>
            <CalendarStatusWidget userId={userId!} />
          </Suspense>
        </section>

        {/* V2.3 — Pré-trade circuit breaker (ADR-003 Trigger A). Nudge calme « pause
            30s » au-dessus du journal. Non-bloquant — un miroir, pas une barrière.
            (Les ANALYTICS pré-trade ont migré vers /patterns ; ceci est le CTA.) */}
        <section className="mb-6" aria-labelledby="pre-trade-heading">
          <HoverLift className="block">
            <Link
              href="/pre-trade/new"
              className="wow-hover-glow rounded-card block border border-[var(--b-acc)] bg-[var(--acc-dim)] p-5 transition-colors hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
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

        {/* Journal de trading (action cœur) + carte Mark Douglas (mental). */}
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

        {/* J7.7 — Mark Douglas widget (entrée bibliothèque) */}
        <section className="mb-6" aria-label="Module Mark Douglas">
          <DouglasInboxWidget userId={session.user.id} />
        </section>

        {/* V1.8 — entrée module REFLECT (revue/réflexion) */}
        <section className="mb-6" aria-label="Module REFLECT">
          <DashboardReflectWidget userId={session.user.id} />
        </section>

        {/* Footer kbd hint */}
        <footer className="mt-8 flex items-center justify-between border-t border-[var(--b-default)] pt-4 text-[10px] text-[var(--t-4)] tabular-nums">
          <span className="t-foot">Aucun conseil de marché. Discipline avant tout.</span>
          <span className="inline-flex items-center gap-1">
            <Kbd>N</Kbd>
            nouveau trade
          </span>
        </footer>
      </div>
    </main>
  );
}

// ----- Slim activity strip + Suspense skeletons -----------------------------

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

/** A single trade-count stat in the slim strip below the hero. Counts only —
 *  never P&L (posture §2). */
function TradeStat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'mute' | 'warn' | 'ok';
}) {
  const valColor =
    tone === 'ok'
      ? 'text-[var(--ok)]'
      : tone === 'warn'
        ? 'text-[var(--warn)]'
        : tone === 'mute'
          ? 'text-[var(--t-3)]'
          : 'text-[var(--t-1)]';
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className={cn(
          'f-mono text-[18px] leading-none font-semibold tracking-[-0.02em] tabular-nums',
          valColor,
        )}
      >
        {value}
      </span>
      <span className="t-cap text-[var(--t-3)]">{label}</span>
    </span>
  );
}

/** Subtle separator dot between strip stats. */
function StatDot() {
  return <span aria-hidden="true" className="h-1 w-1 rounded-full bg-[var(--b-strong)]" />;
}
