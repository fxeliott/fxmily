import { Circle, CircleDashed, CircleSlash, CheckCircle2, type LucideIcon } from 'lucide-react';

import { PresenceMarkControl } from '@/components/admin/presence-mark-control';
import { Pill, type PillProps } from '@/components/ui/pill';
import type { AdminMeetingAttendanceState, MeetingRosterMemberView } from '@/lib/meeting/service';

/**
 * F4 — one member row on the per-meeting roster (`/admin/reunions/[id]`, Server
 * Component). Shows WHO the member is, their self-reported state, whether they
 * explicitly declared an absence, and the admin marking control (reused verbatim
 * from S10 §30.8 — the write authority + cross-check live server-side).
 *
 * Posture §2 / anti Black-Hat (SPEC §30.7): neutral tones, NEVER punitive red.
 * The self-report is the member's — the admin mark sits BESIDE it (never rewrites
 * it), and the écart (if any) is surfaced by {@link PresenceMarkControl} as a calm
 * coaching badge. The "a déclaré absent" badge is honest data, not a reproach.
 */

const STATE_META: Record<
  AdminMeetingAttendanceState,
  { label: string; tone: NonNullable<PillProps['tone']>; Icon: LucideIcon }
> = {
  complete: { label: 'Complète', tone: 'acc', Icon: CheckCircle2 },
  partielle: { label: 'Partielle', tone: 'warn', Icon: CircleDashed },
  absent: { label: 'Rien déclaré', tone: 'mute', Icon: Circle },
  cancelled: { label: 'Annulée', tone: 'mute', Icon: CircleSlash },
};

export function MeetingRosterMemberRow({
  member,
  meetingId,
  markable,
}: {
  member: MeetingRosterMemberView;
  meetingId: string;
  /** False on a cancelled slot — the marking control is shown disabled. */
  markable: boolean;
}) {
  const meta = STATE_META[member.state];
  const { Icon } = meta;

  return (
    <li className="flex flex-col gap-2.5 border-t border-[var(--b-default)] py-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="t-body truncate font-medium text-[var(--t-1)]">{member.displayName}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={meta.tone}>
            <Icon className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
            {meta.label}
          </Pill>
          {/* F4 — an OWNED absence, distinct from a silent one (extra data for J2). */}
          {member.memberDeclaredAbsent ? (
            <Pill tone="mute">
              <CircleSlash className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />A déclaré
              absent
            </Pill>
          ) : null}
        </div>
      </div>

      <div className="shrink-0">
        <PresenceMarkControl
          memberId={member.memberId}
          meetingId={meetingId}
          adminPresent={member.adminPresent}
          gap={member.gap}
          disabled={!markable}
        />
      </div>
    </li>
  );
}
