import { CheckinDayList } from '@/components/checkin/checkin-day-list';
import { Card } from '@/components/ui/card';
import { detectRepeatedJustifications } from '@/lib/checkin/justification-repeat';
import type { SerializedCheckin } from '@/lib/checkin/service';

/**
 * S7 §22-23 — admin read-only daily check-ins panel (« TOUT tracker pour
 * l'admin »). Server-rendered, zero mutation, calm factual copy.
 *
 * F7 Layer 2 — the day-by-day rendering now lives in the shared
 * {@link CheckinDayList} (single source of truth with the member's own
 * `/checkin/history` page); this panel only carries the admin-specific
 * empty-state copy. The shared list also surfaces « rattrapage » justifications,
 * so the admin sees when a member filled a day late and why.
 *
 * SPEC §2 posture: a check-in carries NO market content — `intention` is a
 * one-line mindset note, the booleans are declarative discipline ACTS.
 */

interface MemberCheckinsPanelProps {
  checkins: SerializedCheckin[];
  /**
   * Tour 14 — the OFF days among the listed days (resolved in the page via
   * `getOffDaySet` + `isOffDay`, member timezone). The shared list marks an
   * unfilled slot on an off day as « Jour off » instead of « Non rempli. », so
   * the admin reads a chosen off day, never a missing check-in (§31.2 posture).
   */
  offDates?: ReadonlySet<string>;
}

export function MemberCheckinsPanel({ checkins, offDates }: MemberCheckinsPanelProps) {
  // F7 §33.2 — deterministic reuse signal, ADMIN-ONLY (this panel never renders
  // on a member surface). Flags rattrapage justifications a member re-uses.
  const repeatSignals = detectRepeatedJustifications(checkins);
  return (
    <CheckinDayList
      checkins={checkins}
      // Only forward when present — `exactOptionalPropertyTypes` rejects an
      // explicit `undefined` on an optional prop.
      {...(offDates ? { offDates } : {})}
      repeatSignals={repeatSignals}
      emptyState={
        <Card className="p-6 text-center">
          <p className="t-body text-[var(--t-3)]">
            Ce membre n&apos;a encore rempli aucun check-in.
          </p>
          <p className="t-cap mt-1 text-[var(--t-4)]">
            Les check-ins matin / soir apparaîtront ici dès qu&apos;il en remplira un.
          </p>
        </Card>
      }
    />
  );
}
