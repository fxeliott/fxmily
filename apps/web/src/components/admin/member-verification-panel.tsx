import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { ConstancyScoreCard } from '@/components/verification/constancy-score-card';
import { ConstancyTrend } from '@/components/verification/constancy-trend';
import { RealityVsDeclared } from '@/components/verification/reality-vs-declared';
import { ALERT_LABELS } from '@/lib/verification/alert-labels';
import type { ConstancyScoreView } from '@/lib/verification/constancy';
import type { DiscrepancyView, VerificationOverview } from '@/lib/verification/service';

/**
 * S3 §33 — admin read-only « réalité vs déclaré » panel (S7 output:
 * « admin : visibilité totale de la réalité & des écarts »). Carbone pattern
 * §7.7: server-rendered, zero mutation, calm factual copy.
 */

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Paris',
});

const DISCREPANCY_LABELS: Record<DiscrepancyView['type'], string> = {
  missing_declared: 'Position réelle non déclarée',
  false_declared: 'Trade déclaré sans contrepartie',
  mismatch: 'Écart de taille',
  unfilled_no_reason: 'Journée sans suivi',
  meeting_missed_no_reason: 'Réunion manquée',
  tracking_skipped_no_reason: 'Outil de suivi laissé de côté',
};

/** S4 (DOD3-T3-01) — `severity` drives the ScoreEvent delta but was rendered
 *  nowhere: the admin had to open the DB to tell a major gap from a minor
 *  one. Sober wording, factual (this panel stays zero-mutation). */
const SEVERITY_LABELS: Record<number, string> = {
  1: 'mineur',
  2: 'notable',
  3: 'majeur',
};

interface AlertView {
  readonly id: string;
  readonly triggerType: string;
  readonly repeatCount: number;
  readonly threshold: number;
  readonly status: 'open' | 'delivered' | 'dismissed';
  readonly createdAt: Date;
}

interface MemberVerificationPanelProps {
  overview: VerificationOverview;
  constancy: ConstancyScoreView | null;
  discrepancies: readonly DiscrepancyView[];
  alerts: readonly AlertView[];
  /**
   * S6 chantier E — the member's recent weekly constancy scores (oldest→newest).
   * Mirrors the member-side `/verification` layout so the admin sees the
   * trajectory (« comment ça bouge »), not just the latest snapshot. Required
   * (always supplied by the page) per the repo's `exactOptionalPropertyTypes`
   * posture. `ConstancyTrend` self-guards on `< 2` rows → renders nothing.
   */
  history: readonly ConstancyScoreView[];
}

export function MemberVerificationPanel({
  overview,
  constancy,
  discrepancies,
  alerts,
  history,
}: MemberVerificationPanelProps) {
  const openCount = discrepancies.filter((d) => d.status === 'open').length;

  return (
    <div className="flex flex-col gap-4">
      {/* KPI strip — « Comptes » derives from the source of truth
          (overview.accounts = declared + AI-detected, same list shown below),
          NOT the denormalised detectedAccountCount which was `—` until the
          vision pipeline ran and contradicted the list. */}
      <div className="border-edge-top rounded-card relative grid grid-cols-2 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] sm:grid-cols-4">
        <Metric label="Comptes" value={String(overview.accounts.length)} />
        <Metric label="Preuves reçues" value={String(overview.proofs.length)} />
        <Metric label="Écarts ouverts" value={String(openCount)} />
        <Metric
          label="Alertes actives"
          value={String(alerts.filter((a) => a.status !== 'dismissed').length)}
        />
      </div>

      <ConstancyScoreCard score={constancy} />
      <ConstancyTrend history={history} />

      {/* Comptes */}
      <section className="flex flex-col gap-2" aria-label="Comptes broker">
        <h3 className="t-h3 text-[var(--t-1)]">Comptes</h3>
        {overview.accounts.length === 0 ? (
          <p className="t-body text-[var(--t-3)]">Aucun compte déclaré ni détecté.</p>
        ) : (
          overview.accounts.map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--t-1)]">
                {a.label}
                <span className="t-cap block text-[var(--t-4)]">
                  {a.brokerName ?? 'Broker non précisé'} · {a.proofsCount} preuve
                  {a.proofsCount > 1 ? 's' : ''} · {a.positionsCount} position
                  {a.positionsCount > 1 ? 's' : ''}
                </span>
              </span>
              {a.detectedByAI ? (
                <Pill tone="cy">Détecté IA</Pill>
              ) : (
                <Pill tone="mute">Déclaré</Pill>
              )}
            </Card>
          ))
        )}
      </section>

      {/* Écarts */}
      <section className="flex flex-col gap-2" aria-label="Écarts">
        <h3 className="t-h3 text-[var(--t-1)]">Écarts</h3>
        {discrepancies.length === 0 ? (
          <p className="t-body text-[var(--t-3)]">Aucun écart détecté.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {discrepancies.map((d) => (
              <li key={d.id}>
                <Card className="flex flex-col gap-1.5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-[var(--t-1)]">
                      {DISCREPANCY_LABELS[d.type]}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="t-cap text-[var(--t-4)]">
                        {DATE_FMT.format(d.detectedAt)}
                      </span>
                      <Pill tone="mute">{SEVERITY_LABELS[d.severity] ?? `sév. ${d.severity}`}</Pill>
                      {d.memberReason !== null ? (
                        <Pill tone="cy">Motif donné</Pill>
                      ) : d.status === 'open' ? (
                        <Pill tone="warn">Ouvert</Pill>
                      ) : (
                        <Pill tone="mute">
                          {d.status === 'resolved' ? 'Résolu' : 'Pris en compte'}
                        </Pill>
                      )}
                    </span>
                  </div>
                  {/* S7 §29-#2 — « réalité prouvée vs déclaratif » : the concrete
                      face-à-face (pair/size/time/pnl) the data layer matched, so the
                      admin sees WHERE the tracking diverges, not just that it did.
                      Self-guards to null on rituals (no trade side). Factual mirror,
                      zero market judgement (SPEC §2). */}
                  <RealityVsDeclared
                    declared={d.declared}
                    reality={d.reality}
                    type={d.type}
                    voice="admin"
                  />
                  {d.reasoning ? (
                    <p className="t-cap leading-[1.5] text-[var(--t-3)]">{d.reasoning}</p>
                  ) : null}
                  {d.memberReason !== null ? (
                    <p className="t-cap text-[var(--t-4)]">Motif membre : {d.memberReason}</p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Alertes */}
      <section className="flex flex-col gap-2" aria-label="Alertes">
        <h3 className="t-h3 text-[var(--t-1)]">Alertes (répétition)</h3>
        {alerts.length === 0 ? (
          <p className="t-body text-[var(--t-3)]">
            Aucune alerte, un manquement isolé ne déclenche jamais rien.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {alerts.map((a) => (
              <li key={a.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="text-[13px] font-medium text-[var(--t-1)]">
                    {ALERT_LABELS[a.triggerType] ?? a.triggerType}
                    <span className="t-cap block text-[var(--t-4)]">
                      {a.repeatCount}× en 14 jours (seuil {a.threshold}) ·{' '}
                      {DATE_FMT.format(a.createdAt)}
                    </span>
                  </span>
                  {a.status === 'delivered' ? (
                    <Pill tone="cy">Fiche Douglas envoyée</Pill>
                  ) : a.status === 'open' ? (
                    <Pill tone="warn">Ouverte</Pill>
                  ) : (
                    <Pill tone="mute">Classée</Pill>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-[var(--b-subtle)] p-3 not-last:border-r">
      <span className="t-eyebrow text-[var(--t-4)]">{label}</span>
      <span className="f-mono text-[18px] font-semibold text-[var(--t-1)] tabular-nums">
        {value}
      </span>
    </div>
  );
}
