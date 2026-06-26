import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Brain,
  CalendarRange,
  Check,
  ClipboardList,
  Minus,
  Moon,
  ScanSearch,
  ShieldCheck,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { StreakCard } from '@/components/checkin/streak-card';
import { Card } from '@/components/ui/card';
import { InfoDot } from '@/components/ui/info-dot';
import { Sparkline } from '@/components/ui/sparkline';
import type { GuidanceAction, GuidanceKind } from '@/lib/daily-guidance/service';
import type { BehavioralScoreTrendPoint, SerializedBehavioralScore } from '@/lib/scoring/service';
import type { SessionPhase } from '@/lib/session-routine/phase';
import { cn } from '@/lib/utils';

/** The three phases during which the trading session is LIVE (12h–20h Paris).
 *  Only these reach the hero as a focal — `before`/`closed` keep the admin CTA. */
type TradingPhase = Extract<SessionPhase, 'analysis' | 'execution' | 'management'>;

/** Calm, non-aggressive glyph per live phase (no crosshair/target — §2/§31.2). */
const PHASE_ICON: Record<TradingPhase, LucideIcon> = {
  analysis: ScanSearch,
  execution: Activity,
  management: ShieldCheck,
};

import { DailyCompletionRing } from './daily-completion-ring';

/**
 * V2 refonte — J1 "north-star hero" : le panneau d'en-tête du dashboard
 * membre. Il remplace l'ancien title-row + absorbe le streak, et établit
 * un point focal unique : « où j'en suis » (trajectoire discipline calme +
 * streak) À GAUCHE, « ma prochaine action » en CTA proéminent À DROITE.
 *
 * Server Component présentationnel pur : toutes les données arrivent en
 * props (déjà fetchées une seule fois au niveau page — pas de double-fetch).
 * Seul `Sparkline` est un îlot client ('use client').
 *
 * Posture §2 + anti-Black-Hat (§31.2, BLOQUANT) :
 *  - le score discipline n'est JAMAIS rouge ni punitif ; une trajectoire en
 *    repli reste en ton muté `--t-3`, jamais une alarme ;
 *  - le streak réutilise `StreakCard` (mercy infrastructure, pas de culpabilité) ;
 *  - la prochaine action est calme : pas de countdown, pas de « pas fait » rouge.
 */

const KIND_ICON: Record<GuidanceKind, LucideIcon> = {
  checkin: Sun,
  meeting: Users,
  mindset: Brain,
  questionnaire: CalendarRange,
  douglas: BookOpen,
  tracking: ClipboardList,
};

type Trend = 'up' | 'flat' | 'down';

function trendOf(points: number[]): Trend | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return null;
  const delta = last - first;
  if (delta >= 2) return 'up';
  if (delta <= -2) return 'down';
  return 'flat';
}

const TREND_META: Record<
  Trend,
  { Icon: LucideIcon; label: string; tone: string; srLabel: string }
> = {
  // `up` is the only accent-toned state. `down` is deliberately muted (never
  // red, never alarmist) — the member observes a trajectory, isn't punished.
  up: {
    Icon: ArrowUpRight,
    label: 'en progression',
    tone: 'text-[var(--acc)]',
    srLabel: 'Tendance en hausse',
  },
  flat: {
    Icon: Minus,
    label: 'stable',
    tone: 'text-[var(--t-3)]',
    srLabel: 'Tendance stable',
  },
  down: {
    Icon: ArrowDownRight,
    label: 'en repli',
    tone: 'text-[var(--t-3)]',
    srLabel: 'Tendance en repli',
  },
};

function TrendBadge({ trend }: { trend: Trend }) {
  const { Icon, label, tone, srLabel } = TREND_META[trend];
  return (
    <span className={cn('mb-0.5 inline-flex items-center gap-1 text-[12px] font-medium', tone)}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      <span>{label}</span>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}

/** The single most-"now" action, rendered as a calm, prominent hero CTA.
 *  Posture §2 : no countdown, no pressure — an invitation, not a command. */
function HeroNextActionCard({ action }: { action: GuidanceAction }) {
  // Inline icon lookup (capitalised var, no helper-call) to satisfy the
  // react-hooks/static-components lint — same convention as today-guidance's
  // ActionRow. Check-in derives its glyph from the slot (evening → Moon).
  const Icon =
    action.kind === 'checkin'
      ? action.key.endsWith('evening')
        ? Moon
        : Sun
      : KIND_ICON[action.kind];
  return (
    <Link
      href={action.href}
      data-slot="hero-next-action"
      data-kind={action.kind}
      className="wow-hover-glow rounded-card group flex items-center gap-3.5 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-4 transition-colors hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
    >
      <span className="rounded-control grid h-11 w-11 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] leading-tight font-semibold text-[var(--t-1)]">
          {action.title}
        </span>
        <span className="t-cap line-clamp-2 leading-snug text-[var(--t-2)]">{action.detail}</span>
      </span>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-[var(--acc)] transition-transform group-hover:translate-x-0.5"
        strokeWidth={2}
        aria-hidden="true"
      />
    </Link>
  );
}

/** S25 #1 — the LIVE trading moment, rendered as the hero's focal during the
 *  session hours so the "now" thread is contextual to the trading clock (not an
 *  admin task). Informational (not a link) — the actual CTAs (log a trade,
 *  check-in) stay available below; this just says WHICH moment of the method's
 *  day it is. Posture §2 : the copy is pure process/discipline. §31.2 : calm,
 *  no countdown, no red — the same `--acc-dim` calm surface as the next-action. */
function HeroSessionFocus({
  focus,
}: {
  focus: { headline: string; line: string; phase: TradingPhase };
}) {
  const Icon = PHASE_ICON[focus.phase];
  return (
    <div
      data-slot="hero-session-focus"
      data-phase={focus.phase}
      className="rounded-card flex items-start gap-3.5 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-4"
    >
      <span className="rounded-control grid h-11 w-11 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] leading-tight font-semibold text-[var(--t-1)]">
          {focus.headline}
        </span>
        <span className="t-cap leading-snug text-[var(--t-2)]">{focus.line}</span>
      </span>
    </div>
  );
}

/** S25 #1 — when the session focus owns the hero, an outstanding admin action is
 *  demoted to a quiet secondary line (never lost, never competing for the eye).
 *  §31.2 : muted tone, no red, no "en retard". */
function HeroSecondaryAction({ action }: { action: GuidanceAction }) {
  return (
    <Link
      href={action.href}
      data-slot="hero-secondary-action"
      data-kind={action.kind}
      className="rounded-control inline-flex w-fit items-center gap-1.5 px-1 py-1 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
    >
      <span className="text-[var(--t-4)]">Aussi à faire :</span>
      <span className="font-medium">{action.title}</span>
      <ArrowRight className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
    </Link>
  );
}

interface NorthStarHeroProps {
  greeting: string;
  firstName: string;
  dateLabel: string;
  score: SerializedBehavioralScore | null;
  history: BehavioralScoreTrendPoint[];
  streak: { current: number; todayFilled: boolean; justCrossed?: number | null };
  /** The single most-"now" action to surface (already chosen by the page). */
  primaryAction: GuidanceAction | null;
  /** True when no `todo` action remains for the current slot. */
  allDone: boolean;
  /** Today's actionable-guidance completion (done/total, excl. `info`), or null. */
  dayProgress: { done: number; total: number } | null;
  /** S25 #1 — when the trading session is LIVE (12h–20h Paris), the calm process
   *  moment of the method's day. It becomes the hero focal so the "now" thread is
   *  contextual to the trading clock; the admin `primaryAction` is then demoted to
   *  a quiet secondary line. Null off-hours → unchanged behaviour. */
  sessionFocus: { headline: string; line: string; phase: TradingPhase } | null;
}

export function NorthStarHero({
  greeting,
  firstName,
  dateLabel,
  score,
  history,
  streak,
  primaryAction,
  allDone,
  dayProgress,
  sessionFocus,
}: NorthStarHeroProps) {
  const disciplinePoints = history.map((p) => p.discipline).filter((n): n is number => n !== null);
  const disciplineValue = score?.disciplineScore ?? null;
  const trend = trendOf(disciplinePoints);
  const hasSpark = disciplinePoints.length >= 2;

  // Standing reflects the ACTION state (the hero's purpose), decoupled from the
  // score readiness : a member can have 100 trades yet no score snapshot yet, so
  // "s'active dès tes premiers trades" would be wrong. The discipline block below
  // owns the score-null messaging. Posture §2 : an invitation, never pressure.
  const standing = primaryAction
    ? 'Une action t’attend pour rester sur ta ligne.'
    : allDone
      ? 'Tu es à jour pour ce moment de la journée. La discipline, un pas à la fois.'
      : 'Ton tableau de bord s’active dès tes premiers check-ins et trades clôturés.';

  return (
    <section aria-labelledby="hero-greeting" className="mb-6">
      <Card
        primary
        glass
        edge={false}
        className="dash-hero relative overflow-hidden p-6 backdrop-blur-[16px] backdrop-saturate-150 lg:p-8"
      >
        <div className="relative grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-center lg:gap-8">
          {/* ---- LEFT — état du jour ---- */}
          <div className="flex flex-col gap-4">
            <div className="t-eyebrow flex items-center gap-2">
              <span>{dateLabel}</span>
            </div>
            <h1
              id="hero-greeting"
              className="f-display h-rise leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)]"
              style={{
                fontFeatureSettings: '"ss01" 1',
                fontSize: 'clamp(1.875rem, 1.5rem + 1.6vw, 2.5rem)',
              }}
            >
              {greeting} {firstName}.
            </h1>
            <p className="t-lead max-w-[46ch]">{standing}</p>

            {/* Discipline trajectory + streak — calm, never punitive. */}
            <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-4">
              <div className="flex flex-col gap-1.5">
                <span className="t-eyebrow inline-flex items-center gap-1 text-[var(--t-3)]">
                  Discipline
                  <InfoDot
                    label="le score de discipline"
                    side="top"
                    tip="La discipline mesure ta régularité de process — check-ins tenus, plan respecté, exécution complète — sur une échelle de 0 à 100. Elle monte avec la constance, jamais avec ton profit."
                  />
                </span>
                <div className="flex items-end gap-2.5">
                  <span className="f-mono text-[28px] leading-none font-bold tracking-[-0.03em] text-[var(--t-1)] tabular-nums">
                    {disciplineValue === null ? '—' : disciplineValue}
                    {disciplineValue !== null ? (
                      <span className="text-[15px] font-medium text-[var(--t-3)]">/100</span>
                    ) : null}
                  </span>
                  {trend ? <TrendBadge trend={trend} /> : null}
                </div>
                {hasSpark ? (
                  <Sparkline
                    data={disciplinePoints}
                    width={180}
                    height={34}
                    fill
                    showLastDot
                    color="var(--acc)"
                    className="mt-1"
                    ariaLabel={`Trajectoire de ton score discipline : ${disciplinePoints.length} relevés, de ${disciplinePoints[0]} à ${disciplinePoints[disciplinePoints.length - 1]} sur 100.`}
                  />
                ) : (
                  <span className="t-cap mt-1 text-[var(--t-3)]">
                    {disciplineValue === null
                      ? 'En préparation'
                      : 'Trajectoire dès quelques jours de recul'}
                  </span>
                )}
              </div>

              <div
                aria-hidden="true"
                className="hidden h-12 w-px self-center bg-[var(--b-default)] sm:block"
              />

              <StreakCard
                streak={streak.current}
                todayFilled={streak.todayFilled}
                justCrossed={streak.justCrossed ?? null}
                compact
              />

              {dayProgress && dayProgress.total > 0 ? (
                <>
                  <div
                    aria-hidden="true"
                    className="hidden h-12 w-px self-center bg-[var(--b-default)] sm:block"
                  />
                  <DailyCompletionRing done={dayProgress.done} total={dayProgress.total} />
                </>
              ) : null}
            </div>
          </div>

          {/* ---- RIGHT — prochaine étape / moment de session ---- */}
          <div className="flex flex-col gap-2.5">
            {/* S25 #1 — during the live session the eyebrow + focal track the
                trading clock ("En ce moment"); off-hours it's the next admin step. */}
            <span className="t-eyebrow text-[var(--t-3)]">
              {sessionFocus ? 'En ce moment' : 'Prochaine étape'}
            </span>
            {sessionFocus ? (
              <>
                <HeroSessionFocus focus={sessionFocus} />
                {primaryAction ? <HeroSecondaryAction action={primaryAction} /> : null}
              </>
            ) : primaryAction ? (
              <HeroNextActionCard action={primaryAction} />
            ) : (
              <div className="rounded-card flex items-center gap-3.5 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
                <span className="rounded-control grid h-11 w-11 shrink-0 place-items-center border border-[var(--b-default)] text-[var(--ok)]">
                  <Check className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] leading-tight font-semibold text-[var(--t-1)]">
                    Tu es à jour
                  </span>
                  <span className="t-cap leading-snug text-[var(--t-3)]">
                    Rien d’urgent pour ce moment — avance à ton rythme.
                  </span>
                </span>
              </div>
            )}
            <Link
              href="/journal/new"
              className="inline-flex min-h-[24px] w-fit items-center gap-1 py-1 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            >
              Logger un trade
              <ArrowRight className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </Card>
    </section>
  );
}
