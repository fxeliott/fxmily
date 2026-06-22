import { ArrowRight, Plus, ScanSearch, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { auth } from '@/auth';
import { CalendarStatusWidget } from '@/components/calendar/calendar-status-widget';
import { MorningIntentionRecall } from '@/components/checkin/morning-intention-recall';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { FirstRunWelcome } from '@/components/dashboard/first-run-welcome';
import { JournalShortcut } from '@/components/dashboard/journal-shortcut';
import { MilestoneBanner } from '@/components/dashboard/milestone-banner';
import { MonthlyDebriefWidget } from '@/components/dashboard/monthly-debrief-widget';
import { NorthStarHero } from '@/components/dashboard/north-star-hero';
import { DashboardProgressBridge } from '@/components/dashboard/progress-bridge';
import { DashboardReflectWidget } from '@/components/dashboard/reflect-widget';
import { TodayGuidance } from '@/components/dashboard/today-guidance';
import { WeeklyInsightCard } from '@/components/dashboard/weekly-insight-card';
import { DouglasInboxWidget } from '@/components/library/douglas-inbox-widget';
import { ProfileStatusWidget } from '@/components/onboarding/profile-status-widget';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { HoverGlowLift } from '@/components/ui/hover-glow-lift';
import { HoverLift } from '@/components/ui/hover-lift';
import { Kbd } from '@/components/ui/kbd';
import { getCheckin, getStreak, todayFor } from '@/lib/checkin/service';
import { getTodayMilestone } from '@/lib/checkin/milestone';
import { getDailyGuidance } from '@/lib/daily-guidance/service';
import { getProcessObjectives } from '@/lib/objectives/service';
import { getBehavioralScoreHistory, getLatestBehavioralScore } from '@/lib/scoring/service';
import { countTradesByStatus } from '@/lib/trades/service';
import { cn } from '@/lib/utils';
import { getLatestConstancyScore } from '@/lib/verification/constancy';
import { countOpenDiscrepancies } from '@/lib/verification/service';

import { MarkDouglasCard } from './mark-douglas-card';

export const metadata = {
  title: 'Tableau de bord',
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
  const [
    counts,
    streak,
    latestScore,
    guidance,
    scoreHistory,
    constancy,
    openDiscrepancies,
    morningCheckin,
    objectives,
  ] = userId
    ? await Promise.all([
        countTradesByStatus(userId),
        getStreak(userId, timezone),
        getLatestBehavioralScore(userId),
        getDailyGuidance(userId, timezone),
        getBehavioralScoreHistory(userId, { sinceDays: 90 }),
        // S4 — the S3 outputs surface ON the hub (constancy teaser + open
        // discrepancies bridge to /verification). Read once here, no N+1.
        getLatestConstancyScore(userId),
        countOpenDiscrepancies(userId),
        // S12 — today's morning check-in, only to echo the member's own
        // intention back to them (day-loop close). Indexed (userId,date,slot).
        getCheckin(userId, todayFor(timezone), 'morning'),
        // S19 — process-objectives view (tier / journey / ETA / focus lever) to
        // surface the "where am I / where am I going / what to work on" bridge on
        // the hub. Run IN this parallel batch (no added wall-clock; it re-reads
        // some score/streak/guidance rows concurrently — acceptable on a small
        // cohort, all indexed). The full roadmap stays on /objectifs.
        getProcessObjectives(userId, timezone),
      ])
    : [
        { open: 0, closed: 0 },
        { current: 0, todayFilled: false, today: '' },
        null,
        null,
        [],
        null,
        0,
        null,
        null,
      ];

  // North-star hero — la seule action la plus « maintenant » (primary todo first),
  // + un flag « tout fait » calme. Posture §2 / anti-Black-Hat (§31.2).
  const primaryAction =
    guidance?.actions.find((a) => a.emphasis === 'primary' && a.state === 'todo') ??
    guidance?.actions.find((a) => a.state === 'todo') ??
    null;
  const allDone = guidance !== null && !guidance.actions.some((a) => a.state === 'todo');

  // Complétude du jour (anneau hero) : fraction des gestes ACTIONNABLES faits.
  // Les actions 'info' (ni à faire ni faites — ex. réunion) sont exclues du
  // dénominateur, sinon le ratio mentirait. Jamais rendu si 0 actionnable.
  const dayActions = guidance ? guidance.actions.filter((a) => a.state !== 'info') : [];
  const dayProgress =
    dayActions.length > 0
      ? { done: dayActions.filter((a) => a.state === 'done').length, total: dayActions.length }
      : null;

  const fullName = session.user.name?.trim() || session.user.email?.split('@')[0] || 'Membre';
  const firstName = fullName.split(' ')[0]!;
  const totalTrades = counts.open + counts.closed;
  // S11 — did TODAY's check-in land the streak exactly on a 7/14/30/100 anchor?
  // Pure + synchronous (no extra DB) ; drives both the hero StreakCard halo and
  // the dismissible MilestoneBanner. Anti-Black-Hat: calm, one day only.
  const todayMilestone = getTodayMilestone({
    current: streak.current,
    todayFilled: streak.todayFilled,
  });
  // S9.1 "wave wow" — brand-new member (no trade, no streak) gets a warm,
  // animated first-run welcome instead of a wall of empty analytics.
  const isFirstRun = totalTrades === 0 && streak.current === 0;

  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      {/* DS-v3 J3 — ambient mesh + drifting orbs behind the glass panels */}
      <DashboardAmbient />
      {/* S4 DOD1-04 — makes the advertised `N` shortcut real (renders nothing) */}
      <JournalShortcut />

      <div className="dash-stagger relative mx-auto w-full max-w-[var(--w-app)] flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 2xl:px-12">
        {/* V2 refonte J1 — north-star hero : point focal unique (état du jour +
            prochaine action). Remplace l'ancien title-row dense et absorbe le streak. */}
        <NorthStarHero
          greeting={greeting()}
          firstName={firstName}
          dateLabel={frenchToday()}
          score={latestScore}
          history={scoreHistory}
          streak={{
            current: streak.current,
            todayFilled: streak.todayFilled,
            justCrossed: todayMilestone,
          }}
          primaryAction={primaryAction}
          allDone={allDone}
          dayProgress={dayProgress}
        />

        {/* S11 — calm streak-milestone celebration, only on the crossing day.
            Mutually exclusive with first-run (milestone ⇒ streak ≥ 7). */}
        {todayMilestone ? (
          <section className="mb-6" aria-label="Palier de régularité franchi">
            <MilestoneBanner milestone={todayMilestone} streak={streak.current} />
          </section>
        ) : null}

        {/* S9.1 — first-run welcome (new member only). */}
        {isFirstRun ? (
          <section className="mb-6" aria-labelledby="first-run-heading">
            <h2 id="first-run-heading" className="sr-only">
              Bienvenue sur Fxmily
            </h2>
            <FirstRunWelcome />
          </section>
        ) : null}

        {/* S19 — « Maintenant » : la liste du jour (remontée de la 7e position, où
            elle était noyée) + le pont parcours (palier / ETA / levier du moment)
            placés directement sous le hero → « quoi faire » et « où j'en suis /
            où je vais / sur quoi bosser » répondus dès l'arrivée sur le hub. */}
        {guidance ? (
          <div className="mb-6">
            <TodayGuidance guidance={guidance} />
          </div>
        ) : null}
        {objectives ? (
          <section className="mb-6" aria-label="Ta progression">
            <DashboardProgressBridge view={objectives} />
          </section>
        ) : null}

        {/* V2 refonte J1 — slim activity strip (streak dans le hero). S18 — passée
            de spans nus à 3 mini-cartes acc-dim vivantes (AnimatedNumber + micro
            count-up). 3 stats MAX, jamais de P&L brut (posture §2) : un compteur
            d'activité, pas un mur d'analytics. Hover lift premium sur chacune. */}
        <section className="mb-6" aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="sr-only">
            Activité de trading
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {/* S19.1 — indigo data tint (--acc-2) for the non-actionable count,
                freeing the blue (--acc) for genuine CTAs (mono-accent). */}
            <TradeStatCard label="Trades" value={totalTrades} tone="acc2" />
            <TradeStatCard
              label="En cours"
              value={counts.open}
              tone={counts.open > 0 ? 'warn' : 'mute'}
            />
            <TradeStatCard
              label="Clôturés"
              value={counts.closed}
              tone={counts.closed > 0 ? 'ok' : 'mute'}
            />
          </div>
        </section>

        {/* S12 — echo the member's OWN morning intention back during the day
            (day-loop close). Read-only, renders nothing if no intention set. */}
        <MorningIntentionRecall intention={morningCheckin?.intention} className="mb-6" />

        {/* D — Insight hebdo déterministe (aha-moment, SPEC §7.5). Lecture PURE
            des 7 derniers scores comportementaux du membre (pas d'IA). Intégrité
            statistique : sous le seuil de jours notés → état vide pédagogique,
            jamais un constat fabriqué. Anti-Black-Hat : constat factuel + un
            micro-encouragement Mark Douglas, jamais de verdict punitif. */}
        <WeeklyInsightCard history={scoreHistory} className="mb-6" />

        {/* S3/S4 — Découvrabilité de la surface Vérification (SPEC §33) + teaser
            constance. Carte calme anti-Black-Hat (§33.2) : la confrontation
            déclaré ↔ réalité MT5 est un outil de lucidité, pas une sanction.
            Restaurée sur le hub dé-densifié = le pont dashboard → /verification
            (copy honnête §33.6, score absent tant que non confronté). */}
        <section className="mb-6" aria-label="Vérification">
          <HoverLift className="block">
            <Link
              href="/verification"
              className="rounded-card block border border-[var(--b-default)] bg-[var(--bg-2)] p-4 transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-1)] text-[var(--t-3)]">
                    <ScanSearch className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <span className="t-eyebrow text-[var(--t-3)]">Vérification</span>
                    <p className="text-[15px] font-semibold text-[var(--t-1)]">
                      Ta réalité de trading
                    </p>
                    <p className="text-[12px] leading-relaxed text-[var(--t-3)]">
                      Tes comptes, tes preuves MT5 et ton déclaré mis en face de ton historique
                      réel. Se voir tel qu&apos;on est, pour progresser.
                    </p>
                    {openDiscrepancies > 0 ? (
                      <p className="text-[12px] font-medium text-[var(--t-2)]">
                        {openDiscrepancies} écart{openDiscrepancies > 1 ? 's' : ''} à regarder
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {/* S4 — constancy teaser. Honesty rule §33.5 : no score until
                      the member has been confronted at least once (no fake 100). */}
                  {constancy ? (
                    <div className="flex flex-col items-end">
                      <span className="font-mono text-[22px] leading-none font-bold text-[var(--t-1)] tabular-nums">
                        <AnimatedNumber value={Math.round(constancy.value)} />
                        <span className="text-[12px] font-medium text-[var(--t-4)]">/100</span>
                      </span>
                      <span className="t-foot mt-1 text-[var(--t-4)]">constance</span>
                    </div>
                  ) : null}
                  <ArrowRight className="h-5 w-5 shrink-0 text-[var(--t-3)]" aria-hidden="true" />
                </div>
              </div>
            </Link>
          </HoverLift>
        </section>

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

        {/* §30 — guidage calme vers le débrief mensuel frais (S6 audit). Le widget
            rend sa propre section (avec heading) ou rien si tout est déjà lu :
            fallback null pour ne jamais flasher un skeleton qui disparaît. */}
        <Suspense fallback={null}>
          <MonthlyDebriefWidget userId={userId!} />
        </Suspense>

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
                    {/* S15 #25 — --acc-hi (not --acc) clears WCAG 1.4.3 AA on the
                        --acc-dim fill (--acc is ~3.15:1 on tinted surfaces). */}
                    <span className="t-eyebrow text-[var(--acc-hi)]">Pré-trade</span>
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
                      className="rounded-pill inline-flex items-center border border-[var(--b-acc)] bg-[var(--acc-dim-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--acc-hi)]"
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

        {/* J7.7 — Mark Douglas widget (entrée bibliothèque). S15 #20 — Suspense
            like its neighbours (profile/calendar/monthly) so its 2 queries no
            longer block the hub's first flush (the hero streams ahead). */}
        <section className="mb-6" aria-label="Module Mark Douglas">
          <Suspense fallback={<DouglasInboxSkeleton />}>
            <DouglasInboxWidget userId={session.user.id} />
          </Suspense>
        </section>

        {/* V1.8 — entrée module REFLECT (revue/réflexion). S15 #20 — Suspense. */}
        <section className="mb-6" aria-label="Module REFLECT">
          <Suspense fallback={<ReflectWidgetSkeleton />}>
            <DashboardReflectWidget userId={session.user.id} />
          </Suspense>
        </section>

        {/* Footer kbd hint. S13 — `data-slot` + sm-stack: the Log-Express FAB
            (fixed bottom-right, z-40) was occluding the right-aligned "N nouveau
            trade" hint at 1024–1599px. Below sm the row stacks (hint on its own
            left-aligned line, never reaches the FAB); ≥640px a :has() clearance
            in globals.css adds padding-right. Mirrors the legal-footer rule. */}
        <footer
          data-slot="dashboard-footer-inner"
          className="mt-8 flex flex-col gap-1.5 border-t border-[var(--b-default)] pt-4 text-[10px] text-[var(--t-4)] tabular-nums sm:flex-row sm:items-center sm:justify-between sm:gap-2"
        >
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

/** S15 #20 — Mark Douglas inbox skeleton. Single card band approximating the
 *  widget's p-5 Card (header + ~3 delivery rows) to keep CLS minimal. */
function DouglasInboxSkeleton() {
  return (
    <div
      className="skel rounded-card-lg h-[196px] border border-[var(--b-default)] bg-[var(--bg-1)]"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement du module Mark Douglas"
    />
  );
}

/** S15 #20 — REFLECT skeleton. Mirrors the widget's 2-up grid (eyebrow + two
 *  ~128px doorway cards) so the layout doesn't shift when it streams in. */
function ReflectWidgetSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" aria-label="Chargement du module REFLECT">
      <div className="skel mb-3 h-3 w-32 rounded-full" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="skel rounded-card-lg h-[128px] border border-[var(--b-default)] bg-[var(--bg-1)]" />
        <div className="skel rounded-card-lg h-[128px] border border-[var(--b-default)] bg-[var(--bg-1)]" />
      </div>
    </div>
  );
}

/** A single trade-count mini-card in the activity strip below the hero (S18).
 *  Counts only — never P&L (posture §2). A solid tinted surface (NOT glass) so
 *  the HoverGlowLift's spring lift + colored halo can apply (compositor-only).
 *  `acc2` = indigo data tint for non-actionable counts (S19.1 — frees the blue
 *  --acc for genuine CTAs / mono-accent) ; `ok`/`warn` reuse the existing tone
 *  semantics (clôturés vert calme, en-cours ambre) without ever recolouring a P&L. */
function TradeStatCard({
  label,
  value,
  tone = 'acc',
}: {
  label: string;
  value: number;
  tone?: 'acc' | 'acc2' | 'mute' | 'warn' | 'ok';
}) {
  // Surface tint + value colour pairs. All token-driven so they flip in light.
  const surface =
    tone === 'ok'
      ? 'border-[var(--ok-edge)] bg-[var(--ok-dim)]'
      : tone === 'warn'
        ? 'border-[var(--warn-edge)] bg-[var(--warn-dim)]'
        : tone === 'mute'
          ? 'border-[var(--b-default)] bg-[var(--bg-1)]'
          : tone === 'acc2'
            ? 'border-[var(--acc-2-edge)] bg-[var(--acc-2-dim)]'
            : 'border-[var(--b-acc)] bg-[var(--acc-dim)]';
  const valColor =
    tone === 'ok'
      ? 'text-[var(--ok)]'
      : tone === 'warn'
        ? 'text-[var(--warn)]'
        : tone === 'mute'
          ? 'text-[var(--t-2)]'
          : tone === 'acc2'
            ? 'text-[var(--t-1)]'
            : 'text-[var(--t-1)]';
  const glowTone = tone === 'ok' ? 'cy' : tone === 'mute' || tone === 'acc2' ? 'indigo' : 'acc';
  return (
    <HoverGlowLift
      tone={glowTone}
      className={cn(
        'rounded-card flex flex-col items-start gap-1 border p-3.5 transition-colors',
        surface,
      )}
    >
      <AnimatedNumber
        value={value}
        className={cn(
          'f-mono text-[26px] leading-none font-bold tracking-[-0.03em] tabular-nums',
          valColor,
        )}
      />
      <span className="t-cap text-[var(--t-3)]">{label}</span>
    </HoverGlowLift>
  );
}
