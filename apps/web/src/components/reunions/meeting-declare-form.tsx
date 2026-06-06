'use client';

import { useActionState, useId } from 'react';

import {
  declareMeetingAttendanceAction,
  type DeclareMeetingAttendanceActionState,
} from '@/app/reunions/actions';
import { Btn } from '@/components/ui/btn';
import type { MeetingAttendanceModeName } from '@/lib/schemas/meeting';

/**
 * V1.7 §30 J-M2 — compact per-meeting declaration form (Client Component).
 *
 * NOT a wizard (SPEC §30.4): one mode choice (live/replay) + one content
 * checkbox + submit. Pattern V2.3 pre-trade `useActionState`. The Server
 * Action is the only authority (re-validates + applies the HARD guard).
 *
 * Anti Black-Hat (SPEC §30.7): neutral tone, NEVER red. The status feedback is
 * polite (`role="status"`), informational — a closed rattrapage window or a
 * cancelled slot is stated plainly, never as a reproach.
 */

interface MeetingDeclareFormProps {
  meetingId: string;
  /** "J'ai lu l'analyse Ichor" (midday) / "J'ai lu le bilan Ichor" (evening). */
  contentLabel: string;
  initialMode: MeetingAttendanceModeName | null;
  initialContentReviewed: boolean;
}

function feedbackMessage(state: DeclareMeetingAttendanceActionState | null): string | null {
  if (!state || state.ok) return null;
  switch (state.error) {
    case 'invalid_input':
      return 'Choisis comment tu as assisté avant de déclarer.';
    case 'not_declarable':
      switch (state.notDeclarableReason) {
        case 'cancelled':
          return 'Cette réunion a été annulée — rien à déclarer.';
        case 'future':
          return "Cette réunion n'a pas encore eu lieu.";
        case 'out_of_window':
          return 'Au-delà de 30 jours, la déclaration est fermée. Tu n’es pas pénalisé.';
        default:
          return 'Réunion introuvable.';
      }
    default:
      return 'Une erreur est survenue. Réessaie dans un instant.';
  }
}

const MODE_OPTIONS: { value: MeetingAttendanceModeName; label: string }[] = [
  { value: 'live', label: 'J’étais en live' },
  { value: 'replay', label: 'J’ai vu la rediffusion' },
];

export function MeetingDeclareForm({
  meetingId,
  contentLabel,
  initialMode,
  initialContentReviewed,
}: MeetingDeclareFormProps) {
  const [state, formAction, pending] = useActionState<
    DeclareMeetingAttendanceActionState | null,
    FormData
  >(declareMeetingAttendanceAction, null);

  const baseId = useId();
  const contentId = `${baseId}-content`;
  const message = feedbackMessage(state);
  const alreadyDeclared = initialMode !== null || initialContentReviewed;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 border-t border-[var(--b-default)] pt-3"
    >
      <input type="hidden" name="meetingId" value={meetingId} />

      {/* Native <fieldset>+<legend> groups the radios accessibly; radios
          sharing `name="attendanceMode"` give arrow-key navigation + a single
          tab stop for free. No redundant `role="radiogroup"` (a11y T2-1). */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="t-cap text-[var(--t-3)]">Comment as-tu assisté ?</legend>
        <div className="flex gap-2">
          {MODE_OPTIONS.map(({ value, label }) => {
            const optionId = `${baseId}-${value}`;
            return (
              <label
                key={value}
                htmlFor={optionId}
                className="rounded-control flex min-h-11 flex-1 cursor-pointer items-center justify-center border border-[var(--b-default)] px-3 text-center text-[13px] text-[var(--t-2)] transition-colors has-[:checked]:border-[var(--b-acc)] has-[:checked]:bg-[var(--acc-dim)] has-[:checked]:text-[var(--acc-hi)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--acc)] has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-[var(--bg-1)]"
              >
                <input
                  type="radio"
                  id={optionId}
                  name="attendanceMode"
                  value={value}
                  defaultChecked={initialMode === value}
                  className="sr-only"
                />
                {label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <label
        htmlFor={contentId}
        className="rounded-control flex min-h-11 cursor-pointer items-center gap-2.5 px-1 transition-shadow has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--acc)] has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-[var(--bg-1)]"
      >
        <input
          type="checkbox"
          id={contentId}
          name="contentReviewed"
          defaultChecked={initialContentReviewed}
          className="h-5 w-5 shrink-0 rounded-[6px] accent-[var(--acc)]"
        />
        <span className="t-cap text-[var(--t-2)]">{contentLabel}</span>
      </label>

      {message ? (
        <p role="status" className="t-cap text-[var(--t-2)]">
          {message}
        </p>
      ) : null}

      <Btn type="submit" size="m" loading={pending} className="self-start">
        {alreadyDeclared ? 'Mettre à jour ma présence' : 'Déclarer ma présence'}
      </Btn>
    </form>
  );
}
