'use client';

import { CalendarOff, Loader2, Undo2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { cancelOffDayAction, declareOffDayAction } from '@/app/checkin/off-day-actions';
import { Card } from '@/components/ui/card';

/**
 * `<TodayOffToggle>` — the "Je ne trade pas aujourd'hui" control in the /checkin
 * hub (Tour 14). One calm switch between two states:
 *   - not off  → a quiet "Je ne trade pas aujourd'hui" button (`declareOffDayAction`);
 *   - off      → a confirmation line + an "Annuler" affordance (`cancelOffDayAction`).
 *
 * Posture pont (SPEC §31.2): declaring an off day is a CHOICE, never a lack. The
 * copy is calm, cyan (the "pont" tone), never red or a missed-day accusation. A
 * check-in filed later the same day still counts 100 % — this only removes the
 * pressure, so we ONLY offer this when today has no check-in yet.
 *
 * Server-authoritative: the parent seeds `initialIsOff`; each write goes through
 * a Server Action (auth + Zod + TZ clamp re-checked there). The `aria-live`
 * region announces the outcome.
 */

interface Props {
  /** Whether today is ALREADY an off day (weekend-off or explicitly declared). */
  initialIsOff: boolean;
  /** Whether today is off only because it is a weekend the member keeps off. */
  isWeekendOff: boolean;
  /**
   * Today as a local ISO date in the MEMBER's timezone, computed server-side.
   * The browser clock cannot stand in for it: `new Date().toISOString()` is UTC
   * and diverges from the member's civil day around midnight, so an undo would
   * target the wrong row (delete count 0, row survives the refresh).
   */
  todayLocal: string;
}

export function TodayOffToggle({
  initialIsOff,
  isWeekendOff,
  todayLocal,
}: Props): React.ReactElement {
  const [isOff, setIsOff] = useState(initialIsOff);
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  function declare() {
    startTransition(async () => {
      const res = await declareOffDayAction();
      if (res.ok) {
        setIsOff(true);
        setMessage(
          'Jour off enregistré. Aucun check-in attendu aujourd’hui, ta série est préservée.',
        );
      } else {
        setMessage("La déclaration n'a pas pu être enregistrée. Réessaie dans un instant.");
      }
    });
  }

  function undo() {
    startTransition(async () => {
      // Cancel only affects an EXPLICIT declaration; a weekend-off day has no row
      // to delete (the parent never renders the undo path for it).
      const res = await cancelOffDayAction(todayLocal);
      if (res.ok) {
        setIsOff(false);
        setMessage('Jour off retiré.');
      } else {
        setMessage("Le retrait n'a pas pu être enregistré. Réessaie dans un instant.");
      }
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="rounded-control mt-0.5 grid h-9 w-9 shrink-0 place-items-center border border-[var(--cy-edge-soft)] bg-[var(--cy-dim)] text-[var(--cy)]"
        >
          <CalendarOff className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {isOff ? (
            <>
              <span className="text-[13px] font-semibold text-[var(--t-1)]">
                {isWeekendOff ? 'Week-end : jour off par défaut' : 'Tu ne trades pas aujourd’hui'}
              </span>
              <span className="t-cap text-[var(--t-3)]">
                Aucun check-in attendu, ta série reste intacte.
                {isWeekendOff ? ' Tu peux changer ça dans Mon compte, Mon rythme.' : ''}
              </span>
            </>
          ) : (
            <>
              <span className="text-[13px] font-semibold text-[var(--t-1)]">
                Tu ne trades pas aujourd’hui ?
              </span>
              <span className="t-cap text-[var(--t-3)]">
                Déclare un jour off : pas de check-in attendu, ta série n’est pas cassée. Un choix,
                jamais un manque.
              </span>
            </>
          )}
        </div>
      </div>

      {/* Explicit declarations are cancellable; a weekend-off day is managed in
          /account/rythme, so we only offer the declare/undo buttons for the
          explicit case. */}
      {!isWeekendOff &&
        (isOff ? (
          <button
            type="button"
            onClick={undo}
            disabled={isPending}
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)] focus-visible:rounded focus-visible:ring-2 focus-visible:ring-[var(--b-acc)] focus-visible:outline-none disabled:opacity-50"
          >
            {isPending ? (
              <Loader2
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin motion-reduce:hidden"
              />
            ) : (
              <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            Annuler le jour off
          </button>
        ) : (
          <button
            type="button"
            data-slot="today-off-declare"
            onClick={declare}
            disabled={isPending}
            className="rounded-control inline-flex w-fit items-center gap-1.5 border border-[var(--cy-edge-soft)] bg-[var(--cy-dim)] px-3 py-1.5 text-[12px] font-medium text-[var(--cy)] transition-colors hover:border-[var(--cy-edge)] focus-visible:ring-2 focus-visible:ring-[var(--b-acc)] focus-visible:outline-none disabled:opacity-50"
          >
            {isPending ? (
              <Loader2
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin motion-reduce:hidden"
              />
            ) : (
              <CalendarOff aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            Je ne trade pas aujourd’hui
          </button>
        ))}

      <p aria-live="polite" className="min-h-4 text-[12px] text-[var(--t-2)]">
        {message}
      </p>
    </Card>
  );
}
