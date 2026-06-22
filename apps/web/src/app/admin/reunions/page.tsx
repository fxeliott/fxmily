import { ArrowLeft, CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { AdminMeetingRow } from '@/components/admin/admin-meeting-row';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { listMeetingsForAdmin } from '@/lib/meeting/service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Réunions · Admin',
};

export const dynamic = 'force-dynamic';

/**
 * V1.7 §30 J-M3 — `/admin/reunions` admin surface (SPEC §30.4 Admin (a)).
 *
 * Server Component, DS-v2 dark (never `.v18-theme`, never cyan §21.7). Auth
 * role === 'admin' (redirect '/login' otherwise — carbone `admin/members/page`).
 * Lists recent + upcoming meeting slots with their per-meeting attendance
 * counts and a cancel/uncancel control per slot.
 *
 * No dedicated "viewed" audit slug: the SPEC §30.4 admin part only mandates the
 * presence-tab reuse of `admin.member.viewed`; a fresh `admin.reunions.listed`
 * slug would breach the anti-accumulation doctrine §20 (the cancel action's
 * `admin.meeting.cancelled` is the only new admin slug §30 needs).
 *
 * Posture §2 / anti Black-Hat (SPEC §30.7): neutral chrome, counts only, never
 * a per-member shame surface; cancelled slots greyed (the row handles it).
 */
export default async function AdminReunionsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const meetings = await listMeetingsForAdmin();

  const totalScheduled = meetings.filter((m) => m.status === 'scheduled').length;
  const totalCancelled = meetings.filter((m) => m.status === 'cancelled').length;
  const totalUpcoming = meetings.filter((m) => !m.isPast && m.status === 'scheduled').length;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-8 lg:px-8">
      {/* S19.2 — widened from max-w-3xl (768px, stranded on ultra-wide) so the
          md:2 / xl:3 meeting grid below can actually breathe; sibling admin
          surfaces are full-width. */}
      <header className="flex flex-col gap-4">
        <Link
          href="/admin/members"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Membres
        </Link>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Pill tone="acc">ADMIN</Pill>
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Réunions Fxmily
            </span>
          </div>
          <h1
            className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Créneaux
          </h1>
          <p className="t-cap text-[var(--t-3)]">
            Les créneaux Lun–Ven 12h/20h sont générés automatiquement. Annule un créneau quand tu
            n&apos;es pas dispo — il est alors exclu du taux d&apos;assiduité des membres (personne
            n&apos;est pénalisé).
          </p>
        </div>

        {/* Stats strip */}
        <div className="border-edge-top rounded-card relative grid grid-cols-3 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] shadow-[var(--sh-card)]">
          <StatCell label="Créneaux" value={totalScheduled} hint="programmés" tone="acc" />
          <StatCell
            label="À venir"
            value={totalUpcoming}
            hint={totalUpcoming > 0 ? 'prochains' : '—'}
            tone={totalUpcoming > 0 ? 'ok' : 'mute'}
          />
          <StatCell
            label="Annulés"
            value={totalCancelled}
            hint={totalCancelled > 0 ? 'indispo' : '—'}
            tone={totalCancelled > 0 ? 'warn' : 'mute'}
          />
        </div>
      </header>

      <section aria-label="Liste des créneaux" className="flex flex-col gap-3">
        {meetings.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              icon={CalendarClock}
              headline="Aucun créneau sur la période."
              lead="Les réunions Lun–Ven 12h/20h sont matérialisées par le cron quotidien (jours ouvrés). Dès la prochaine génération, les créneaux apparaîtront ici."
              tip="Tu n'as rien à créer à la main : le cron s'en charge. Ton seul geste ici, c'est d'annuler un créneau quand tu n'es pas dispo."
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {meetings.map((meeting) => (
              // `.wow-reveal` class (not a framer wrapper) keeps the list
              // structure intact for the admin e2e; a cancelled row keeps its
              // inner `opacity-60` (greyed, posture §30.7) untouched. No-JS safe.
              <li key={meeting.id} className="wow-reveal">
                <AdminMeetingRow meeting={meeting} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StatCell({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'default' | 'mute' | 'ok' | 'warn' | 'bad' | 'acc';
}) {
  const valColor =
    tone === 'ok'
      ? 'text-[var(--ok)]'
      : tone === 'warn'
        ? 'text-[var(--warn)]'
        : tone === 'bad'
          ? 'text-[var(--bad)]'
          : tone === 'acc'
            ? 'text-[var(--acc)]'
            : tone === 'mute'
              ? 'text-[var(--t-3)]'
              : 'text-[var(--t-1)]';

  // Colored top liseré + hover wash, per tone. Compositor-only (number scales
  // via transform; cell tints via bg-color). The liseré is a child span so the
  // 3-col border-reset (border-r last:border-r-0) below stays intact.
  const accentBar =
    tone === 'ok'
      ? 'bg-[var(--ok)]'
      : tone === 'warn'
        ? 'bg-[var(--warn)]'
        : tone === 'bad'
          ? 'bg-[var(--bad)]'
          : tone === 'acc'
            ? 'bg-[var(--acc)]'
            : 'bg-[var(--b-strong)]';
  const hoverWash =
    tone === 'ok'
      ? 'hover:bg-[var(--ok-dim)]'
      : tone === 'warn'
        ? 'hover:bg-[var(--warn-dim)]'
        : tone === 'bad'
          ? 'hover:bg-[var(--bad-dim)]'
          : tone === 'acc'
            ? 'hover:bg-[var(--acc-dim)]'
            : 'hover:bg-[var(--bg-2)]';

  return (
    <div
      className={cn(
        'group/stat relative flex flex-col gap-1 overflow-hidden border-r border-[var(--b-default)] p-4 transition-colors duration-200 last:border-r-0',
        hoverWash,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-px origin-left scale-x-0 transition-transform duration-300 ease-out group-hover/stat:scale-x-100 motion-reduce:transition-none',
          accentBar,
        )}
      />
      <span className="t-eyebrow">{label}</span>
      <AnimatedNumber
        value={value}
        className={cn(
          'f-mono origin-left text-[22px] leading-none font-semibold tracking-[-0.02em] transition-transform duration-200 group-hover/stat:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover/stat:scale-100',
          valColor,
        )}
      />
      {hint ? <span className="t-mono-cap">{hint}</span> : null}
    </div>
  );
}
