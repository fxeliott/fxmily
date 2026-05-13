import { ArrowLeft, CalendarDays, Mail, Sparkles, User } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { db } from '@/lib/db';
import { logAudit } from '@/lib/auth/audit';
import { getReportByIdForAdmin } from '@/lib/weekly-report/service';

export const metadata = {
  title: 'Rapport hebdo · Fxmily Admin',
};

export const dynamic = 'force-dynamic';

const PERIOD_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const GENERATED_FMT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface ReportDetailPageProps {
  params: Promise<{ id: string }>;
}

function formatPeriod(weekStart: string, weekEnd: string): string {
  const start = PERIOD_FMT.format(new Date(`${weekStart}T12:00:00Z`));
  const end = PERIOD_FMT.format(new Date(`${weekEnd}T12:00:00Z`));
  return `${start} → ${end}`;
}

export default async function AdminReportDetailPage({ params }: ReportDetailPageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const { id } = await params;
  const report = await getReportByIdForAdmin(id);
  if (!report) notFound();

  const member = await db.user.findUnique({
    where: { id: report.userId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });

  const memberLabel = (() => {
    if (!member) return 'Membre supprimé';
    const fn = (member.firstName ?? '').trim();
    const ln = (member.lastName ?? '').trim();
    if (fn && ln) return `${fn} ${ln}`;
    if (fn) return fn;
    return member.email;
  })();

  await logAudit({
    action: 'admin.weekly_report.viewed',
    userId: session.user.id,
    metadata: { reportId: id, surface: 'detail' },
  });

  const mocked = report.claudeModel.startsWith('mock:');
  const patternEntries: Array<[string, string]> = [];
  if (report.patterns.emotionPerf)
    patternEntries.push(['Émotion × Performance', report.patterns.emotionPerf]);
  if (report.patterns.sleepPerf)
    patternEntries.push(['Sommeil × Performance', report.patterns.sleepPerf]);
  if (report.patterns.sessionFocus)
    patternEntries.push(['Sessions traitées', report.patterns.sessionFocus]);
  if (report.patterns.disciplineTrend)
    patternEntries.push(['Trajectoire discipline', report.patterns.disciplineTrend]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 px-4 py-8">
      <Link
        href="/admin/reports"
        aria-label="Retour à la liste des rapports"
        className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        Tous les rapports
      </Link>

      <Card primary className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-[var(--acc)]" strokeWidth={1.75} aria-hidden />
          <Pill tone="acc">
            <span aria-label="Catégorie : rapport hebdomadaire">RAPPORT HEBDO</span>
          </Pill>
          {mocked ? (
            <Pill tone="warn">
              <span aria-label="Source : mock déterministe (sans appel API Claude)">MOCK</span>
            </Pill>
          ) : (
            <Pill tone="acc">
              <span aria-label="Source : Claude API live">LIVE</span>
            </Pill>
          )}
          {report.sentToAdminAt ? (
            <Pill tone="ok">
              <Mail className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
              <span aria-label="Email digest envoyé à l’admin">ENVOYÉ</span>
            </Pill>
          ) : (
            <Pill tone="mute">
              <Mail className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
              <span aria-label="Email digest en attente d’envoi">EN ATTENTE</span>
            </Pill>
          )}
        </div>

        <h1
          className="f-display h-rise mt-3 text-[26px] font-bold leading-[1.05] tracking-[-0.03em] text-[var(--t-1)] sm:text-[30px]"
          style={{ fontFeatureSettings: '"ss01" 1' }}
        >
          {memberLabel}
        </h1>
        <p className="t-body mt-1 inline-flex items-center gap-1.5 text-[var(--t-3)]">
          <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} />
          {formatPeriod(report.weekStart, report.weekEnd)}
        </p>

        {member ? (
          <Link
            href={`/admin/members/${member.id}?tab=weekly-reports`}
            className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-[var(--acc)] underline-offset-2 hover:underline"
          >
            <User className="h-3 w-3" strokeWidth={1.75} />
            Voir le profil membre · onglet Rapports IA
          </Link>
        ) : null}
      </Card>

      {/* V1.7.1 — EU AI Act 50(1) chatbot transparency disclaimer
          (deadline 2 août 2026, €15M / 3% CA Art. 99(4)). The model name is
          dynamic so future provider switches don't drift the banner copy. */}
      <AIGeneratedBanner
        variant="inline"
        modelName={
          report.claudeModel === 'claude-code-local'
            ? 'Claude (subscription locale)'
            : `Claude ${report.claudeModel}`
        }
      />

      {/* Summary */}
      <section className="rounded-card border border-[var(--b-default)] bg-[var(--bg-1)] p-5 shadow-[var(--sh-card)]">
        <h2 className="t-eyebrow text-[var(--acc)]">Synthèse</h2>
        <p className="mt-2 text-[15px] leading-[23px] text-[var(--t-1)]">{report.summary}</p>
      </section>

      {/* Risks */}
      {report.risks.length > 0 ? (
        <section className="rounded-card border border-[var(--b-default)] bg-[var(--bg-1)] p-5 shadow-[var(--sh-card)]">
          <h2 className="t-eyebrow text-[var(--warn)]">
            Risques à surveiller ({report.risks.length})
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {report.risks.map((risk, idx) => (
              <li
                key={`risk-${idx}`}
                className="rounded-control border-l-2 border-[var(--warn)] bg-[var(--warn-dim)] px-3 py-2 text-[14px] leading-snug text-[var(--t-1)]"
              >
                {risk}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Recommendations */}
      <section className="rounded-card border border-[var(--b-default)] bg-[var(--bg-1)] p-5 shadow-[var(--sh-card)]">
        <h2 className="t-eyebrow text-[var(--acc)]">
          Recommandations ({report.recommendations.length})
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {report.recommendations.map((reco, idx) => (
            <li
              key={`reco-${idx}`}
              className="rounded-control border-l-2 border-[var(--acc)] bg-[var(--acc-dim)] px-3 py-2 text-[14px] leading-snug text-[var(--t-1)]"
            >
              {reco}
            </li>
          ))}
        </ul>
      </section>

      {/* Patterns */}
      {patternEntries.length > 0 ? (
        <section className="rounded-card border border-[var(--b-default)] bg-[var(--bg-1)] p-5 shadow-[var(--sh-card)]">
          <h2 className="t-eyebrow">Patterns observés</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {patternEntries.map(([label, value]) => (
              <div
                key={label}
                className="rounded-control border border-[var(--b-default)] bg-[var(--bg-2)] p-3"
              >
                <dt className="t-mono-cap text-[var(--t-3)]">{label}</dt>
                <dd className="mt-1 text-[13.5px] leading-[20px] text-[var(--t-1)]">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {/* Meta */}
      <section className="rounded-card border border-[var(--b-default)] bg-[var(--bg-1)] p-5 shadow-[var(--sh-card)]">
        <h2 className="t-eyebrow">Génération</h2>
        <dl className="mt-3 grid gap-2 text-[12.5px] text-[var(--t-2)] sm:grid-cols-2">
          <Meta label="Modèle" value={report.claudeModel} mono />
          <Meta label="Coût EUR" value={`${Number(report.costEur).toFixed(6)} €`} mono tone="acc" />
          <Meta label="Tokens entrée" value={`${report.inputTokens}`} mono />
          <Meta label="Tokens sortie" value={`${report.outputTokens}`} mono />
          <Meta
            label="Cache lecture"
            value={`${report.cacheReadTokens}`}
            mono
            tone={report.cacheReadTokens > 0 ? 'ok' : 'mute'}
          />
          <Meta label="Cache création" value={`${report.cacheCreateTokens}`} mono />
          <Meta label="Généré le" value={GENERATED_FMT.format(new Date(report.generatedAt))} mono />
          <Meta
            label="Email"
            value={
              report.sentToAdminAt
                ? `${report.sentToAdminEmail ?? '—'} · ${GENERATED_FMT.format(new Date(report.sentToAdminAt))}`
                : 'En attente'
            }
            tone={report.sentToAdminAt ? 'ok' : 'mute'}
          />
        </dl>
        <p className="t-mono-cap mt-3 text-[var(--t-3)]">
          Aucun conseil de trade — uniquement comportement, exécution, psychologie (SPEC §2).
        </p>
      </section>
    </main>
  );
}

function Meta({
  label,
  value,
  mono = false,
  tone = 'default',
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'default' | 'mute' | 'ok' | 'acc';
}) {
  const cls =
    tone === 'ok'
      ? 'text-[var(--ok)]'
      : tone === 'acc'
        ? 'text-[var(--acc)]'
        : tone === 'mute'
          ? 'text-[var(--t-3)]'
          : 'text-[var(--t-1)]';
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="t-mono-cap text-[var(--t-3)]">{label}</dt>
      <dd className={`${mono ? 'f-mono tabular-nums' : ''} text-[13px] ${cls}`}>{value}</dd>
    </div>
  );
}
