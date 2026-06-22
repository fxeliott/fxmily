import { CalendarX, CheckCircle2, Circle, CircleDashed, type LucideIcon } from 'lucide-react';

import { MeetingDeclareForm } from '@/components/reunions/meeting-declare-form';
import { Card } from '@/components/ui/card';
import { Pill, type PillProps } from '@/components/ui/pill';
import type { MeetingDisplayState, MemberMeetingView } from '@/lib/meeting/service';
import type { MeetingSlotName } from '@/lib/meeting/occurrence';
import { cn } from '@/lib/utils';

/**
 * V1.7 §30 J-M2 — one meeting row on `/reunions` (Server Component).
 *
 * Neutral DS-v3 accent-blue tone (anti Black-Hat, SPEC §30.7): the state badge uses
 * an icon + a text label (WCAG 1.4.1 — never colour alone) and NEVER the red
 * `bad` tone. A cancelled meeting is greyed and shows no declaration form.
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
  cancelled: { label: 'Annulée', tone: 'mute', Icon: CalendarX },
};

export function MeetingItem({ meeting }: { meeting: MemberMeetingView }) {
  const time = SLOT_TIME[meeting.slot];
  const dateLabel = DATE_FMT.format(new Date(meeting.scheduledAt));
  const title = `Réunion ${time} — ${dateLabel}`;
  const meta = STATE_META[meeting.displayState];
  const { Icon } = meta;
  const isCancelled = meeting.status === 'cancelled';

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

      {meeting.declarable ? (
        <MeetingDeclareForm
          meetingId={meeting.id}
          contentLabel={SLOT_CONTENT_LABEL[meeting.slot]}
          initialMode={meeting.attendanceMode}
          initialContentReviewed={meeting.contentReviewed}
        />
      ) : (
        <p className="t-cap text-[var(--t-3)]">
          Réunion annulée — pas de présence à déclarer. Tu n&apos;es pas pénalisé.
        </p>
      )}
    </Card>
  );
}
