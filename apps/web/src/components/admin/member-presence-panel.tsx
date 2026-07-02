import { CalendarX, CheckCircle2, Circle, CircleDashed, type LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill, type PillProps } from '@/components/ui/pill';
import { PresenceMarkControl } from '@/components/admin/presence-mark-control';
import type {
  AdminMeetingAttendanceState,
  AdminMemberAttendanceResult,
} from '@/lib/meeting/service';
import type { MeetingSlotName } from '@/lib/meeting/occurrence';
import { MEETING_WINDOW_DAYS } from '@/lib/meeting/window';
import { cn } from '@/lib/utils';

/**
 * V1.7 §30 J-M3 — admin "Présence" tab panel (SPEC §30.4 Admin (b)).
 *
 * Read-only admin view of one member's meeting attendance over the rolling 30d
 * window: the honest rate + a per-meeting detail list. DS-v2 dark (never
 * `.v18-theme`, never cyan §21.7).
 *
 * Posture §2 / anti Black-Hat (SPEC §30.7): NEUTRAL tone, NEVER red/punitive.
 * The "absent" state is an admin signal (coaching), shown calmly with an icon +
 * text label (WCAG 1.4.1 — never colour alone), never as a shame surface. A
 * cancelled slot is greyed + excluded from the rate (a member is never
 * penalised when Eliott was away). NO Ichor content — booleans only.
 *
 * S10 §30.8 — each scheduled row carries the {@link PresenceMarkControl}: Eliott
 * declares the member's presence (présent / absent / effacer), and the cross-
 * check ÉCART vs the member self-report is surfaced as a calm badge. The state
 * above (`STATE_META`) reflects the MEMBER self-report; the control + écart badge
 * reflect Eliott's declaration — the two sides stay visibly distinct (§30.8).
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

// `absent` uses the neutral `mute` tone (NOT `bad`) — admin signal, never a
// punitive red (anti Black-Hat, SPEC §30.7).
const STATE_META: Record<
  AdminMeetingAttendanceState,
  { label: string; tone: NonNullable<PillProps['tone']>; Icon: LucideIcon }
> = {
  complete: { label: 'Complète', tone: 'acc', Icon: CheckCircle2 },
  partielle: { label: 'Partielle', tone: 'warn', Icon: CircleDashed },
  absent: { label: 'Non déclarée', tone: 'mute', Icon: Circle },
  cancelled: { label: 'Annulée', tone: 'mute', Icon: CalendarX },
};

export function MemberPresencePanel({
  data,
  memberId,
}: {
  data: AdminMemberAttendanceResult;
  memberId: string;
}) {
  const { meetings, rate } = data;

  return (
    <div className="flex flex-col gap-4">
      {/* Attendance rate — neutral, honest. Never a fake "0 %". */}
      <Card primary className="p-4">
        <h2 className="t-eyebrow-lg text-[var(--t-3)]">
          Assiduité · {MEETING_WINDOW_DAYS} derniers jours
        </h2>
        {rate.kind === 'ok' ? (
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="f-display text-[32px] leading-none font-bold text-[var(--acc)]">
              {Math.round(rate.rate * 100)}
              <span className="text-[var(--t-3)]"> %</span>
            </span>
            <span className="t-cap text-[var(--t-3)]">
              {rate.completedCount} / {rate.scheduledCount} réunion
              {rate.scheduledCount > 1 ? 's' : ''} complète{rate.scheduledCount > 1 ? 's' : ''}
            </span>
          </div>
        ) : (
          <p className="t-cap mt-1.5 text-[var(--t-3)]">
            Aucune réunion sur les {MEETING_WINDOW_DAYS} derniers jours, pas de taux à afficher
            (jamais un « 0 % » trompeur).
          </p>
        )}
      </Card>

      {/* Per-meeting detail */}
      {meetings.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={Circle}
            headline="Aucune réunion sur la période."
            lead="Dès qu'une réunion aura eu lieu dans la fenêtre des 30 jours, le détail de la présence de ce membre apparaîtra ici."
          />
        </Card>
      ) : (
        <Card className="p-0">
          <header className="flex items-center gap-2 border-b border-[var(--b-default)] px-5 py-4">
            <h2 className="t-h2 text-[15px]">Détail par réunion</h2>
            <Pill tone="mute">{meetings.length}</Pill>
          </header>
          <ul className="flex flex-col">
            {meetings.map((m) => {
              const meta = STATE_META[m.state];
              const { Icon } = meta;
              const time = SLOT_TIME[m.slot];
              const isCancelled = m.status === 'cancelled';
              return (
                <li
                  key={m.id}
                  className={cn(
                    'flex flex-col gap-2 border-b border-[var(--b-default)] px-5 py-3 last:border-b-0',
                    isCancelled && 'opacity-60',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="t-body text-[var(--t-1)]">
                        Réunion {time} · {DATE_FMT.format(new Date(m.scheduledAt))}
                      </span>
                      <span className="t-cap text-[var(--t-3)]">
                        {SLOT_SUBTITLE[m.slot]} · déclaration du membre
                      </span>
                    </div>
                    <Pill tone={meta.tone} className="shrink-0">
                      <Icon className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
                      {meta.label}
                    </Pill>
                  </div>
                  {/* S10 §30.8 — Eliott's presence declaration + cross-check. A
                      cancelled slot offers no marking (no presence on a slot that
                      did not run, §30.2). */}
                  {isCancelled ? null : (
                    <PresenceMarkControl
                      memberId={memberId}
                      meetingId={m.id}
                      adminPresent={m.adminPresent}
                      gap={m.gap}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
