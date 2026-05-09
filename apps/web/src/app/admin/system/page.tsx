import { Activity, ArrowLeft, Database, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { btnVariants } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { logAudit } from '@/lib/auth/audit';
import {
  getCronHealthReport,
  getSystemSnapshot,
  type CronHealthEntry,
  type CronStatus,
} from '@/lib/system/health';

/**
 * `/admin/system` — observability dashboard for prod ops.
 *
 * Surfaces in one render :
 *  - per-cron heartbeat status (green/amber/red/never_ran) computed from
 *    the latest `cron.*.scan` audit row vs the expected period
 *  - cohort snapshot (active / scheduled-deletion / soft-deleted users)
 *  - push subscription count
 *  - audit log volume last 24h
 *
 * Server Component — pure SSR, no client JS. Auth-gated to admin role.
 */

export const metadata: Metadata = {
  title: 'État système · Fxmily Admin',
  description: 'Dashboard observability prod — cron heartbeats + cohort snapshot + audit volume.',
};
export const dynamic = 'force-dynamic';

export default async function AdminSystemPage(): Promise<React.ReactElement> {
  const session = await auth();
  // J10 Phase L review H3 : align with every other admin gate
  // (cards/page.tsx, members/page.tsx, …) — admins whose status flipped
  // to 'deleted' still hold a valid JWT for up to 30d ; locking on
  // `status === 'active'` prevents a soft-deleted admin from peeking
  // at observability data they no longer have a right to.
  if (!session?.user || session.user.role !== 'admin' || session.user.status !== 'active') {
    redirect('/login?redirect=/admin/system');
  }

  const [report, snapshot] = await Promise.all([getCronHealthReport(), getSystemSnapshot()]);

  await logAudit({
    action: 'admin.system.viewed',
    userId: session.user.id,
    metadata: { overall: report.overall },
  });

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-10">
      <header className="mb-6">
        <Link
          href="/admin"
          className={btnVariants({ kind: 'ghost', size: 'm' })}
          aria-label="Retour à l’admin"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Admin
        </Link>
        <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--acc)]">
          Observability
        </p>
        <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight text-[var(--t-1)] sm:text-3xl">
          État système
          <OverallStatusPill status={report.overall} />
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-[var(--t-2)]">
          Dernier scan {formatRelative(report.ranAt)}. Couverture : 7 crons, soft-delete pipeline,
          audit log volume 24h. Source de vérité = audit_logs (gap depuis le dernier{' '}
          <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px]">
            cron.X.scan
          </code>
          ).
        </p>
      </header>

      <section
        aria-labelledby="cohort-heading"
        className="mb-8 rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
          >
            <Database className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="cohort-heading" className="text-base font-semibold text-[var(--t-1)]">
              Cohorte
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--t-3)]">
              Snapshot temps réel des users + push subscriptions + audit volume.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SnapshotCard
            label="Membres actifs"
            value={snapshot.members.active}
            sublabel="status='active', deletedAt=null"
          />
          <SnapshotCard
            label="Suppressions programmées"
            value={snapshot.members.deletionScheduled}
            sublabel="grace 24h en cours"
            tone={snapshot.members.deletionScheduled > 0 ? 'warn' : 'mute'}
          />
          <SnapshotCard
            label="Soft-deleted (purge < 30j)"
            value={snapshot.members.softDeleted}
            sublabel="status='deleted'"
            tone="mute"
          />
          <SnapshotCard
            label="Push subscriptions"
            value={snapshot.push.activeSubscriptions}
            sublabel="actives (toutes lastSeenAt)"
          />
          <SnapshotCard
            label="Audit rows · 24h"
            value={snapshot.audit.last24h}
            sublabel="volume tous types"
          />
        </dl>
      </section>

      <section
        aria-labelledby="crons-heading"
        className="rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
          >
            <Activity className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="crons-heading" className="text-base font-semibold text-[var(--t-1)]">
              Crons heartbeat
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--t-3)]">
              Chaque cron émet un audit row{' '}
              <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px]">
                cron.&lt;route&gt;.scan
              </code>{' '}
              à chaque exécution. Vert = âge ≤ 1.5× période · Ambre = ≤ tolérance · Rouge = au-delà.
            </p>
          </div>
        </div>

        <ul className="mt-5 divide-y divide-[var(--b-subtle)]">
          {report.entries.map((entry) => (
            <CronRow key={entry.action} entry={entry} />
          ))}
        </ul>
      </section>

      <p className="mt-8 flex items-center gap-1.5 text-[11px] text-[var(--t-3)]">
        <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-[var(--acc-hi)]" />
        Page accessible aux <strong>admin</strong> uniquement. Le workflow GitHub{' '}
        <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px]">
          cron-watch.yml
        </code>{' '}
        appelle le même endpoint{' '}
        <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px]">
          /api/cron/health
        </code>{' '}
        toutes les heures et ouvre une issue si statut rouge.
      </p>
    </main>
  );
}

function SnapshotCard({
  label,
  value,
  sublabel,
  tone = 'acc',
}: {
  label: string;
  value: number;
  sublabel: string;
  tone?: 'acc' | 'warn' | 'mute';
}): React.ReactElement {
  const accentClass =
    tone === 'warn'
      ? 'text-[var(--warn)]'
      : tone === 'mute'
        ? 'text-[var(--t-2)]'
        : 'text-[var(--acc-hi)]';
  return (
    <div className="rounded-xl border border-[var(--b-subtle)] bg-[var(--bg-2)] p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--t-3)]">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${accentClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--t-4)]">{sublabel}</p>
    </div>
  );
}

function CronRow({ entry }: { entry: CronHealthEntry }): React.ReactElement {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-[var(--t-1)]">{entry.label}</p>
          <CronStatusPill status={entry.status} />
        </div>
        <p className="mt-1 text-[11px] text-[var(--t-3)]">
          <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px]">
            {entry.action}
          </code>{' '}
          · période {formatDuration(entry.periodMs)} · tolérance {formatDuration(entry.toleranceMs)}
        </p>
      </div>
      <div className="text-right text-xs text-[var(--t-2)]">
        {entry.lastRanAt ? (
          <>
            <p className="font-mono tabular-nums">
              {entry.ageMs !== null ? formatDuration(entry.ageMs) : '—'}
            </p>
            <p className="text-[10px] text-[var(--t-4)]">{formatTimestamp(entry.lastRanAt)}</p>
          </>
        ) : (
          <p className="text-[var(--bad)]">Jamais exécuté</p>
        )}
      </div>
    </li>
  );
}

function OverallStatusPill({ status }: { status: CronStatus }): React.ReactElement {
  const tone = status === 'green' ? 'ok' : status === 'amber' ? 'warn' : 'bad';
  const label =
    status === 'green'
      ? 'Tout vert'
      : status === 'amber'
        ? 'Surveillance'
        : status === 'never_ran'
          ? 'Pas démarré'
          : 'Incident';
  return <Pill tone={tone}>{label}</Pill>;
}

function CronStatusPill({ status }: { status: CronStatus }): React.ReactElement {
  const tone =
    status === 'green' ? 'ok' : status === 'amber' ? 'warn' : status === 'red' ? 'bad' : 'mute';
  const label =
    status === 'green' ? 'OK' : status === 'amber' ? 'Lent' : status === 'red' ? 'Stale' : 'Jamais';
  return <Pill tone={tone}>{label}</Pill>;
}

function formatRelative(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}j`;
}
