import {
  CalendarX,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleSlash,
  Info,
  type LucideIcon,
} from 'lucide-react';

import { MeetingDeclareForm } from '@/components/reunions/meeting-declare-form';
import { Card } from '@/components/ui/card';
import { Pill, type PillProps } from '@/components/ui/pill';
import type { AttendanceGap } from '@/lib/meeting/attendance-gap';
import type { MeetingDisplayState, MemberMeetingView } from '@/lib/meeting/service';
import type { MeetingSlotName } from '@/lib/meeting/occurrence';
import { cn } from '@/lib/utils';

/**
 * V1.7 §30 J-M2 — one meeting row on `/reunions` (Server Component).
 *
 * Neutral DS-v3 accent-blue tone (anti Black-Hat, SPEC §30.7): the state badge uses
 * an icon + a text label (WCAG 1.4.1 — never colour alone) and NEVER the red
 * `bad` tone. A cancelled meeting is greyed and shows no declaration form.
 *
 * S10 §30.8 — when Eliott's presence declaration differs from the member's own
 * (`meeting.gap !== 'none'`), a CALM recoupement note explains the écart, never
 * an accusation (the engagement numerator already handles an over-claim quietly).
 */

// Hoisted at module level (per-row instantiation would be wasteful — canon
// J8 review/reflect pages). Europe/Paris fixed (V1 cohort = France, SPEC §16).
const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
});

const SLOT_TIME: Record<MeetingSlotName, string> = { midday: '12h', evening: '20h' };
const SLOT_SUBTITLE: Record<MeetingSlotName, string> = {
  midday: 'Analyse Ichor',
  evening: 'Bilan / débrief Ichor',
};
/** The content the member confirms having read (booleans only — never stored). */
const SLOT_CONTENT_LABEL: Record<MeetingSlotName, string> = {
  midday: "J'ai lu l'analyse Ichor",
  evening: 'J’ai lu le bilan Ichor',
};

const STATE_META: Record<
  MeetingDisplayState,
  { label: string; tone: NonNullable<PillProps['tone']>; Icon: LucideIcon }
> = {
  complete: { label: 'Complète', tone: 'acc', Icon: CheckCircle2 },
  partielle: { label: 'Partielle', tone: 'warn', Icon: CircleDashed },
  en_attente: { label: 'En attente', tone: 'mute', Icon: Circle },
  // F4 — the member declared they couldn't attend. Calm mute tone, NEVER red
  // (§31.2): an acknowledged absence is honest data, not a failure.
  absent: { label: 'Absent', tone: 'mute', Icon: CircleSlash },
  cancelled: { label: 'Annulée', tone: 'mute', Icon: CalendarX },
};

/**
 * S10 §30.8 — calm member-facing copy for each cross-check écart. Posture §2 /
 * anti Black-Hat: factual + actionable, never a red accusation. `null` =
 * `gap === 'none'` (no note).
 */
const GAP_NOTE: Record<Exclude<AttendanceGap, 'none'>, string> = {
  admin_absent_member_present:
    "Eliott t'a noté absent à cette réunion, ce qui diffère de ta déclaration. Elle n'est donc pas comptée dans ton assiduité. Si c'est une erreur, parles-en à Eliott.",
  admin_present_member_absent:
    "Eliott t'a noté présent à cette réunion. Confirme ta présence ci-dessus pour qu'elle compte dans ton assiduité.",
  admin_present_member_partial:
    "Eliott t'a noté présent. Complète ta déclaration (mode + lecture du contenu) pour valider la réunion.",
};

export function MeetingItem({
  meeting,
  showDate = true,
}: {
  meeting: MemberMeetingView;
  /**
   * F4 — when the card is rendered UNDER a per-day header ({@link MeetingDayGroup}),
   * the full date is already shown by the header, so the card title collapses to
   * just the slot time ("Réunion 12h") to avoid repeating it. Defaults to `true`
   * (the standalone card keeps the full "Réunion 12h — lundi 30 juin" title).
   */
  showDate?: boolean;
}) {
  const time = SLOT_TIME[meeting.slot];
  const dateLabel = DATE_FMT.format(new Date(meeting.scheduledAt));
  const title = showDate ? `Réunion ${time} — ${dateLabel}` : `Réunion ${time}`;
  const meta = STATE_META[meeting.displayState];
  const { Icon } = meta;
  const isCancelled = meeting.status === 'cancelled';
  const gapNote = meeting.gap === 'none' ? null : GAP_NOTE[meeting.gap];

  return (
    <Card
      className={cn(
        'group relative flex flex-col gap-3 p-4',
        isCancelled ? 'opacity-60' : 'wow-hover-glow',
      )}
    >
      {/* S18 — liseré supérieur cool décoratif (acc), neutre §30.7 (jamais rouge),
          s'intensifie au survol. Masqué sur une réunion annulée (déjà grisée). */}
      {!isCancelled ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 right-3 left-3 z-10 h-px opacity-70 transition-opacity duration-200 group-hover:opacity-100"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, var(--acc-edge) 50%, transparent 100%)',
          }}
        />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="t-body font-medium text-[var(--t-1)]">{title}</h3>
          <p className="t-cap text-[var(--t-3)]">{SLOT_SUBTITLE[meeting.slot]}</p>
        </div>
        <Pill tone={meta.tone} className="shrink-0">
          <Icon className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
          {meta.label}
        </Pill>
      </div>

      {/* S10 §30.8 — recoupement note (calm, never red). Shown above the form so
          the member reads the cross-check before (re-)declaring. */}
      {gapNote ? (
        <p
          className="t-cap rounded-control flex items-start gap-1.5 border border-[var(--b-default)] bg-[var(--bg-1)] px-2.5 py-2 text-[var(--t-2)]"
          role="note"
        >
          <Info
            className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--t-3)]"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span>{gapNote}</span>
        </p>
      ) : null}

      {meeting.declarable ? (
        <MeetingDeclareForm
          meetingId={meeting.id}
          contentLabel={SLOT_CONTENT_LABEL[meeting.slot]}
          initialMode={meeting.attendanceMode}
          initialContentReviewed={meeting.contentReviewed}
          initialDeclaredAbsent={meeting.memberDeclaredAbsent}
        />
      ) : (
        <p className="t-cap text-[var(--t-3)]">
          Réunion annulée — pas de présence à déclarer. Tu n&apos;es pas pénalisé.
        </p>
      )}
    </Card>
  );
}
