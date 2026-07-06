import {
  Activity,
  ArrowLeft,
  Bot,
  Database,
  HardDrive,
  Image as ImageIcon,
  ScanEye,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { btnVariants } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { logAudit } from '@/lib/auth/audit';
import {
  buildHostActionsReport,
  getCronHealthReport,
  getDiskHealth,
  getSystemSnapshot,
  getUploadsPersistenceHealth,
  getVerificationBacklogHealth,
  getWorkerHealthReport,
  type CronStatus,
  type DiskHealth,
  type DiskStatus,
  type HeartbeatHealthEntry,
  type HostActionItem,
  type UploadsPersistenceHealth,
  type UploadsPersistenceStatus,
  type VerificationBacklogHealth,
  type VerificationBacklogStatus,
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
  title: 'État système · Admin',
  description: 'Dashboard observability prod : cron heartbeats + cohort snapshot + audit volume.',
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

  const [report, workerReport, snapshot, verificationBacklog] = await Promise.all([
    getCronHealthReport(),
    getWorkerHealthReport(),
    getSystemSnapshot(),
    getVerificationBacklogHealth(),
  ]);

  // Tour 13 — live disk probe (sync, cheap). Read AFTER the awaits so the
  // reading is as fresh as the render. A full shared 40 GB volume stops
  // Postgres AND the backups at once — the one signal that had no continuous
  // monitor until now.
  const disk = getDiskHealth();

  // Tour 14 — live uploads-persistence probe (sync, cheap). Reads /proc/mounts
  // to tell whether member uploads (MT5 proofs) sit on a persistent volume or
  // the container's ephemeral overlay (wiped every deploy). Detection only.
  const uploads = getUploadsPersistenceHealth();

  // Tour 16 — pending host actions, folded from the two reports above (pure, no
  // extra I/O). Surfaces the small set of heartbeat gaps that need a HOST command
  // (root cron sync / worker installer) with the literal command + since when.
  const hostActions = buildHostActionsReport(report, workerReport);

  // The masthead pill must reflect the WHOLE page: a green server-cron board
  // with a red local worker — a proof queue stuck for hours, or member uploads
  // living on the ephemeral layer — is still an incident for the operator.
  const overall = worstStatus(
    worstStatus(
      worstStatus(report.overall, workerReport.overall),
      backlogToCronStatus(verificationBacklog.status),
    ),
    uploadsToCronStatus(uploads.status),
  );

  await logAudit({
    action: 'admin.system.viewed',
    userId: session.user.id,
    metadata: { overall: report.overall, workerOverall: workerReport.overall },
  });

  return (
    <main className="relative mx-auto w-full max-w-[var(--w-app)] px-4 py-6 sm:py-10 lg:px-8 2xl:px-12">
      {/* S19.2 — align the system header on the admin canon (members/reports):
          ambient mesh + f-display masthead. Body LEDs stay deliberately sober. */}
      <DashboardAmbient />
      <header className="relative mb-6">
        <Link
          href="/admin/members"
          className={btnVariants({ kind: 'ghost', size: 'm' })}
          aria-label="Retour aux membres"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Membres
        </Link>
        <p className="mt-4 text-[11px] font-medium tracking-[0.18em] text-[var(--acc)] uppercase">
          Observability
        </p>
        <h1
          className="f-display h-rise mt-2 flex items-center gap-3 text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
          style={{ fontFeatureSettings: '"ss01" 1' }}
        >
          État système
          <OverallStatusPill status={overall} />
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-[var(--t-2)]">
          Dernier scan {formatRelative(report.ranAt)}. Couverture : {report.entries.length} crons +{' '}
          {workerReport.entries.length} pipelines worker IA, soft-delete pipeline, audit log volume
          24h. Source de vérité = audit_logs (gap depuis le dernier{' '}
          <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px]">
            cron.X.scan
          </code>
          ).
        </p>
      </header>

      <HostActionsSection items={hostActions.items} />

      <section
        aria-labelledby="disk-heading"
        className="mb-8 rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
          >
            <HardDrive className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="disk-heading"
              className="flex flex-wrap items-center gap-2 text-base font-semibold text-[var(--t-1)]"
            >
              Espace disque
              <DiskStatusPill status={disk.status} />
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--t-3)]">
              Le volume unique de la VM (40 Go) est partagé par l&apos;app, Postgres et les
              sauvegardes. Un disque plein arrête Postgres et fait échouer la sauvegarde en même
              temps. Sonde en direct à chaque render. Vert au-dessus de {formatGiB(disk.warnBytes)}{' '}
              libres · Ambre en dessous · Rouge sous {formatGiB(disk.criticalBytes)}.
            </p>
          </div>
        </div>

        <DiskGauge disk={disk} />
      </section>

      <section
        aria-labelledby="uploads-heading"
        className="mb-8 rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
          >
            <ImageIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="uploads-heading"
              className="flex flex-wrap items-center gap-2 text-base font-semibold text-[var(--t-1)]"
            >
              Persistance des preuves
              <UploadsPersistencePill status={uploads.status} />
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--t-3)]">
              Les preuves MT5 et captures envoyées par les membres sont écrites sur disque. Si leur
              dossier vit dans la couche éphémère du conteneur (pas de volume Docker), chaque
              déploiement les efface alors que leurs lignes en base survivent, d’où des 404
              silencieux à la lecture. Sonde en direct via{' '}
              <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px]">
                /proc/mounts
              </code>
              . Vert = volume persistant · Rouge = couche éphémère (perte à chaque déploiement).
            </p>
          </div>
        </div>

        <UploadsPersistenceDetail uploads={uploads} />
      </section>

      <section
        aria-labelledby="verification-backlog-heading"
        className="mb-8 rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
          >
            <ScanEye className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="verification-backlog-heading"
              className="flex flex-wrap items-center gap-2 text-base font-semibold text-[var(--t-1)]"
            >
              File de vérification
              <VerificationBacklogPill status={verificationBacklog.status} />
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--t-3)]">
              Les captures d&apos;historique MT5 sont analysées « sur le moment » : le worker passe
              toutes les 5 minutes. On surveille la preuve la plus ancienne encore en attente. Vert
              en dessous d&apos;{formatBacklogDuration(verificationBacklog.amberMs)} · Ambre au-delà
              · Rouge au-delà de {formatBacklogDuration(verificationBacklog.redMs)} (le worker
              aurait dû la traiter).
            </p>
          </div>
        </div>

        <VerificationBacklogDetail backlog={verificationBacklog} />
      </section>

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

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
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
              Les crons à fenêtres horaires sont jugés sur leurs créneaux planifiés (ticks manqués),
              pas sur l’âge brut.
            </p>
          </div>
        </div>

        {/* §23 full-width — heartbeat tuilé 2-up dès xl pour combler le creux
            central qu'une liste full-bleed laisserait à 1600px (label à gauche,
            timing à droite). Séparateur = border-b par row (le grid casse le
            divide-y). Sous xl = 1 colonne. */}
        <ul className="mt-5 grid gap-x-8 xl:grid-cols-2">
          {report.entries.map((entry) => (
            <CronRow key={entry.action} entry={entry} />
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="worker-heading"
        className="mt-8 rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
          >
            <Bot className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="worker-heading"
              className="flex flex-wrap items-center gap-2 text-base font-semibold text-[var(--t-1)]"
            >
              Worker IA · machine locale
              <CronStatusPill status={workerReport.overall} />
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--t-3)]">
              Les 6 batchs Claude tournent sur la machine locale (Task Scheduler), surveillés par un
              watchdog qui répare seul les tâches mortes. Chaque pull émet un audit row{' '}
              <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px]">
                &lt;pipeline&gt;.batch.pulled
              </code>{' '}
              même à zéro membre. Tolérances larges : ambre = PC probablement éteint (normal la
              nuit) · rouge = occurrences manquées en série, la tâche elle-même est en panne. La
              garantie membre reste portée par les filets overdue côté serveur, listés au-dessus.
            </p>
          </div>
        </div>

        <ul className="mt-5 grid gap-x-8 xl:grid-cols-2">
          {workerReport.entries.map((entry) => (
            <CronRow key={entry.action} entry={entry} />
          ))}
        </ul>
      </section>

      {/* items-start + shrink-0 icon + wrapping <span> : a `flex items-center`
          on the whole sentence forced icon + text + both <code> onto ONE
          non-wrapping line → ~481px horizontal overflow at 390px (§243).
          The text now lives in a single flex item that wraps internally. */}
      <p className="mt-8 flex items-start gap-1.5 text-[11px] text-[var(--t-3)]">
        <ShieldCheck
          aria-hidden="true"
          className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--acc-hi)]"
        />
        <span>
          Page accessible aux <strong>admin</strong> uniquement. Le workflow GitHub{' '}
          <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px]">
            cron-watch.yml
          </code>{' '}
          appelle le même endpoint{' '}
          <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px]">
            /api/cron/health
          </code>{' '}
          toutes les heures et ouvre une issue si statut rouge. Cette page suit l’
          <strong>infrastructure</strong> ; pour la chaîne métier (cohorte, écarts, présence), voir
          la{' '}
          <Link
            href="/admin/health"
            className="font-medium text-[var(--acc-hi)] underline-offset-2 hover:underline"
          >
            vue de santé métier
          </Link>
          .
        </span>
      </p>
    </main>
  );
}

/**
 * Tour 13 — disk free/used gauge. Presentational view of the instant probe.
 * The bar fills with USED space so a nearly-full disk reads as a nearly-full
 * bar (the intuitive direction), colour mirrors the status bucket. `unknown`
 * (probe failed / exotic FS) renders a neutral "lecture indisponible" note
 * instead of a lying gauge — never red, never a crash.
 */
function DiskGauge({ disk }: { disk: DiskHealth }): React.ReactElement {
  if (disk.freeBytes === null || disk.totalBytes === null || disk.totalBytes <= 0) {
    return (
      <p className="mt-5 text-[11px] text-[var(--t-4)]">
        Lecture de l&apos;espace disque indisponible sur cette plateforme. Aucune donnée à afficher.
      </p>
    );
  }

  const usedBytes = Math.max(0, disk.totalBytes - disk.freeBytes);
  const usedPct = Math.min(100, Math.max(0, (usedBytes / disk.totalBytes) * 100));
  const fill =
    disk.status === 'green' ? 'var(--ok)' : disk.status === 'amber' ? 'var(--warn)' : 'var(--bad)';
  // Where the green→amber boundary sits on the USED-space bar (warn threshold
  // expressed as a used-percentage), so the operator reads the margin at a glance.
  const warnThresholdPct = Math.min(
    100,
    ((disk.totalBytes - disk.warnBytes) / disk.totalBytes) * 100,
  );

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-[var(--t-2)]">
          <span className="font-mono text-lg font-semibold text-[var(--t-1)] tabular-nums">
            {formatGiB(disk.freeBytes)}
          </span>{' '}
          libres sur {formatGiB(disk.totalBytes)}
        </p>
        <p className="font-mono text-[11px] text-[var(--t-3)] tabular-nums">
          {Math.round(usedPct)} % utilisé
        </p>
      </div>
      <div
        className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-2)]"
        role="img"
        aria-label={`Disque : ${formatGiB(disk.freeBytes)} libres sur ${formatGiB(disk.totalBytes)} (${Math.round(usedPct)} % utilisé).`}
      >
        <div
          className="h-full w-full origin-left rounded-full transition-transform"
          style={{ transform: `scaleX(${usedPct / 100})`, backgroundColor: fill }}
        />
        {/* Tick marking the green→amber boundary (warn threshold). */}
        <span
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-px bg-[var(--b-default)]"
          style={{ left: `${warnThresholdPct}%` }}
        />
      </div>
    </div>
  );
}

function DiskStatusPill({ status }: { status: DiskStatus }): React.ReactElement {
  const tone =
    status === 'green' ? 'ok' : status === 'amber' ? 'warn' : status === 'red' ? 'bad' : 'mute';
  const label =
    status === 'green'
      ? 'OK'
      : status === 'amber'
        ? 'Faible'
        : status === 'red'
          ? 'Critique'
          : 'Inconnu';
  return <Pill tone={tone}>{label}</Pill>;
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
      <p className="text-[11px] font-medium tracking-wide text-[var(--t-3)] uppercase">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${accentClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--t-4)]">{sublabel}</p>
    </div>
  );
}

/**
 * Tour 16 — « Actions hôte en attente ». Lists the heartbeat gaps that need a
 * HOST-side command (root cron sync / worker installer), each with the literal
 * command + since when. When empty, a calm "tout est à jour" note. The footer
 * documents what is NOT surfaced here (apex + raw worker cadence) so the operator
 * knows the boundary rather than assuming silence = everything is covered.
 */
function HostActionsSection({ items }: { items: HostActionItem[] }): React.ReactElement {
  const blocked = items.filter((i) => i.severity === 'blocked').length;
  return (
    <section
      aria-labelledby="host-actions-heading"
      className="mb-8 rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
        >
          <Terminal className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id="host-actions-heading"
            className="flex flex-wrap items-center gap-2 text-base font-semibold text-[var(--t-1)]"
          >
            Actions hôte en attente
            <Pill tone={blocked > 0 ? 'bad' : items.length > 0 ? 'warn' : 'ok'}>
              {blocked > 0
                ? `${blocked} à traiter`
                : items.length > 0
                  ? `${items.length} à venir`
                  : 'À jour'}
            </Pill>
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--t-3)]">
            Les signaux ci-dessus qui demandent une commande à lancer sur l&apos;hôte (ou la machine
            worker) pour être rétablis. Chaque entrée donne la commande exacte à exécuter et depuis
            quand le signal est ouvert.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-5 text-[11px] text-[var(--t-4)]">
          Aucune action hôte en attente. Tous les heartbeats à remédiation hôte connue (autoheal,
          worker) sont sains.
        </p>
      ) : (
        <ul className="mt-5 flex flex-col gap-3">
          {items.map((item) => (
            <HostActionRow key={item.key} item={item} />
          ))}
        </ul>
      )}

      <p className="mt-5 flex items-start gap-1.5 text-[11px] text-[var(--t-4)]">
        <ShieldCheck aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--t-4)]" />
        <span>
          Périmètre : seuls les signaux dont l&apos;hôte porte une remédiation connue apparaissent
          ici. La <strong>cadence brute</strong>&#32;du worker n&apos;est pas exposée par le modèle
          (statut sain/lent/bloqué uniquement), et l&apos;<strong>apex</strong>{' '}
          <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px]">
            fxmilyapp.com
          </code>{' '}
          n&apos;a pas de sonde côté serveur (elle vit dans{' '}
          <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px]">
            cron-watch.yml
          </code>
          , côté GitHub) : ces deux points ne sont volontairement pas listés ici.
        </span>
      </p>
    </section>
  );
}

/** One pending host action: label + severity, explanation, the literal command,
 *  and since when the signal has been open. */
function HostActionRow({ item }: { item: HostActionItem }): React.ReactElement {
  const tone = item.severity === 'blocked' ? 'bad' : 'warn';
  const sinceLabel = item.severity === 'blocked' ? 'Ouvert depuis' : 'Premier run attendu avant';
  return (
    <li className="rounded-xl border border-[var(--b-subtle)] bg-[var(--bg-2)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-[var(--t-1)]">{item.label}</p>
        <Pill tone={tone}>{item.severity === 'blocked' ? 'À traiter' : 'À venir'}</Pill>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--t-2)]">{item.detail}</p>
      <div className="mt-3 flex flex-col gap-1">
        <span className="text-[10px] font-medium tracking-wide text-[var(--t-4)] uppercase">
          Commande à exécuter
        </span>
        {/* block <code> so a long command wraps instead of overflowing the card
            on mobile; the reference path sits underneath it. */}
        <code className="block overflow-x-auto rounded-lg border border-[var(--b-subtle)] bg-[var(--bg-1)] px-3 py-2 font-mono text-[11px] leading-relaxed break-all text-[var(--t-1)]">
          {item.command}
        </code>
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-[var(--t-3)]">
        <span>
          Réf :{' '}
          <code className="rounded bg-[var(--bg-1)] px-1.5 py-0.5 font-mono text-[10px]">
            {item.reference}
          </code>
        </span>
        {item.sinceIso ? (
          <span>
            {sinceLabel} <span className="text-[var(--t-2)]">{formatTimestamp(item.sinceIso)}</span>
          </span>
        ) : null}
      </p>
    </li>
  );
}

function CronRow({ entry }: { entry: HeartbeatHealthEntry }): React.ReactElement {
  return (
    <li className="flex flex-col gap-2 border-b border-[var(--b-subtle)] py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <CronHeartbeatDot status={entry.status} />
          <p className="text-sm font-medium text-[var(--t-1)]">{entry.label}</p>
          <CronStatusPill status={entry.status} />
        </div>
        <p className="mt-1 text-[11px] text-[var(--t-3)]">
          <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px]">
            {entry.action}
          </code>{' '}
          · période {formatDuration(entry.periodMs)} · tolérance {formatDuration(entry.toleranceMs)}
        </p>
        {/* Why amber: the cron ran on time but its heartbeat reported failures
            for some members. Surfaces the count so the operator knows the run
            was partial, not just late. */}
        {entry.errorCount > 0 ? (
          <p className="mt-1 text-[11px] font-medium text-[var(--bad)]">
            {entry.errorCount} erreur{entry.errorCount > 1 ? 's' : ''} au dernier run
          </p>
        ) : null}
        {/* Age vs tolerance, visual. The Pill says *which* bucket; this bar
            says *how close to red* — a cron at 95% of tolerance reads amber
            but the near-full bar warns the operator before it flips. Hidden
            for window-bounded crons: between windows the raw age grows for
            hours by design, so the gauge would read "almost red" all day
            about a healthy cron. Their status is the missed-ticks count. */}
        {entry.windowed ? (
          <p className="mt-2 text-[11px] text-[var(--t-4)]">
            Cron à fenêtres horaires · statut = créneaux planifiés manqués, pas l’âge brut
          </p>
        ) : (
          <CronAgeBar
            status={entry.status}
            ageMs={entry.ageMs}
            periodMs={entry.periodMs}
            toleranceMs={entry.toleranceMs}
          />
        )}
      </div>
      <div className="text-right text-xs text-[var(--t-2)]">
        {entry.lastRanAt ? (
          <>
            <p className="font-mono tabular-nums">
              {entry.ageMs !== null ? formatDuration(entry.ageMs) : 'âge inconnu'}
            </p>
            <p className="text-[10px] text-[var(--t-4)]">{formatTimestamp(entry.lastRanAt)}</p>
          </>
        ) : entry.status === 'pending' ? (
          <>
            {/* First run not due yet: calm, factual — NOT the red "Jamais
                exécuté" which reads as an incident about a task installed
                two days ago whose first tick is next month. */}
            <p className="text-[var(--t-2)]">Premier run à venir</p>
            {entry.firstRunDeadline ? (
              <p className="text-[10px] text-[var(--t-4)]">
                attendu avant le {formatTimestamp(entry.firstRunDeadline)}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[var(--bad)]">Jamais exécuté</p>
        )}
      </div>
    </li>
  );
}

/**
 * Per-cron LED. Green (healthy) pulses (motion-safe — the global
 * `prefers-reduced-motion` filet stops `animate-pulse` at iteration 1 so it
 * settles solid, never hidden). Amber / red / never_ran are FIXED on purpose :
 * a blinking red would read as alarm/anxiety (anti-Black-Hat, §2) whereas a
 * steady, saturated red dot still jumps out against the calm UI. forced-colors
 * keeps the dot (background-color survives High Contrast) so the signal never
 * disappears for High-Contrast users.
 */
function CronHeartbeatDot({ status }: { status: CronStatus }): React.ReactElement {
  const color =
    status === 'green'
      ? 'var(--ok)'
      : status === 'amber'
        ? 'var(--warn)'
        : status === 'red'
          ? 'var(--bad)'
          : 'var(--t-3)'; // never_ran / pending — neutral, not red (no failure, just no data yet)
  const labelText =
    status === 'green'
      ? 'Sain'
      : status === 'amber'
        ? 'Lent'
        : status === 'red'
          ? 'Bloqué'
          : status === 'pending'
            ? 'Premier run à venir'
            : 'Jamais exécuté';
  return (
    <span
      role="img"
      aria-label={`État : ${labelText}`}
      title={labelText}
      className="relative grid h-3.5 w-3.5 shrink-0 place-items-center"
    >
      {/* Healthy crons get a soft breathing halo; unhealthy ones stay still. */}
      {status === 'green' ? (
        <span
          aria-hidden="true"
          className="absolute inline-flex h-3.5 w-3.5 rounded-full opacity-50 motion-safe:animate-ping"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span
        aria-hidden="true"
        className={`relative inline-flex h-2 w-2 rounded-full ${
          status === 'green' ? 'motion-safe:animate-pulse' : ''
        }`}
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

/**
 * Mini age/tolerance bar. Pure presentational view of `ageMs / toleranceMs`
 * (both already computed server-side). Fill colour mirrors the status bucket
 * and never animates — it's a static gauge, not a moving alarm.
 */
function CronAgeBar({
  status,
  ageMs,
  periodMs,
  toleranceMs,
}: {
  status: CronStatus;
  ageMs: number | null;
  periodMs: number;
  toleranceMs: number;
}): React.ReactElement | null {
  if (ageMs === null || toleranceMs <= 0) return null;

  const pct = Math.min(100, Math.max(0, (ageMs / toleranceMs) * 100));
  const fill = status === 'green' ? 'var(--ok)' : status === 'amber' ? 'var(--warn)' : 'var(--bad)';
  // Where "green→amber" sits on the bar (age = 1.5× période), so the operator
  // can read the two thresholds at a glance.
  const greenThresholdPct = Math.min(100, ((periodMs * 1.5) / toleranceMs) * 100);

  return (
    <div className="mt-2 max-w-[18rem]">
      <div
        className="relative h-1 overflow-hidden rounded-full bg-[var(--bg-2)]"
        role="img"
        aria-label={`Âge ${formatDuration(ageMs)} sur tolérance ${formatDuration(toleranceMs)} (${Math.round(pct)} %)`}
        title={`${Math.round(pct)} % de la tolérance`}
      >
        <div
          className="h-full w-full origin-left rounded-full transition-transform"
          style={{ transform: `scaleX(${Math.min(pct, 100) / 100})`, backgroundColor: fill }}
        />
        {/* Tick marking the green→amber boundary. */}
        <span
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-px bg-[var(--b-default)]"
          style={{ left: `${greenThresholdPct}%` }}
        />
      </div>
    </div>
  );
}

function OverallStatusPill({ status }: { status: CronStatus }): React.ReactElement {
  // `pending` is healthy by definition (first run not due yet) — the reports
  // never propagate it to `overall`, but the type allows it so map it green.
  const tone =
    status === 'green' || status === 'pending' ? 'ok' : status === 'amber' ? 'warn' : 'bad';
  const label =
    status === 'green' || status === 'pending'
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
    status === 'green'
      ? 'OK'
      : status === 'amber'
        ? 'Lent'
        : status === 'red'
          ? 'Stale'
          : status === 'pending'
            ? 'À venir'
            : 'Jamais';
  return <Pill tone={tone}>{label}</Pill>;
}

/**
 * Same severity order the reports use for their own `overall`
 * (`red` > `never_ran` > `amber` > `green` = `pending`) — applied across
 * the two boards. `pending` never escalates the masthead: a first run that
 * is not due yet is expected state.
 */
function worstStatus(a: CronStatus, b: CronStatus): CronStatus {
  const severity: Record<CronStatus, number> = {
    green: 0,
    pending: 0,
    amber: 1,
    never_ran: 2,
    red: 3,
  };
  return severity[a] >= severity[b] ? a : b;
}

/**
 * Tour 13 — verification backlog pill. `idle` (nothing pending) reads as a calm
 * "À jour", never an alarm; `green` means a fresh in-flight queue; amber/red
 * escalate honestly. Tones stay on the shared ok/warn/bad/mute scale.
 */
function VerificationBacklogPill({
  status,
}: {
  status: VerificationBacklogStatus;
}): React.ReactElement {
  const tone =
    status === 'green' ? 'ok' : status === 'amber' ? 'warn' : status === 'red' ? 'bad' : 'mute';
  const label =
    status === 'green'
      ? 'À jour'
      : status === 'amber'
        ? 'En retard'
        : status === 'red'
          ? 'Bloquée'
          : 'À jour';
  return <Pill tone={tone}>{label}</Pill>;
}

/**
 * Detail line under the backlog pill. When idle, a single reassuring sentence;
 * otherwise the pending count + the oldest wait, coloured by bucket (never red
 * for a merely-fresh queue).
 */
function VerificationBacklogDetail({
  backlog,
}: {
  backlog: VerificationBacklogHealth;
}): React.ReactElement {
  if (backlog.status === 'idle' || backlog.oldestPendingAgeMs === null) {
    return (
      <p className="mt-5 text-[11px] text-[var(--t-4)]">
        Aucune preuve en attente. Toutes les captures reçues ont été analysées puis supprimées.
      </p>
    );
  }

  const ageTone =
    backlog.status === 'red'
      ? 'text-[var(--bad)]'
      : backlog.status === 'amber'
        ? 'text-[var(--warn)]'
        : 'text-[var(--t-1)]';

  return (
    <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
      <p className="text-sm text-[var(--t-2)]">
        <span className="font-mono text-lg font-semibold text-[var(--t-1)] tabular-nums">
          {backlog.pendingCount}
        </span>{' '}
        preuve{backlog.pendingCount > 1 ? 's' : ''} en attente
      </p>
      <p className="text-sm text-[var(--t-2)]">
        Plus ancienne :{' '}
        <span className={`font-mono text-lg font-semibold tabular-nums ${ageTone}`}>
          {formatBacklogDuration(backlog.oldestPendingAgeMs)}
        </span>
        {backlog.oldestPendingAt ? (
          <span className="ml-2 text-[11px] text-[var(--t-4)]">
            depuis {formatTimestamp(backlog.oldestPendingAt)}
          </span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Map the backlog probe onto the shared `CronStatus` severity ladder so the
 * masthead `worstStatus` can fold it in. `idle` = healthy (green); the queue
 * being empty is the desired steady state, not an incident.
 */
function backlogToCronStatus(status: VerificationBacklogStatus): CronStatus {
  return status === 'red' ? 'red' : status === 'amber' ? 'amber' : 'green'; // green + idle both fold to healthy
}

/**
 * Tour 14 — uploads persistence pill. `unknown` (probe unavailable — non-Linux
 * dev host, sandbox) reads neutral, never red; `red` = the upload root is on
 * the ephemeral overlay layer (proofs being lost on every deploy right now).
 */
function UploadsPersistencePill({
  status,
}: {
  status: UploadsPersistenceStatus;
}): React.ReactElement {
  const tone =
    status === 'green' ? 'ok' : status === 'amber' ? 'warn' : status === 'red' ? 'bad' : 'mute';
  const label =
    status === 'green'
      ? 'Persistant'
      : status === 'amber'
        ? 'À surveiller'
        : status === 'red'
          ? 'Éphémère'
          : 'Inconnu';
  return <Pill tone={tone}>{label}</Pill>;
}

/**
 * Detail line under the uploads pill. Shows the inspected upload root + the
 * backing filesystem so the operator can act (mount the volume / drop
 * UPLOADS_DIR). `unknown` renders a neutral "lecture indisponible" note rather
 * than a lying verdict; `red` spells out the data-loss consequence.
 */
function UploadsPersistenceDetail({
  uploads,
}: {
  uploads: UploadsPersistenceHealth;
}): React.ReactElement {
  if (uploads.status === 'unknown' || uploads.fsType === null) {
    return (
      <p className="mt-5 text-[11px] text-[var(--t-4)]">
        Lecture de la persistance indisponible sur cette plateforme (pas de{' '}
        <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px]">
          /proc/mounts
        </code>
        ). Dossier inspecté :{' '}
        <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px]">
          {uploads.uploadsRoot}
        </code>
        .
      </p>
    );
  }

  const fsTone = uploads.ephemeral ? 'text-[var(--bad)]' : 'text-[var(--t-1)]';

  return (
    <div className="mt-5 flex flex-col gap-2">
      <p className="text-sm text-[var(--t-2)]">
        Système de fichiers :{' '}
        <span className={`font-mono text-base font-semibold ${fsTone}`}>{uploads.fsType}</span>
        {uploads.mountPoint ? (
          <span className="ml-2 text-[11px] text-[var(--t-4)]">
            monté sur{' '}
            <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px]">
              {uploads.mountPoint}
            </code>
          </span>
        ) : null}
      </p>
      <p className="text-[11px] text-[var(--t-3)]">
        Dossier des preuves :{' '}
        <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[10px]">
          {uploads.uploadsRoot}
        </code>
      </p>
      {uploads.ephemeral ? (
        <p className="mt-1 text-[11px] font-medium text-[var(--bad)]">
          Ce dossier vit dans la couche éphémère du conteneur : les preuves sont effacées à chaque
          déploiement. Monter le volume Docker sur ce chemin (ou retirer UPLOADS_DIR de web.env).
        </p>
      ) : null}
    </div>
  );
}

/**
 * Map the uploads-persistence probe onto the shared `CronStatus` ladder so the
 * masthead `worstStatus` can fold it in. `unknown` folds to green (no reading =
 * not an incident, exactly like the disk probe's `unknown`).
 */
function uploadsToCronStatus(status: UploadsPersistenceStatus): CronStatus {
  return status === 'red' ? 'red' : status === 'amber' ? 'amber' : 'green'; // green + unknown both fold to healthy
}

/** Coarse ms → "42 min" / "3 h" / "2 j" for the backlog age (own formatter so
 *  the sub-minute floor reads "< 1 min" instead of "0s"). */
function formatBacklogDuration(ms: number): string {
  if (ms < 60_000) return '< 1 min';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} j`;
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

/** Bytes → GiB with one decimal below 10 Go, integer above (e.g. "2,4 Go", "38 Go"). */
function formatGiB(bytes: number): string {
  const gib = bytes / (1024 * 1024 * 1024);
  const value = gib < 10 ? gib.toFixed(1) : String(Math.round(gib));
  return `${value.replace('.', ',')} Go`;
}
