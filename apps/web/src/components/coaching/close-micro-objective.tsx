'use client';

import { useState, useTransition } from 'react';

import { closeMicroObjectiveAction } from '@/app/objectifs/actions';
import { Btn } from '@/components/ui/btn';
import { type MicroObjectiveOutcomeInput } from '@/lib/schemas/coaching';

/**
 * S5 §32-E3 — the member refers the open loop ("l'as-tu tenu ?"). Three calm
 * choices, no modal: tenu / pas encore / pas pertinent. The action re-renders
 * the RSC (no optimistic state — the loop simply leaves the open slot).
 *
 * POSTURE §31.2 : « pas encore » is `missed` framed as DATA, never a reproach —
 * a plain secondary button, never a danger/red one.
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

export function CloseMicroObjective({ microObjectiveId }: { microObjectiveId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (outcome: MicroObjectiveOutcomeInput) => {
    setError(null);
    startTransition(async () => {
      const result = await closeMicroObjectiveAction(microObjectiveId, outcome, null);
      if (!result.ok) {
        setError('Enregistrement impossible, réessaie.');
      }
    });
  };

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
