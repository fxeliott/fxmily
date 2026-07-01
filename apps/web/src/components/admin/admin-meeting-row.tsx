'use client';

import { CalendarCheck, CalendarX, ClipboardList, Users } from 'lucide-react';
import Link from 'next/link';
import { useActionState } from 'react';

import { cancelMeetingAction, type CancelMeetingActionState } from '@/app/admin/reunions/actions';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { AdminMeetingView } from '@/lib/meeting/service';
import type { MeetingSlotName } from '@/lib/meeting/occurrence';
import { cn } from '@/lib/utils';

/**
 * V1.7 §30 J-M3 — one meeting row on `/admin/reunions` (Client Component).
 *
 * Neutral DS-v2 tone (anti Black-Hat, SPEC §30.7): a cancelled slot is greyed
 * (`opacity-60`) and offers an "uncancel" control; a scheduled slot offers
 * "annuler ce créneau (pas dispo)". The attendance counts are informational
 * (count-only, posture §2 — never a per-member identity, never Ichor content).
 *
 * `useActionState` carbone V2.1 admin notes panel. The Server Action
 * re-validates + re-checks `role === 'admin'`; client gating is best-effort UX.
 */

const SLOT_TIME: Record<MeetingSlotName, string> = { midday: '12h', evening: '20h' };
const SLOT_SUBTITLE: Record<MeetingSlotName, string> = {
  midday: 'Analyse Ichor',
  evening: 'Bilan / débrief Ichor',
};

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
});

function feedbackMessage(state: CancelMeetingActionState | null): string | null {
  if (!state || state.ok) return null;
  switch (state.error) {
    case 'not_found':
      return 'Ce créneau est introuvable — la liste a peut-être changé.';
    case 'forbidden':
      return 'Action réservée à l’admin.';
    case 'unauthorized':
      return 'Session expirée, reconnecte-toi.';
    case 'invalid_input':
      return 'Action invalide.';
    default:
      return 'Une erreur est survenue. Réessaie dans un instant.';
  }
}

export function AdminMeetingRow({ meeting }: { meeting: AdminMeetingView }) {
  const [state, formAction, pending] = useActionState<CancelMeetingActionState | null, FormData>(
    cancelMeetingAction,
    null,
  );

  const time = SLOT_TIME[meeting.slot];
  const dateLabel = DATE_FMT.format(new Date(meeting.scheduledAt));
  const title = `Réunion ${time} — ${dateLabel}`;
  const isCancelled = meeting.status === 'cancelled';
  const message = feedbackMessage(state);
  const nextAction = isCancelled ? 'uncancel' : 'cancel';

  return (
    // `interactive` (border-strong + shadow-hover, NO transform) — the card
    // holds a <form>, so a spring/lift would conflict; the hover affordance is
    // shadow + border only. Cancelled rows keep their greyed `opacity-60`.
    <Card interactive className={cn('flex flex-col gap-3 p-4', isCancelled && 'opacity-60')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="t-body font-medium text-[var(--t-1)]">{title}</h3>
          <p className="t-cap text-[var(--t-3)]">{SLOT_SUBTITLE[meeting.slot]}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meeting.isPast ? <Pill tone="mute">Passée</Pill> : <Pill tone="acc">À venir</Pill>}
          {isCancelled ? (
            <Pill tone="warn">
              <CalendarX className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
              Annulée
            </Pill>
          ) : null}
        </div>
      </div>

      {/* Informational attendance counts (count-only, neutral). The figures are
          surfaced as cool §21.7 cyan badges (a neutral COUNT, never a CTA). */}
      <p className="t-cap inline-flex flex-wrap items-center gap-1.5 text-[var(--t-3)]">
        <Users className="h-3.5 w-3.5 text-[var(--t-4)]" strokeWidth={1.75} aria-hidden="true" />
        <Pill tone="cy">
          {meeting.completedCount} présence{meeting.completedCount > 1 ? 's' : ''}
        </Pill>
        {meeting.declaredCount > meeting.completedCount ? (
          <Pill tone="cy">
            {meeting.declaredCount} déclaration{meeting.declaredCount > 1 ? 's' : ''}
          </Pill>
        ) : null}
        {meeting.gapCount > 0 ? (
          <Pill tone="warn">
            {meeting.gapCount} écart{meeting.gapCount > 1 ? 's' : ''}
          </Pill>
        ) : null}
      </p>

      {/* F4 — drill into the per-meeting roster to tick the cohort present/absent.
          Hidden on a cancelled slot (nothing to mark). A plain <Link> (outside the
          cancel <form>) so it never submits the form. */}
      {!isCancelled ? (
        <Link
          href={`/admin/reunions/${meeting.id}`}
          className="rounded-control inline-flex w-fit items-center gap-1.5 text-[12px] font-medium text-[var(--acc-hi)] transition-colors hover:text-[var(--t-1)] focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-1)] focus-visible:outline-none"
        >
          <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          Feuille de présence
        </Link>
      ) : null}

      <form
        action={formAction}
        className="flex flex-col gap-2 border-t border-[var(--b-default)] pt-3"
      >
        <input type="hidden" name="meetingId" value={meeting.id} />
        <input type="hidden" name="action" value={nextAction} />

        {message ? (
          // `feedbackMessage` returns a string only on failure, so this line is
          // assertive (role="alert", WCAG 4.1.3) — success is signalled by the
          // server revalidatePath, never by this span.
          <p role="alert" className="t-cap text-[var(--t-2)]">
            {message}
          </p>
        ) : null}

        <Btn
          type="submit"
          kind={isCancelled ? 'secondary' : 'ghost'}
          size="s"
          loading={pending}
          className="self-start"
        >
          {isCancelled ? (
            <>
              <CalendarCheck className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              Rétablir ce créneau
            </>
          ) : (
            <>
              <CalendarX className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              Annuler ce créneau (pas dispo)
            </>
          )}
        </Btn>
      </form>
    </Card>
  );
}
