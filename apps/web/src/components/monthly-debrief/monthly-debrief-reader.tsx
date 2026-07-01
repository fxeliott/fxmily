import { AIGeneratedBanner } from '@/components/ai-generated-banner';
import { CompletionOverview } from '@/components/reports/completion-overview';
import type { CompletionSummary } from '@/lib/reports/completion';
import type { SerializedMonthlyDebrief } from '@/lib/monthly-debrief/types';

/**
 * V1.4 — shared READ-ONLY renderer for a persisted monthly debrief
 * (SPEC §25.4). One presentational source of truth used by BOTH the member
 * page (`/debrief-mensuel`) and Eliott's admin panel
 * (`/admin/members/[id]?tab=monthly-debrief`) — so the §21.7 cyan boundary
 * + the EU AI Act 50(1) banner render identically and are a single audit
 * surface (anti-dup; a11y + posture reviewed once).
 *
 * Pure Server Component. The caller owns the month-title heading + page
 * chrome; this renders only the AI banner + the 6 content blocks. The
 * `summaryTraining` block keeps the **cyan §21.7 frame** even inside this
 * mixed real/training debrief; its text is §21.5-safe by construction (the
 * snapshot fed to the AI carried no backtest P&L — never `.v18-theme`).
 *
 * Calm Mark Douglas posture: no XP/streak/fanfare (anti Black-Hat,
 * SPEC §25.2), no trade advice (SPEC §2).
 */

/** Anti-drift AI model label (mirror `weekly-digest.tsx`). */
function modelDisplay(claudeModel: string): string {
  return claudeModel === 'claude-code-local'
    ? 'Claude · subscription locale'
    : `Claude ${claudeModel}`;
}

function patternEntriesOf(patterns: SerializedMonthlyDebrief['patterns']): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (patterns.monthOverMonth) entries.push(['Progression mois sur mois', patterns.monthOverMonth]);
  if (patterns.realTrend) entries.push(['Tendance trading réel', patterns.realTrend]);
  if (patterns.trainingRhythm) entries.push(['Rythme d’entraînement', patterns.trainingRhythm]);
  if (patterns.disciplineTrend) entries.push(['Trajectoire discipline', patterns.disciplineTrend]);
  return entries;
}

export function MonthlyDebriefReader({
  debrief,
  completion,
}: {
  debrief: SerializedMonthlyDebrief;
  /**
   * S6 §32-3 — deterministic completion + continuity snapshot for the month,
   * recomputed at render from the member's check-ins (never persisted). Optional
   * so the admin read-only panel (which does not load it) stays unchanged; when
   * present it renders ABOVE the AI banner (it is a factual block, not AI prose).
   */
  completion?: CompletionSummary;
}) {
  const patternEntries = patternEntriesOf(debrief.patterns);

  return (
    <div className="flex flex-col gap-5" data-slot="monthly-debrief-reader">
      {completion ? <CompletionOverview summary={completion} periodLabel="mois" /> : null}
      <AIGeneratedBanner variant="inline" modelName={modelDisplay(debrief.claudeModel)} />

      <section className="rounded-card-lg border border-[var(--b-default)] p-5">
        <p className="t-eyebrow-lg text-[var(--acc)]">Progression</p>
        <p className="t-body mt-2 leading-[1.65] whitespace-pre-line text-[var(--t-1)]">
          {debrief.progressionNarrative}
        </p>
      </section>

      <section className="rounded-card-lg border border-[var(--b-default)] p-5">
        <p className="t-eyebrow-lg text-[var(--acc)]">Trading réel</p>
        <p className="t-body mt-2 leading-[1.65] whitespace-pre-line text-[var(--t-2)]">
          {debrief.summaryReal}
        </p>
      </section>

      {/* §21.7 — the entraînement section keeps the cyan boundary visible
          even inside a mixed debrief. §21.5-safe: régularité/pratique only,
          the snapshot fed to the AI carried no backtest P&L. */}
      <section className="rounded-card-lg border border-[var(--cy-edge-soft)] bg-[var(--cy-dim)] p-5">
        <p className="t-eyebrow-lg text-[var(--cy)]">Entraînement</p>
        <p className="t-body mt-2 leading-[1.65] whitespace-pre-line text-[var(--t-2)]">
          {debrief.summaryTraining}
        </p>
        <p className="t-cap mt-3 text-[var(--t-3)]">
          Régularité et pratique uniquement, pas de P&amp;L, pas d&apos;analyse de marché. Ton
          entraînement reste isolé de ton edge réel, comme le reste du mode entraînement.
        </p>
      </section>

      {debrief.risks.length > 0 ? (
        <section className="rounded-card-lg border border-[var(--b-default)] p-5">
          <p className="t-eyebrow-lg text-[var(--t-3)]">Points de vigilance</p>
          <ul className="mt-2 flex flex-col gap-2">
            {debrief.risks.map((risk, idx) => (
              <li key={`risk-${idx}`} className="t-body flex gap-2 text-[var(--t-2)]">
                <span aria-hidden="true" className="text-[var(--bad)]">
                  ·
                </span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-card-lg border border-[var(--b-default)] p-5">
        <p className="t-eyebrow-lg text-[var(--acc)]">Pistes pour le mois à venir</p>
        <ul className="mt-2 flex flex-col gap-2">
          {debrief.recommendations.map((reco, idx) => (
            <li key={`reco-${idx}`} className="t-body flex gap-2 text-[var(--t-2)]">
              <span aria-hidden="true" className="text-[var(--acc)]">
                ·
              </span>
              <span>{reco}</span>
            </li>
          ))}
        </ul>
      </section>

      {patternEntries.length > 0 ? (
        <section className="rounded-card-lg border border-[var(--b-default)] p-5">
          <p className="t-eyebrow-lg text-[var(--t-3)]">Tendances observées</p>
          <dl className="mt-2 flex flex-col gap-3">
            {patternEntries.map(([label, value]) => (
              <div key={label}>
                <dt className="t-cap font-semibold text-[var(--t-3)]">{label}</dt>
                <dd className="t-body mt-0.5 text-[var(--t-2)]">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
