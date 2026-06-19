'use client';

import { CheckCircle2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import { endTrainingSessionAction } from '@/app/training/sessions/actions';
import { Spinner } from '@/components/spinner';

/**
 * "Terminer la séance" CTA (S8 Mode Entraînement). Marks a `TrainingSession`
 * as ended (`endedAt = now`). Two-step confirm to avoid an accidental tap; the
 * action is low-stakes and reversible (ending a session never touches the
 * backtests inside it — they keep their `sessionId`). Cyan/neutral tone, NOT
 * the danger red of a delete (Mark Douglas non-confusability).
 */

export function EndTrainingSessionButton({ sessionId }: { sessionId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const onEnd = () => {
    setError(null);
    startTransition(async () => {
      const res = await endTrainingSessionAction(sessionId);
      if (!res.ok) {
        setError(
          res.error === 'not_found'
            ? 'Session introuvable.'
            : res.error === 'unauthorized'
              ? 'Session expirée.'
              : 'Erreur inattendue — réessaie.',
        );
      }
      // On success the page revalidates via the action.
    });
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-control inline-flex h-11 min-w-[44px] items-center gap-1.5 px-3 text-[12px] text-[var(--t-3)] transition-colors hover:bg-[var(--cy-dim)] hover:text-[var(--cy)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]"
      >
        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        Terminer la séance
      </button>
    );
  }

  const promptId = `end-training-session-${sessionId}-prompt`;

  return (
    <div
      role="alertdialog"
      aria-labelledby={promptId}
      aria-describedby={promptId}
      className="rounded-control flex w-full flex-col gap-2 border border-[oklch(0.789_0.139_217_/_0.30)] bg-[var(--cy-dim)] p-3"
    >
      <p id={promptId} className="t-cap text-[var(--t-2)]">
        Marquer cette séance comme terminée ? Tu pourras toujours la consulter ; tes backtests sont
        conservés.
      </p>
      {error ? (
        <p role="alert" className="text-[11px] text-[var(--bad)]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-control inline-flex h-11 min-w-[44px] items-center px-3 text-[12px] text-[var(--t-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)] disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onEnd}
          disabled={pending}
          aria-busy={pending || undefined}
          className="rounded-control inline-flex h-11 items-center gap-1.5 bg-[var(--cy)] px-4 text-[12px] font-semibold text-[var(--bg)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Spinner size={12} /> : null}
          {pending ? 'Clôture…' : 'Confirmer'}
        </button>
      </div>
    </div>
  );
}
