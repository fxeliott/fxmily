'use client';

import { useState } from 'react';

import type { MicroObjectiveCloseEcho, MicroObjectiveView } from '@/lib/coaching/micro-objective';

import { MicroObjectiveCloseEchoBlock } from './close-micro-objective';
import { MicroObjectiveCard } from './micro-objective-card';

/**
 * Tour 11 (FINDING 1, fix runtime) — the ALWAYS-MOUNTED owner of the close echo.
 *
 * Root cause: `closeMicroObjectiveAction` revalidates `/objectifs`, `/dashboard`
 * and the root layout, so the very next RSC render drops the card (the loop left
 * the "open" slot) — and any echo state living INSIDE the card dies unseen
 * (proven in the tour 11 runtime audit: `role="status"` empty 2s after the
 * click). Pages therefore render THIS island unconditionally at a stable
 * position: React reconciles it across RSC re-renders, its state survives, and
 * the "Boucle refermée" mirror stays on screen after the card is gone.
 *
 * A NEW open loop arriving later (fresh `objective` prop with a different id)
 * naturally replaces the stale echo with the card — derived render, no effect.
 */
export function MicroObjectiveLoop({
  objective,
  annotationExcerpt = null,
  isStale = false,
  variant = 'full',
  sectionClassName,
}: {
  objective: MicroObjectiveView | null;
  annotationExcerpt?: string | null;
  isStale?: boolean;
  variant?: 'full' | 'compact';
  /** Wrapper `<section>` classes (e.g. `wow-reveal` on /objectifs). */
  sectionClassName?: string | undefined;
}) {
  const [closed, setClosed] = useState<{
    id: string;
    echo: MicroObjectiveCloseEcho | null;
  } | null>(null);

  // The echo stands as long as no DIFFERENT open loop shows up. `objective`
  // still briefly holds the just-closed loop between the action return and the
  // RSC re-render — same id, keep showing the echo.
  const echo = closed && (!objective || objective.id === closed.id) ? closed.echo : null;

  if (echo) {
    return (
      <section aria-label="Ton micro-objectif du moment" className={sectionClassName}>
        <MicroObjectiveCloseEchoBlock echo={echo} />
      </section>
    );
  }

  if (!objective) return null;

  return (
    <section aria-label="Ton micro-objectif du moment" className={sectionClassName}>
      <MicroObjectiveCard
        objective={objective}
        annotationExcerpt={annotationExcerpt}
        isStale={isStale}
        variant={variant}
        onEcho={(nextEcho) => setClosed({ id: objective.id, echo: nextEcho })}
      />
    </section>
  );
}
