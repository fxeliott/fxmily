'use client';

import { CalendarOff, Loader2, Plus, X } from 'lucide-react';
import { useMemo, useRef, useState, useTransition } from 'react';

import {
  cancelOffDayAction,
  declareOffDayRangeAction,
  updateWeekendsOffAction,
} from '@/app/checkin/off-day-actions';
import { btnVariants } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { OFF_DAY_FORWARD_HORIZON_DAYS } from '@/lib/schemas/off-day';

/**
 * `<OffDaysManager>` — the member's off-day (jour off) settings island (Tour 14),
 * rendered on `/account/rythme`. Three controls, all posture-calm (SPEC pont —
 * an off day is a CHOICE, never a lack) :
 *   1. a weekends-off switch (`updateWeekendsOffAction`) — role="switch" + label;
 *   2. an absence-range form (`declareOffDayRangeAction`) — vacances, one row per
 *      civil day of the inclusive span;
 *   3. the list of upcoming declared off days, each cancellable
 *      (`cancelOffDayAction`).
 *
 * Server-authoritative : the parent Server Component reads the current state and
 * seeds it here; every write goes through a Server Action (auth + Zod + TZ clamp
 * re-checked there) and we re-sync from its result. The `aria-live` region
 * announces every outcome so a screen-reader user hears the change.
 *
 * A11y (WCAG 2.2 AA) : the switch is a real `role="switch"` with `aria-checked`;
 * the date inputs carry `min`/`max` matching the action window (no UI offers a
 * day the submit would reject); focus-visible rings via the shared btn/token
 * styles; motion limited to a spinner that respects `motion-reduce`.
 */

/** One upcoming declared off day, seeded by the server (newest windows first). */
export interface UpcomingOffDay {
  /** Local civil date, YYYY-MM-DD. */
  date: string;
  /** Human label already formatted server-side (member timezone). */
  label: string;
  /** Optional reason the member gave (may be null). */
  reason: string | null;
}

interface Props {
  /** Current `User.weekendsOff` value (server-authoritative). */
  initialWeekendsOff: boolean;
  /** The member's already-declared upcoming off days. */
  initialUpcoming: UpcomingOffDay[];
  /** Member-local `today` (YYYY-MM-DD) — anchors the date-input bounds. */
  todayLocal: string;
}

/** Shift a YYYY-MM-DD string by whole days (UTC-anchored, DST-proof). */
function shiftIso(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function OffDaysManager({
  initialWeekendsOff,
  initialUpcoming,
  todayLocal,
}: Props): React.ReactElement {
  const [weekendsOff, setWeekendsOff] = useState(initialWeekendsOff);
  const [upcoming, setUpcoming] = useState<UpcomingOffDay[]>(initialUpcoming);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();
  const rangeErrorRef = useRef<HTMLParagraphElement>(null);

  // Declare is forward-only: the range inputs never offer a day before today or
  // beyond the +30 horizon (no offered-then-rejected day). Cancelling a recent
  // past day happens via the upcoming-list "Retirer" button, not a date input.
  const maxForward = useMemo(
    () => shiftIso(todayLocal, OFF_DAY_FORWARD_HORIZON_DAYS),
    [todayLocal],
  );

  function toggleWeekends() {
    const next = !weekendsOff;
    // Optimistic flip, reverted if the action reports a failure.
    setWeekendsOff(next);
    startTransition(async () => {
      const res = await updateWeekendsOffAction(next);
      if (res.ok) {
        setMessage(
          next
            ? 'Tes week-ends sont désormais des jours off par défaut.'
            : 'Tes week-ends comptent désormais comme des jours ordinaires.',
        );
      } else {
        setWeekendsOff(!next);
        setMessage("La modification n'a pas pu être enregistrée. Réessaie dans un instant.");
      }
    });
  }

  function submitRange(e: React.FormEvent) {
    e.preventDefault();
    if (!from || !to) {
      setMessage('Choisis une date de début et une date de fin.');
      return;
    }
    startTransition(async () => {
      const res = await declareOffDayRangeAction(from, to, reason.trim() || undefined);
      if (res.ok) {
        setMessage(
          res.days === 1
            ? 'Ton jour off est enregistré.'
            : `Tes ${res.days} jours off sont enregistrés.`,
        );
        setFrom('');
        setTo('');
        setReason('');
        // The upcoming list is NOT appended optimistically: the server owns the
        // label format, so the fresh rows appear on the next navigation
        // (revalidatePath refetches the page data).
      } else {
        setMessage(
          res.error === 'invalid_input'
            ? 'La plage est invalide (début avant la fin, aujourd’hui au plus tôt, un mois maximum).'
            : "L'enregistrement a échoué. Réessaie dans un instant.",
        );
        rangeErrorRef.current?.focus();
      }
    });
  }

  function cancel(date: string) {
    startTransition(async () => {
      const res = await cancelOffDayAction(date);
      if (res.ok) {
        setUpcoming((prev) => prev.filter((d) => d.date !== date));
        setMessage('Le jour off a été retiré.');
      } else {
        setMessage("Le retrait n'a pas pu être enregistré. Réessaie dans un instant.");
      }
    });
  }

  return (
    <div className="space-y-8">
      {/* 1 — weekends-off switch --------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium tracking-widest text-[var(--t-3)] uppercase">
          Week-ends
        </h2>
        <div className="rounded-card flex items-start justify-between gap-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
          <label htmlFor="weekends-off-switch" className="min-w-0 flex-1 cursor-pointer">
            {/* aria-labelledby target: a <label for> does NOT name a <button>
                (name-from-content, and the thumb is aria-hidden), so the switch
                must point at this span explicitly (runtime sweep T14). */}
            <span id="weekends-off-label" className="block text-sm font-medium text-[var(--t-1)]">
              Samedi et dimanche sont des jours off
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-[var(--t-2)]">
              Activé, tes week-ends ne comptent jamais comme un check-in manqué et ne cassent pas ta
              série. Désactive-le si tu suis les marchés le week-end.
            </span>
          </label>
          <button
            type="button"
            role="switch"
            id="weekends-off-switch"
            aria-labelledby="weekends-off-label"
            aria-checked={weekendsOff}
            onClick={toggleWeekends}
            disabled={isPending}
            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[var(--b-acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-1)] focus-visible:outline-none disabled:opacity-50 motion-reduce:transition-none ${
              weekendsOff
                ? 'border-[var(--b-acc)] bg-[var(--acc)]'
                : 'border-[var(--b-default)] bg-[var(--bg-3)]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 motion-reduce:transition-none ${
                weekendsOff ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      {/* 2 — absence range (vacances) --------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium tracking-widest text-[var(--t-3)] uppercase">
          Poser une absence
        </h2>
        <form
          onSubmit={submitRange}
          className="rounded-card space-y-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
        >
          <p className="text-sm leading-relaxed text-[var(--t-2)]">
            Vacances, déplacement, pause choisie : déclare une plage de jours off. Ces jours ne
            comptent pas comme des check-ins manqués et ne cassent pas ta série.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="off-range-from"
                className="block text-sm font-medium text-[var(--t-2)]"
              >
                Du
              </label>
              <input
                id="off-range-from"
                type="date"
                value={from}
                min={todayLocal}
                max={maxForward}
                onChange={(e) => setFrom(e.target.value)}
                disabled={isPending}
                className="rounded-control w-full border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 text-sm text-[var(--t-1)] focus-visible:border-[var(--b-acc)] focus-visible:ring-2 focus-visible:ring-[var(--b-acc)] focus-visible:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="off-range-to" className="block text-sm font-medium text-[var(--t-2)]">
                Au
              </label>
              <input
                id="off-range-to"
                type="date"
                value={to}
                min={from || todayLocal}
                max={maxForward}
                onChange={(e) => setTo(e.target.value)}
                disabled={isPending}
                className="rounded-control w-full border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 text-sm text-[var(--t-1)] focus-visible:border-[var(--b-acc)] focus-visible:ring-2 focus-visible:ring-[var(--b-acc)] focus-visible:outline-none"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="off-range-reason"
              className="block text-sm font-medium text-[var(--t-2)]"
            >
              Raison (optionnelle)
            </label>
            <input
              id="off-range-reason"
              type="text"
              value={reason}
              maxLength={500}
              placeholder="Vacances, formation, repos..."
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              className="rounded-control w-full border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 text-sm text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--b-acc)] focus-visible:ring-2 focus-visible:ring-[var(--b-acc)] focus-visible:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={isPending || !from || !to}
            className={btnVariants({ kind: 'primary', size: 'm' })}
          >
            {isPending ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:hidden" />
            ) : (
              <Plus aria-hidden="true" className="h-4 w-4" />
            )}
            Poser ces jours off
          </button>
        </form>
      </section>

      {/* 3 — upcoming declared off days ------------------------------------- */}
      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium tracking-widest text-[var(--t-3)] uppercase">
            Jours off à venir
          </h2>
          <ul className="space-y-2">
            {upcoming.map((day) => (
              <li
                key={day.date}
                className="rounded-card flex items-center justify-between gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <CalendarOff
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-[var(--cy)]"
                    strokeWidth={1.75}
                  />
                  <div className="min-w-0">
                    <span className="block text-sm font-medium text-[var(--t-1)]">{day.label}</span>
                    {day.reason && (
                      <span className="block truncate text-xs text-[var(--t-3)]">{day.reason}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone="cy">Jour off</Pill>
                  <button
                    type="button"
                    onClick={() => cancel(day.date)}
                    disabled={isPending}
                    aria-label={`Retirer le jour off du ${day.label}`}
                    className={btnVariants({ kind: 'ghost', size: 's' })}
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                    Retirer
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--t-3)]">
            Tu peux retirer un jour off jusqu’à une semaine après sa date si tu l’as posé par
            erreur.
          </p>
        </section>
      )}

      {/* Live region — every write outcome is announced. */}
      <p
        ref={rangeErrorRef}
        tabIndex={-1}
        aria-live="polite"
        className="min-h-5 text-sm text-[var(--t-2)] focus-visible:outline-none"
      >
        {message}
      </p>
    </div>
  );
}
