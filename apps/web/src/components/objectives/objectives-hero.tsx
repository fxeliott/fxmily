import { ArrowRight, Sparkles, Target } from 'lucide-react';
import Link from 'next/link';

import { AnimatedNumber } from '@/components/ui/animated-number';
import { Sparkline } from '@/components/ui/sparkline';
import { btnVariants } from '@/components/ui/btn';
import type { ProcessObjectivesView } from '@/lib/objectives/service';
import { cn } from '@/lib/utils';

/**
 * Hero « Où je vais » (jalon J4). Établit la destination d'un coup d'œil :
 * À GAUCHE « ton cap aujourd'hui » (score composite + palier + micro-trajectoire),
 * À DROITE « ta prochaine étape » + l'action la plus utile en CTA. Carbone la
 * structure de `NorthStarHero` (glass + glow, 2 colonnes). Présentationnel :
 * reçoit la vue déjà calculée. Posture §2 : jamais de P&L, ton calme.
 */
export function ObjectivesHero({ view }: { view: ProcessObjectivesView }) {
  const { cap, capTier, trajectory, nextActions, journey } = view;
  const sparkData = trajectory.history.slice(-14).map((p) => p.value);
  const nextStage = journey.find((s) => !s.reached) ?? journey[journey.length - 1]!;
  const allMastered = journey.every((s) => s.reached);
  const primaryAction = nextActions.find((a) => a.state === 'todo') ?? nextActions[0] ?? null;

  return (
    // S18 — `.wow-hover-glow` (halo ::after, opacité-seule, compositor-safe) donne
    // une affordance de survol premium SANS lift : on n'applique JAMAIS de
    // transform à une surface glass (conflit backdrop-filter, cf. HoverGlowLift).
    <div className="glass-panel glow-edge wow-hover-glow rounded-card-lg relative grid gap-5 overflow-hidden p-5 lg:grid-cols-[1.5fr_1fr] lg:gap-7 lg:p-7">
      {/* ── Gauche : ton cap aujourd'hui ── */}
      <div className="flex flex-col gap-3">
        <span className="t-eyebrow text-[var(--t-3)]">Où j’en suis aujourd’hui</span>
        <div className="flex items-end gap-3">
          <span className="f-display text-[clamp(2.75rem,2.2rem+2.4vw,4rem)] leading-[0.95] font-bold tracking-[-0.03em] text-[var(--t-1)] tabular-nums">
            {cap !== null ? <AnimatedNumber value={cap} /> : '—'}
          </span>
          <span className="t-h3 mb-1.5 text-[var(--t-4)]">/ 100</span>
          <span
            className={cn(
              'mb-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold',
              cap !== null && cap >= 85
                ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc-hi)]'
                : 'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-2)]',
            )}
          >
            {capTier.label}
          </span>
        </div>

        {sparkData.length >= 2 ? (
          <div className="flex items-center gap-3">
            <Sparkline
              data={sparkData}
              width={180}
              height={40}
              fill
              showLastDot
              ariaLabel={`Trajectoire récente de ta discipline sur ${sparkData.length} jours`}
            />
            <span className="t-cap text-[var(--t-4)]">
              {trajectory.trend === 'up'
                ? 'En progression'
                : trajectory.trend === 'down'
                  ? 'Léger repli, rien d’alarmant'
                  : 'Stable'}
            </span>
          </div>
        ) : (
          <p className="t-cap max-w-[40ch] text-[var(--t-4)]">
            Ta micro-trajectoire apparaît dès tes premiers jours de scores.
          </p>
        )}

        <p className="t-body max-w-[52ch] text-[var(--t-2)]">
          Ta destination, c’est la <strong className="text-[var(--t-1)]">Maîtrise</strong> : un
          process qui tient tout seul. On vise ce que tu contrôles, le résultat suit.
        </p>
      </div>

      {/* ── Droite : ta prochaine étape ── */}
      <div className="rounded-card flex flex-col gap-3 border border-[var(--b-acc)] bg-[var(--acc-dim-2)] p-4 lg:p-5">
        <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--acc-hi)]">
          {allMastered ? (
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Target className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          )}
          {allMastered ? 'Palier atteint' : 'Ta prochaine étape'}
        </span>
        <span className="t-h2 text-[var(--t-1)]">{allMastered ? 'Maîtrise' : nextStage.label}</span>
        <p className="t-cap leading-snug text-[var(--t-2)]">{nextStage.caption}</p>

        {primaryAction ? (
          <Link
            href={primaryAction.href}
            className={cn(btnVariants({ kind: 'primary', size: 'm' }), 'wow-hover-glow group mt-1')}
          >
            <span className="truncate">{primaryAction.title}</span>
            <ArrowRight
              className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
              strokeWidth={2}
              aria-hidden="true"
            />
          </Link>
        ) : (
          <Link
            href="/dashboard"
            className={cn(btnVariants({ kind: 'secondary', size: 'm' }), 'mt-1')}
          >
            Voir mon tableau de bord
          </Link>
        )}
      </div>
    </div>
  );
}
