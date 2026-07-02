import { ArrowLeft, Clapperboard } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { SeanceAdminCell } from '@/components/admin/seances/seance-admin-cell';
import { SeanceDiscordPanel } from '@/components/admin/seances/seance-discord-panel';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { listSeancesForAdmin } from '@/lib/seances/admin-service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Séances · Admin',
};

export const dynamic = 'force-dynamic';

/**
 * Réunion hub (séances) — `/admin/seances` admin surface (J3).
 *
 * Server Component, admin-gated (proxy.ts `/admin/*` role check + a defensive
 * `redirect('/login')` here, carbone `admin/reunions/page`). Eliott declares
 * go/no-go per `(date, slot)` over a rolling calendar, copies the 6 Discord
 * messages of the last held séance, and watches the pipeline status — the
 * faithful J4 pipeline fills the editorial content + checkpoints.
 *
 * DISTINCT from `/admin/reunions` (meeting attendance tracker): this surface
 * governs the recorded séance content, not member presence. 0 FK to User →
 * platform-wide, no member PII (posture §2).
 */
export default async function AdminSeancesPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const { stats, days, latestMessages } = await listSeancesForAdmin();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-8 lg:px-8">
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
              <Clapperboard className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Séances du hub
            </span>
          </div>
          <h1
            className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Go / No-Go des séances
          </h1>
          <p className="t-cap text-[var(--t-3)]">
            Déclare, pour chaque créneau, si la séance a été tenue (publiée), annulée, ou simplement
            prévue. Une séance tenue ne peut pas revenir à « prévue », tu peux l&apos;annuler. La
            rédaction (résumé, analyses, messages Discord) est produite automatiquement à partir de
            tes séances.
          </p>
        </div>

        <div className="border-edge-top rounded-card relative grid grid-cols-2 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] shadow-[var(--sh-card)] sm:grid-cols-4">
          <StatCell label="Déclarées" value={stats.declared} hint="sur la période" tone="acc" />
          <StatCell
            label="Tenues"
            value={stats.done}
            hint={stats.done > 0 ? 'publiées' : '—'}
            tone={stats.done > 0 ? 'ok' : 'mute'}
          />
          <StatCell
            label="À venir"
            value={stats.upcoming}
            hint={stats.upcoming > 0 ? 'prévues' : '—'}
            tone={stats.upcoming > 0 ? 'acc' : 'mute'}
          />
          <StatCell
            label="Annulées"
            value={stats.cancelled}
            hint={stats.cancelled > 0 ? 'indispo' : '—'}
            tone={stats.cancelled > 0 ? 'warn' : 'mute'}
          />
        </div>
      </header>

      {latestMessages ? <SeanceDiscordPanel latest={latestMessages} /> : null}

      <section aria-label="Calendrier des séances" className="flex flex-col gap-5">
        {days.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              icon={Clapperboard}
              headline="Aucun créneau sur la période."
              lead="Les créneaux des jours ouvrés à venir apparaîtront ici. Déclare le go/no-go d'une séance dès qu'elle est tenue."
            />
          </Card>
        ) : (
          days.map((day) => (
            <div key={day.date} className="flex flex-col gap-3">
              <h2 className="t-eyebrow-lg text-[var(--t-2)] first-letter:uppercase">{day.label}</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {day.cells.map((cell) => (
                  <li
                    key={`${cell.date}-${cell.slot}`}
                    data-seance-cell={`${cell.date}#${cell.slot}`}
                  >
                    <SeanceAdminCell cell={cell} />
                  </li>
                ))}
              </ul>
            </div>
          ))
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
        'group/stat relative flex flex-col gap-1 overflow-hidden border-r border-b border-[var(--b-default)] p-4 transition-colors duration-200 last:border-r-0 sm:border-b-0',
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
