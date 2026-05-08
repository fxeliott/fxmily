import { ArrowLeft, CalendarDays, Mail, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { cn } from '@/lib/utils';
import {
  getReportStatsForAdmin,
  listReportsForAdmin,
  type SerializedWeeklyReport,
} from '@/lib/weekly-report/service';

export const metadata = {
  title: 'Rapports IA · Fxmily Admin',
};

export const dynamic = 'force-dynamic';

const PERIOD_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
});

const GENERATED_FMT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatPeriod(weekStart: string, weekEnd: string): string {
  const start = PERIOD_FMT.format(new Date(`${weekStart}T00:00:00Z`));
  const end = PERIOD_FMT.format(new Date(`${weekEnd}T00:00:00Z`));
  return `${start} → ${end}`;
}

function isMockedModel(model: string): boolean {
  return model.startsWith('mock:');
}

export default async function AdminReportsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const [{ items }, stats] = await Promise.all([
    listReportsForAdmin({ limit: 30 }),
    getReportStatsForAdmin(),
  ]);

  await logAudit({
    action: 'admin.weekly_report.viewed',
    userId: session.user.id,
    metadata: { surface: 'list', count: items.length },
  });

  // J8 perf TIER 2 (T2.2) — fetch uniquement les membres présents dans la
  // page courante de rapports (max 30) au lieu de TOUTE la cohorte
  // (`listMembersForAdmin` charge potentiellement 1000+ rows pour résoudre
  // 30 labels). À 1000 membres : économise 970 rows par render.
  const memberIds = Array.from(new Set(items.map((r) => r.userId)));
  const members =
    memberIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
      : [];

  // Index member display labels for the list rows.
  const memberLabel = new Map<string, string>();
  for (const m of members) {
    const fn = (m.firstName ?? '').trim();
    const ln = (m.lastName ?? '').trim();
    const label = fn && ln ? `${fn} ${ln}` : fn || m.email;
    memberLabel.set(m.id, label);
  }

  // Group by week for the timeline view.
  const grouped = new Map<string, SerializedWeeklyReport[]>();
  for (const r of items) {
    const key = r.weekStart;
    const list = grouped.get(key) ?? [];
    list.push(r);
    grouped.set(key, list);
  }
  const weeks = Array.from(grouped.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-8">
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
            <Pill tone="acc">RAPPORTS IA</Pill>
            <span className="t-eyebrow">SPEC §7.10</span>
          </div>
          <h1
            className="f-display h-rise text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Rapports hebdo
          </h1>
          <p className="t-body text-[var(--t-2)]">
            Synthèse comportementale claude-sonnet-4-6 chaque dimanche 21:00 UTC. Posture Mark
            Douglas + exécution + scores. Aucun avis sur les analyses de marché.
          </p>
        </div>

        {/* Stats strip */}
        <div className="border-edge-top rounded-card relative grid grid-cols-2 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] shadow-[var(--sh-card)] sm:grid-cols-4">
          <StatCell
            label="Rapports"
            value={String(stats.totalReports)}
            hint={stats.lastWeekStart ? `dernier ${stats.lastWeekStart}` : 'aucun encore'}
          />
          <StatCell
            label="Coût cumulé"
            value={`${Number(stats.totalCostEur).toFixed(2)} €`}
            hint="depuis J8"
            tone="acc"
          />
          <StatCell
            label="Emails envoyés"
            value={String(stats.emailsDelivered)}
            hint={stats.emailsPending > 0 ? `${stats.emailsPending} en attente` : 'tous envoyés'}
            tone={stats.emailsDelivered > 0 ? 'ok' : 'mute'}
          />
          <StatCell
            label="Membres semaine"
            value={String(stats.membersInLastWeek)}
            hint="dernière vague"
          />
        </div>
      </header>

      {weeks.length === 0 ? (
        <Card primary className="py-2">
          <EmptyState
            icon={Sparkles}
            headline="Aucun rapport encore généré."
            lead="Le cron tourne chaque dimanche 21:00 UTC. Le premier rapport apparaîtra ici dès la première vague (mock par défaut, Claude live quand ANTHROPIC_API_KEY sera configurée)."
            guides={[
              'Smoke test : POST /api/cron/weekly-reports avec X-Cron-Secret en dev (?dryRun=true pour skip email).',
              'Domaine fxmily.com non vérifié → V1 envoie à eliott.pena@icloud.com.',
            ]}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {weeks.map(([weekStart, list]) => {
            const weekEnd = list[0]?.weekEnd ?? weekStart;
            return (
              <section key={weekStart} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline gap-3">
                  <CalendarDays className="h-4 w-4 text-[var(--acc)]" strokeWidth={1.75} />
                  <h2 className="f-display text-[18px] font-semibold tracking-[-0.02em] text-[var(--t-1)]">
                    Semaine {formatPeriod(weekStart, weekEnd)}
                  </h2>
                  <span className="t-mono-cap">
                    {list.length} rapport{list.length > 1 ? 's' : ''}
                  </span>
                </div>
                <ul className="flex flex-col gap-2">
                  {list.map((report) => {
                    const mocked = isMockedModel(report.claudeModel);
                    const label = memberLabel.get(report.userId) ?? 'Membre supprimé';
                    return (
                      <li key={report.id}>
                        <Link
                          href={`/admin/reports/${report.id}`}
                          className="rounded-card focus-visible:outline-acc block border border-[var(--b-default)] bg-[var(--bg-1)] p-4 shadow-[var(--sh-card)] transition-colors hover:border-[var(--b-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="f-display text-[15px] font-semibold text-[var(--t-1)]">
                              {label}
                            </span>
                            {mocked ? <Pill tone="warn">MOCK</Pill> : <Pill tone="acc">LIVE</Pill>}
                            {report.sentToAdminAt ? (
                              <Pill tone="ok">
                                <Mail className="h-2.5 w-2.5" strokeWidth={2} />
                                ENVOYÉ
                              </Pill>
                            ) : (
                              <Pill tone="mute">
                                <Mail className="h-2.5 w-2.5" strokeWidth={2} />
                                EN ATTENTE
                              </Pill>
                            )}
                          </div>
                          <p className="mt-2 line-clamp-2 text-[13.5px] leading-snug text-[var(--t-2)]">
                            {report.summary}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--t-3)]">
                            <span className="f-mono tabular-nums">
                              {report.inputTokens} in / {report.outputTokens} out ·{' '}
                              {Number(report.costEur).toFixed(4)} €
                            </span>
                            <span className="t-mono-cap">
                              Généré {GENERATED_FMT.format(new Date(report.generatedAt))}
                            </span>
                            <span className="t-mono-cap">
                              {report.risks.length} risque{report.risks.length > 1 ? 's' : ''} ·{' '}
                              {report.recommendations.length} reco
                              {report.recommendations.length > 1 ? 's' : ''}
                            </span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
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
  value: string;
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

  return (
    <div className="flex flex-col gap-1 border-b border-r border-[var(--b-default)] p-4 last:border-r-0 sm:border-b-0 [&:nth-child(2)]:border-b-0 [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r">
      <span className="t-eyebrow">{label}</span>
      <span
        className={cn(
          'f-mono text-[20px] font-semibold tabular-nums leading-none tracking-[-0.02em]',
          valColor,
        )}
      >
        {value}
      </span>
      {hint ? <span className="t-mono-cap">{hint}</span> : null}
    </div>
  );
}
