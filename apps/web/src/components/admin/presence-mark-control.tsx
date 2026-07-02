'use client';

import { CheckCircle2, CircleSlash, Eraser, TriangleAlert } from 'lucide-react';
import { useActionState } from 'react';

import { markPresenceAction, type MarkPresenceActionState } from '@/app/admin/reunions/actions';
import { Btn } from '@/components/ui/btn';
import { Pill, type PillProps } from '@/components/ui/pill';
import type { AttendanceGap } from '@/lib/meeting/attendance-gap';

/**
 * S10 §30.8 — admin presence-marking control for ONE meeting row (Client
 * Component). The write side of the recoupement admin↔membre: Eliott declares
 * "présent / absent / (effacer)" for this member on this meeting; the ÉCART vs
 * the member self-report is computed server-side and surfaced as a calm badge.
 *
 * Posture §2 / anti Black-Hat (SPEC §30.7): NEUTRAL tone, NEVER punitive red.
 * An écart is a coaching signal (warn at most), never a shame surface. Three
 * submit buttons share one form, each carrying its own `present` value (Btn
 * forwards name/value to the underlying <button>). The Server Action re-auths +
 * re-validates; client gating is best-effort UX.
 */

const GAP_META: Record<
  Exclude<AttendanceGap, 'none'>,
  { label: string; tone: NonNullable<PillProps['tone']> }
> = {
  // The only honesty écart — a complete self-report Eliott contradicts. `warn`
  // (never `bad`): the engagement numerator already drops it, this is the visible
  // coaching signal, not a punishment.
  admin_absent_member_present: { label: 'Écart : déclarée complète, notée absente', tone: 'warn' },
  // Benign engagement nudges — the member simply has not logged it (yet).
  admin_present_member_absent: { label: 'Noté présent · non déclaré', tone: 'mute' },
  admin_present_member_partial: { label: 'Noté présent · déclaration partielle', tone: 'mute' },
};

const ADMIN_STATE_META: Record<
  'present' | 'absent',
  { label: string; tone: NonNullable<PillProps['tone']> }
> = {
  present: { label: 'Noté présent', tone: 'acc' },
  absent: { label: 'Noté absent', tone: 'mute' },
};

function feedbackMessage(state: MarkPresenceActionState | null): string | null {
  if (!state || state.ok) return null;
  switch (state.error) {
    case 'not_found':
      return 'Ce créneau est introuvable, la liste a peut-être changé.';
    case 'cancelled':
      return 'Créneau annulé : pas de présence à marquer.';
    case 'member_not_found':
      return 'Membre introuvable.';
    case 'forbidden':
      return 'Action réservée à l’admin.';
    case 'unauthorized':
      return 'Session expirée, reconnecte-toi.';
    case 'invalid_input':
      return 'Marquage invalide.';
    default:
      return 'Une erreur est survenue. Réessaie dans un instant.';
  }
}

export function PresenceMarkControl({
  memberId,
  meetingId,
  adminPresent,
  gap,
  disabled = false,
}: {
  memberId: string;
  meetingId: string;
  adminPresent: boolean | null;
  gap: AttendanceGap;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState<MarkPresenceActionState | null, FormData>(
    markPresenceAction,
    null,
  );
  const message = feedbackMessage(state);
  const adminMeta =
    adminPresent === null ? null : ADMIN_STATE_META[adminPresent ? 'present' : 'absent'];
  const gapMeta = gap === 'none' ? null : GAP_META[gap];

  return (
    <div className="flex flex-col gap-2">
      {/* Current admin mark + cross-check verdict (text labels, never colour
          alone — WCAG 1.4.1). */}
      {adminMeta || gapMeta ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {adminMeta ? (
            <Pill tone={adminMeta.tone}>
              {adminPresent ? (
                <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
              ) : (
                <CircleSlash className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
              )}
              {adminMeta.label}
            </Pill>
          ) : null}
          {gapMeta ? (
            <Pill tone={gapMeta.tone}>
              <TriangleAlert className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
              {gapMeta.label}
            </Pill>
          ) : null}
        </div>
      ) : null}

      <form action={formAction} className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="meetingId" value={meetingId} />
        <input type="hidden" name="memberId" value={memberId} />

        {message ? (
          <p role="alert" className="t-cap w-full text-[var(--t-2)]">
            {message}
          </p>
        ) : null}

        <Btn
          type="submit"
          name="present"
          value="present"
          kind={adminPresent === true ? 'secondary' : 'ghost'}
          size="s"
          disabled={disabled}
          loading={pending}
        >
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          Présent
        </Btn>
        <Btn
          type="submit"
          name="present"
          value="absent"
          kind={adminPresent === false ? 'secondary' : 'ghost'}
          size="s"
          disabled={disabled}
          loading={pending}
        >
          <CircleSlash className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          Absent
        </Btn>
        {adminPresent !== null ? (
          <Btn
            type="submit"
            name="present"
            value="clear"
            kind="ghost"
            size="s"
            disabled={disabled}
            loading={pending}
          >
            <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            Effacer
          </Btn>
        ) : null}
      </form>
    </div>
  );
}
