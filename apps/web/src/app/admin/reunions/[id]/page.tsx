import { ArrowLeft, CalendarX, CircleCheck, TriangleAlert, Users } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MeetingRosterMemberRow } from '@/components/admin/meeting-roster-member-row';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { listMeetingRosterForAdmin } from '@/lib/meeting/service';
import type { MeetingSlotName } from '@/lib/meeting/occurrence';

export const metadata = {
  title: 'Feuille de présence · Admin',
};

export const dynamic = 'force-dynamic';

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

interface RosterPageProps {
  params: Promise<{ id: string }>;
}

/**
 * F4 — `/admin/reunions/[id]` per-meeting presence roster (SPEC §30.4 Admin).
 *
 * Server Component, admin-gated (redirect '/login' otherwise — carbone the
 * `/admin/reunions` list). Lets Eliott tick a whole cohort present/absent on one
 * sheet: every active member, their self-report, whether they OWNED an absence,
 * and the marking control (reused from S10 §30.8). The admin↔membre écarts are
 * surfaced calmly per row (never a red shame surface, posture §2 / §30.7).
 */
export default async function AdminMeetingRosterPage({ params }: RosterPageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const { id } = await params;
  const roster = await listMeetingRosterForAdmin(id);
  if (!roster) notFound();

  const { meeting, members, gapCount } = roster;
  const isCancelled = meeting.status === 'cancelled';
  const time = SLOT_TIME[meeting.slot];
  const dateLabel = DATE_FMT.format(new Date(meeting.scheduledAt));
  const markedPresent = members.filter((m) => m.adminPresent === true).length;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 lg:px-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/admin/reunions"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Créneaux
        </Link>

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="acc">ADMIN</Pill>
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <Users className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Feuille de présence
            </span>
            {meeting.isPast ? <Pill tone="mute">Passée</Pill> : <Pill tone="acc">À venir</Pill>}
            {isCancelled ? (
              <Pill tone="warn">
                <CalendarX className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
                Annulée
              </Pill>
            ) : null}
          </div>
          <h1
            className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Réunion {time} · {dateLabel}
          </h1>
          <p className="t-cap text-[var(--t-3)]">{SLOT_SUBTITLE[meeting.slot]}</p>
        </div>

        {/* Neutral count summary (posture §2 — counts only, never a per-member
            shame surface; the roster below is the actionable detail). */}
        {!isCancelled ? (
          <p className="t-cap inline-flex flex-wrap items-center gap-1.5 text-[var(--t-3)]">
            <Pill tone="cy">
              <Users className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
              {members.length} membre{members.length > 1 ? 's' : ''}
            </Pill>
            {markedPresent > 0 ? (
              <Pill tone="acc">
                <CircleCheck className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
                {markedPresent} noté{markedPresent > 1 ? 's' : ''} présent
                {markedPresent > 1 ? 's' : ''}
              </Pill>
            ) : null}
            {gapCount > 0 ? (
              <Pill tone="warn">
                <TriangleAlert className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
                {gapCount} écart{gapCount > 1 ? 's' : ''} à revoir
              </Pill>
            ) : null}
          </p>
        ) : (
          <p className="t-cap text-[var(--t-3)]">
            Ce créneau est annulé : aucune présence à marquer. Personne n&apos;est pénalisé.
          </p>
        )}
      </header>

      <section aria-label="Feuille de présence des membres">
        {members.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              icon={Users}
              headline="Aucun membre actif."
              lead="Dès qu’un membre actif rejoint la cohorte, il apparaît ici avec son état de présence pour ce créneau."
            />
          </Card>
        ) : (
          <Card className="p-4 sm:p-5">
            <ul className="flex flex-col">
              {members.map((member) => (
                <MeetingRosterMemberRow
                  key={member.memberId}
                  member={member}
                  meetingId={meeting.id}
                  markable={!isCancelled}
                />
              ))}
            </ul>
          </Card>
        )}
      </section>
    </main>
  );
}
