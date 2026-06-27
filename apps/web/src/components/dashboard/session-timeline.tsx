import { Check, Moon } from 'lucide-react';

import { SESSION_STEPS, sessionStepIndex } from '@/lib/session-routine/phase';
import type { SessionRoutine } from '@/lib/session-routine/service';
import { cn } from '@/lib/utils';

/**
 * SessionTimeline (S24) — la "journée-type trader" : matérialise la routine
 * horaire CANONIQUE de la méthode d'Eliott (analyse 12-13h → exécution 13-16h →
 * gestion 16-20h → coupure 20h) comme un fil conducteur ACTIF sur le dashboard,
 * et y accroche, calmement, la discipline du jour du membre.
 *
 * POURQUOI (gap critique #1, audit S24). Le guidage existant ("Ton aujourd'hui",
 * `daily-guidance`) orchestre les check-ins/réunions/mindset, mais la routine de
 * SESSION — le cœur opérationnel de la méthode, ce qui permet à l'app de "guider
 * le membre qui ne fait rien de lui-même" heure par heure — n'était nulle part.
 * Ce composant la rend visible et vivante : le membre ouvre l'app et sait
 * exactement OÙ il en est dans SA journée de trader.
 *
 * POSTURE §2 (BLOQUANT) + anti-Black-Hat (§31.2). Tout est PROCESS/discipline/
 * psychologie — jamais un conseil de marché. La fenêtre d'exécution ne dit
 * jamais "entre", seulement "si ton process est complet". La discipline du jour
 * (1 trade/jour, coupure 20h, 1 SL = journée finie) est restituée en MIROIR
 * calme à la Mark Douglas : aucun rouge punitif, aucun countdown anxiogène.
 *
 * Server Component (présentationnel, DB-free) : il consomme `getSessionRoutine`
 * déjà lu une fois sur le dashboard (`page.tsx`).
 */

const PHASE_TONE: Record<string, { dot: string; ring: string }> = {
  // active step — calm blue accent (the "now" of the routine)
  active: { dot: 'bg-[var(--acc)] text-[var(--acc-fg)]', ring: 'ring-2 ring-[var(--b-acc)]' },
};

export function SessionTimeline({
  routine,
  className = '',
}: {
  routine: SessionRoutine;
  className?: string;
}) {
  const { phase, guidance, day } = routine;
  const activeIdx = sessionStepIndex(phase); // -1 before the session opens

  // --- Discipline du jour : calm, method-framed notes (never punitive) -------
  // 1 trade/jour : 0 = neutre (rien encore), 1 = aligné (calme), ≥2 = rappel doux.
  const tradeTone =
    day.tradesEnteredToday >= 2 ? 'warn' : day.tradesEnteredToday === 1 ? 'ok' : 'mute';
  const tradeChipSurface =
    tradeTone === 'warn'
      ? 'border-[var(--warn-edge)] bg-[var(--warn-dim)] text-[var(--warn)]'
      : tradeTone === 'ok'
        ? 'border-[var(--ok-edge)] bg-[var(--ok-dim)] text-[var(--ok)]'
        : 'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]';
  const tradeChipLabel =
    day.tradesEnteredToday === 0
      ? 'Aucun trade aujourd’hui'
      : `${day.tradesEnteredToday} trade${day.tradesEnteredToday > 1 ? 's' : ''} aujourd’hui`;
  const tradeChipHint =
    day.tradesEnteredToday >= 2
      ? 'La méthode vise un seul trade par jour — un seul risque ouvert.'
      : day.tradesEnteredToday === 1
        ? 'Un trade, comme la méthode le demande.'
        : 'La méthode : un seul trade par jour, sur la session.';

  // Calm Mark Douglas note when the day's SL is taken (the method ends the day).
  const slNote = day.lossToday
    ? 'Tu as pris ton SL du jour. La méthode est claire : un SL, et la journée de trading s’arrête. Reviens demain, l’esprit neuf — chaque jour repart à zéro.'
    : null;
  // Calm reminder if a position is still open after the 20h cut.
  const cutNote =
    phase === 'closed' && day.hasOpenPosition
      ? 'Une position est encore ouverte. La méthode coupe tout à 20h : la nuit n’est pas ta session.'
      : null;

  return (
    <section
      className={cn(
        // S9/CP3 — bg-1 est la surface « card » (globals.css : « lifted by --sh-card ») :
        // on porte l'ombre pour élever la timeline au langage des cartes — 2e niveau
        // de hiérarchie juste après le hero, plutôt qu'un encart mat sous lui.
        'rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-1)] p-5 shadow-[var(--sh-card)]',
        className,
      )}
      aria-labelledby="session-timeline-heading"
      data-slot="session-timeline"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="t-eyebrow text-[var(--t-3)]">Ta journée de trader</span>
          <h2 id="session-timeline-heading" className="text-[15px] font-semibold text-[var(--t-1)]">
            {guidance.headline}
          </h2>
          <p className="t-body leading-[1.5] text-[var(--t-2)]">{guidance.line}</p>
        </div>
        <span
          aria-hidden="true"
          className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]"
        >
          <Moon className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </div>

      {/* The 4-step routine track. before → all pending ; otherwise past=done,
          current=active, future=pending. Pure presentational, token-driven. */}
      <ol
        className="grid grid-cols-4 gap-1.5"
        aria-label="Les phases de la session : analyse, exécution, gestion, coupure"
      >
        {SESSION_STEPS.map((step, i) => {
          const state =
            activeIdx === -1
              ? 'pending'
              : i < activeIdx
                ? 'done'
                : i === activeIdx
                  ? 'active'
                  : 'pending';
          const isActive = state === 'active';
          const isDone = state === 'done';
          return (
            <li
              key={step.phase}
              className="flex flex-col items-center gap-1.5 text-center"
              aria-current={isActive ? 'step' : undefined}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-7 w-7 place-items-center rounded-full border text-[11px] font-semibold transition-colors',
                  isActive
                    ? cn('border-transparent', PHASE_TONE.active!.dot, PHASE_TONE.active!.ring)
                    : isDone
                      ? 'border-[var(--ok-edge)] bg-[var(--ok-dim)] text-[var(--ok)]'
                      : 'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-4)]',
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : i + 1}
              </span>
              <span
                className={cn(
                  'text-[12px] font-medium',
                  isActive
                    ? 'text-[var(--t-1)]'
                    : isDone
                      ? 'text-[var(--t-2)]'
                      : 'text-[var(--t-4)]',
                )}
              >
                {step.label}
              </span>
              <span className="t-foot text-[var(--t-4)] tabular-nums">{step.window}</span>
            </li>
          );
        })}
      </ol>

      {/* Discipline du jour — calm chips + Douglas notes. */}
      <div className="mt-4 flex flex-col gap-2 border-t border-[var(--b-default)] pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'rounded-pill inline-flex items-center border px-2.5 py-1 text-[11px] font-medium',
              tradeChipSurface,
            )}
            title={tradeChipHint}
          >
            {tradeChipLabel}
          </span>
          <span className="t-foot text-[var(--t-4)]">{tradeChipHint}</span>
        </div>
        {slNote ? (
          <p className="t-body rounded-control border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 leading-[1.5] text-[var(--t-2)]">
            {slNote}
          </p>
        ) : null}
        {cutNote ? (
          <p className="t-body rounded-control border border-[var(--warn-edge)] bg-[var(--warn-dim)] px-3 py-2 leading-[1.5] text-[var(--t-2)]">
            {cutNote}
          </p>
        ) : null}
      </div>
    </section>
  );
}
