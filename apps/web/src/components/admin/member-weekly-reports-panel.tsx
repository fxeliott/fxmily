import { CalendarDays, FileText, Mail, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import type { SerializedWeeklyReport } from '@/lib/weekly-report/service';

interface MemberWeeklyReportsPanelProps {
  reports: SerializedWeeklyReport[];
}

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

/**
 * Weekly reports panel — member detail page tab (J8, SPEC §7.10).
 *
 * Read-only timeline of the AI-generated weekly digests, newest first. Each
 * row links to the full report at /admin/reports/[id]. Pills show :
 *   - Mock vs Live model (so Eliot can tell at a glance if the digest is the
 *     deterministic fixture or real Claude output)
 *   - Email delivery state (pending vs sent)
 */
export function MemberWeeklyReportsPanel({ reports }: MemberWeeklyReportsPanelProps) {
  if (reports.length === 0) {
    return (
      <Card primary className="py-2">
        <EmptyState
          icon={Sparkles}
          headline="Aucun rapport IA pour ce membre."
          lead="Les rapports hebdo se génèrent automatiquement chaque dimanche soir, dès qu'il y a une semaine d'activité à analyser."
          guides={[
            'Le cron tourne à 21:00 UTC chaque dimanche.',
            'Sans ANTHROPIC_API_KEY, le rapport est généré en mode mock (déterministe).',
            'Un email digest est envoyé automatiquement à l&apos;admin.',
          ]}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card primary className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="acc">RAPPORTS IA</Pill>
          <span className="t-eyebrow">SPEC §7.10 — claude-sonnet-4-6</span>
        </div>
        <p className="t-body mt-2 text-[var(--t-2)]">
          Synthèse comportementale hebdomadaire (Mark Douglas + exécution + scores). Aucun avis sur
          les analyses de marché.
        </p>
      </Card>

      <ul className="flex flex-col gap-2">
        {reports.map((report) => {
          const mocked = isMockedModel(report.claudeModel);
          return (
            <li key={report.id}>
              <Link
                href={`/admin/reports/${report.id}`}
                className="rounded-card focus-visible:outline-acc block border border-[var(--b-default)] bg-[var(--bg-1)] p-4 shadow-[var(--sh-card)] transition-colors hover:border-[var(--b-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <CalendarDays className="h-3.5 w-3.5 text-[var(--t-3)]" strokeWidth={1.75} />
                  <span className="f-mono text-[13px] font-semibold tabular-nums text-[var(--t-1)]">
                    {formatPeriod(report.weekStart, report.weekEnd)}
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
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" strokeWidth={1.75} />
                    {report.risks.length} risque{report.risks.length > 1 ? 's' : ''} ·{' '}
                    {report.recommendations.length} reco
                    {report.recommendations.length > 1 ? 's' : ''}
                  </span>
                  <span className="f-mono tabular-nums">
                    {report.inputTokens} in / {report.outputTokens} out ·{' '}
                    {Number(report.costEur).toFixed(4)} €
                  </span>
                  <span className="t-mono-cap">
                    Généré {GENERATED_FMT.format(new Date(report.generatedAt))}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
