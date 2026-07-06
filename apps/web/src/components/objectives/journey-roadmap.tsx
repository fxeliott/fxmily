'use client';

import { Check } from 'lucide-react';
import { m, useReducedMotion } from 'framer-motion';

import type { JourneyStage } from '@/lib/objectives/service';
import { cn } from '@/lib/utils';

/**
 * « Ton parcours » — schéma de progression vers la Maîtrise (jalon J4).
 *
 * Illustration custom : 4 paliers (Découverte → Régularité → Constance →
 * Maîtrise) reliés par un rail dont la portion ATTEINTE se remplit en accent,
 * avec un marqueur « Tu es ici » animé sur l'étape courante. Responsive : rail
 * horizontal en desktop, vertical en mobile. `prefers-reduced-motion` coupe le
 * remplissage animé et le pouls (rendu statique équivalent). Posture §2 : aucun
 * palier n'est punitif — c'est un chemin, pas une note.
 */

export function JourneyRoadmap({
  stages,
  cap,
}: {
  stages: ReadonlyArray<JourneyStage>;
  cap: number | null;
}) {
  const prefersReduced = useReducedMotion();
  const currentIndex = Math.max(
    0,
    stages.findIndex((s) => s.current),
  );
  const lastIndex = stages.length - 1;
  const fraction = lastIndex === 0 ? 0 : currentIndex / lastIndex;

  return (
    <section
      aria-labelledby="journey-title"
      className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-1)] p-5 lg:p-6"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h2 id="journey-title" className="t-eyebrow">
          Ton parcours
        </h2>
        {cap !== null ? (
          <span className="t-mono-cap text-[var(--t-4)]">cap actuel {cap}/100</span>
        ) : null}
      </div>

      <ol className="relative flex flex-col gap-7 sm:flex-row sm:gap-0">
        {/* Rail de fond + remplissage atteint (horizontal desktop / vertical mobile). */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {/* Desktop : rail horizontal */}
          <div className="absolute top-[18px] right-[12%] left-[12%] hidden h-[3px] rounded-full bg-[var(--b-default)] sm:block">
            <m.div
              className="h-full w-full rounded-full bg-[linear-gradient(90deg,var(--acc),var(--acc-hi))]"
              style={{ transformOrigin: '0% 50%' }}
              initial={prefersReduced ? { scaleX: fraction } : { scaleX: 0 }}
              whileInView={{ scaleX: fraction }}
              viewport={{ once: true }}
              transition={
                prefersReduced
                  ? { duration: 0 }
                  : { duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }
              }
            />
          </div>
          {/* Mobile : rail vertical */}
          <div className="absolute top-[12px] bottom-[12px] left-[18px] w-[3px] rounded-full bg-[var(--b-default)] sm:hidden">
            <m.div
              className="h-full w-full rounded-full bg-[linear-gradient(180deg,var(--acc),var(--acc-hi))]"
              style={{ transformOrigin: '50% 0%' }}
              initial={prefersReduced ? { scaleY: fraction } : { scaleY: 0 }}
              whileInView={{ scaleY: fraction }}
              viewport={{ once: true }}
              transition={
                prefersReduced
                  ? { duration: 0 }
                  : { duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }
              }
            />
          </div>
        </div>

        {stages.map((stage, i) => {
          const isCurrent = i === currentIndex;
          const isReached = stage.reached;
          return (
            <li
              key={stage.id}
              className="group rounded-card relative z-10 -m-2 flex flex-1 items-start gap-3 p-2 transition-colors motion-safe:hover:bg-[var(--acc-dim-2)] sm:flex-col sm:items-center sm:gap-2.5 sm:text-center"
              aria-current={isCurrent ? 'step' : undefined}
            >
              {/* Nœud */}
              <div className="relative grid h-9 w-9 shrink-0 place-items-center">
                {isCurrent && !prefersReduced ? (
                  <m.span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full border border-[var(--b-acc-strong)]"
                    animate={{ scale: [1, 1.55], opacity: [0.55, 0] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                  />
                ) : null}
                {/* Hover par palier (Tour 16) : un palier non encore atteint réchauffe
                    son nœud vers l'accent au survol de son étape (`group-hover`),
                    sans jamais toucher l'état courant (ring) ni un palier déjà
                    atteint (fond accent plein). motion-safe : neutralisé sous
                    reduced-motion, la transition-colors du fond de l'étape suffit. */}
                <span
                  className={cn(
                    'grid h-9 w-9 place-items-center rounded-full border text-[13px] font-semibold tabular-nums transition-colors',
                    isReached
                      ? 'border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]'
                      : 'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)] motion-safe:group-hover:border-[var(--b-acc)] motion-safe:group-hover:text-[var(--acc-hi)]',
                    isCurrent && 'ring-2 ring-[var(--acc)] ring-offset-2 ring-offset-[var(--bg-1)]',
                  )}
                >
                  {isReached && !isCurrent ? (
                    <Check className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />
                  ) : (
                    i + 1
                  )}
                </span>
              </div>

              {/* Libellé */}
              <div className="flex flex-col gap-0.5 sm:items-center sm:px-2">
                <span
                  className={cn(
                    'text-[14px] leading-tight font-semibold',
                    isCurrent
                      ? 'text-[var(--acc-hi)]'
                      : isReached
                        ? 'text-[var(--t-1)]'
                        : 'text-[var(--t-3)]',
                  )}
                >
                  {stage.label}
                </span>
                <span className="t-cap max-w-[24ch] leading-snug text-[var(--t-4)]">
                  {stage.caption}
                </span>
                {isCurrent ? (
                  <span className="mt-1 inline-flex w-fit items-center rounded-full border border-[var(--b-acc)] bg-[var(--acc-dim)] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--acc-hi)] uppercase sm:mx-auto">
                    Tu es ici
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
