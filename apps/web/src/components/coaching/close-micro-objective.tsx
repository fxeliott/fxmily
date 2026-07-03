'use client';

import { useState, useTransition } from 'react';

import { closeMicroObjectiveAction } from '@/app/objectifs/actions';
import { Btn } from '@/components/ui/btn';
import { type MicroObjectiveCloseEcho } from '@/lib/coaching/micro-objective';
import { type MicroObjectiveOutcomeInput } from '@/lib/schemas/coaching';
import { cn } from '@/lib/utils';

/**
 * S5 §32-E3 — the member refers the open loop ("l'as-tu tenu ?"). Three calm
 * choices, no modal: tenu / pas encore / pas pertinent.
 *
 * Tour 11 (FINDING 1) — the close is no longer MUTE. On success the action
 * returns a Mark Douglas close echo (`role="status"`), personalised by the
 * member's coaching register, which STAYS visible after the RSC re-render
 * (local state, `type MicroObjectiveOutcomeInput`). It's the moment the app
 * NAMES the act instead of leaving the open slot in silence.
 *
 * POSTURE §31.2 : « pas encore » is `missed` framed as DATA, never a reproach —
 * a plain secondary button, never a danger/red one ; the echo is calm (tone
 * `ok`/`neutral`), never red, never punitive.
 */

const CHOICES: ReadonlyArray<{
  outcome: MicroObjectiveOutcomeInput;
  label: string;
  kind: 'primary' | 'secondary' | 'ghost';
}> = [
  { outcome: 'kept', label: 'Je l’ai tenu', kind: 'primary' },
  { outcome: 'missed', label: 'Pas encore', kind: 'secondary' },
  { outcome: 'dismissed', label: 'Pas pertinent', kind: 'ghost' },
];

/**
 * Tour 11 (FINDING 1, fix runtime) — the calm "Boucle refermée" confirmation,
 * extracted so `MicroObjectiveLoop` (the always-mounted island) can render it
 * AFTER the RSC re-render has dropped the card. Polite live region, tone
 * `ok`/`neutral`, never red (§31.2).
 */
export function MicroObjectiveCloseEchoBlock({ echo }: { echo: MicroObjectiveCloseEcho }) {
  return (
    <div
      role="status"
      data-tone={echo.tone}
      className={cn(
        'rounded-control flex flex-col gap-1 border px-3.5 py-3',
        echo.tone === 'ok'
          ? 'border-[var(--b-acc)] bg-[var(--acc-dim)]'
          : 'border-[var(--b-default)] bg-[var(--bg-2)]',
      )}
    >
      <span className="t-eyebrow text-[var(--t-3)]">Boucle refermée</span>
      {echo.lines.map((line, i) => (
        <p
          key={i}
          className={cn(
            'leading-relaxed',
            i === 0 ? 't-cap font-medium text-[var(--t-1)]' : 't-foot text-[var(--t-2)]',
          )}
        >
          {line}
        </p>
      ))}
    </div>
  );
}

export function CloseMicroObjective({
  microObjectiveId,
  onEcho,
}: {
  microObjectiveId: string;
  /**
   * Tour 11 (FINDING 1, fix runtime) — when provided, the echo is LIFTED to the
   * always-mounted `MicroObjectiveLoop` island instead of local state: the
   * server action revalidates the page, the RSC re-render drops this island
   * (the loop left the "open" slot), and local state would die with it.
   */
  onEcho?: ((echo: MicroObjectiveCloseEcho | null) => void) | undefined;
}) {
  const [error, setError] = useState<string | null>(null);
  // Local fallback when no `onEcho` owner exists (kept for isolated usages and
  // as the direct render path in tests).
  const [echo, setEcho] = useState<MicroObjectiveCloseEcho | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (outcome: MicroObjectiveOutcomeInput) => {
    setError(null);
    setEcho(null);
    startTransition(async () => {
      const result = await closeMicroObjectiveAction(microObjectiveId, outcome, null);
      if (result.ok) {
        if (onEcho) {
          onEcho(result.echo ?? null);
        } else {
          setEcho(result.echo ?? null);
        }
      } else {
        setError('Enregistrement impossible, réessaie.');
      }
    });
  };

  // Once the echo is shown the loop is closed: the choices are done. We hide the
  // buttons and let the calm confirmation stand on its own (fallback path only —
  // with `onEcho` the always-mounted parent island renders it instead).
  if (echo) {
    return <MicroObjectiveCloseEchoBlock echo={echo} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="As-tu tenu ton micro-objectif ?"
        className="flex flex-wrap items-center gap-2"
      >
        {CHOICES.map((choice) => (
          <Btn
            key={choice.outcome}
            type="button"
            kind={choice.kind}
            size="s"
            loading={isPending}
            onClick={() => submit(choice.outcome)}
          >
            {choice.label}
          </Btn>
        ))}
      </div>
      {error ? (
        <span role="alert" className="text-[11px] text-[var(--bad)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
