import 'server-only';

import { ShieldCheck } from 'lucide-react';

import { Pill } from '@/components/ui/pill';
import { loadPreTradeAnalyticsData } from '@/lib/pre-trade/service';
import { cn } from '@/lib/utils';

import {
  REASON_LABEL_FR,
  REASON_ORDER,
  REASON_TONE,
  distributionPercents,
  emptyCopyForReason,
  formatRatePercent,
  formatSampleSize,
} from './format-analytics';

/**
 * V2.3 ext #2 — Session HH frontend (Dashboard analytics widget pre-trade).
 *
 * Server Component async — fetch direct via `loadPreTradeAnalyticsData`
 * (server-only service). Pas de Client island : tout est rendu côté serveur
 * (CSS bars natives, pas de Recharts → bundle JS membre inchangé).
 *
 * Posture Mark Douglas (SPEC §2) — décisions verrouillées (NE PAS re-litiger) :
 *   - Tone `acc` (lime) UNIQUEMENT sur la barre `edge` ; les 3 autres
 *     (`fomo`/`revenge`/`boredom`) reçoivent `t-3` slate neutre. JAMAIS rouge.
 *     Le membre observe ses patterns, il ne se fait pas punir visuellement
 *     (Yu-kai Chou anti-Black-Hat invariant).
 *   - Sample size affiché via `<Pill tone="mute">n = X</Pill>` (transparence
 *     honnêteté V2.1.3 carbone).
 *   - Empty states distincts `no_checks` vs `below_threshold` — copy
 *     pédagogique non culpabilisante.
 *
 * Window 30j fixed V1 (label "Sur les 30 derniers jours"). Pas de tabs
 * 7d/30d/3m (V2.x si demande membre).
 *
 * Pattern carbone J6 `<SessionPerfBars>` (Server Component, CSS bars
 * normalisées) + V2.1.3 `<HabitTradeCorrelationCard>` honesty insufficient_data.
 *
 * a11y :
 *   - `<section aria-labelledby="pre-trade-analytics-heading">` (carbone
 *     V1.12 P7 landmark hierarchy)
 *   - `<h2 id="pre-trade-analytics-heading">` visible
 *   - Bars `aria-hidden` (info portée par le label texte)
 *   - Distribution structurée `<ul>` / `<li>` (sémantique liste)
 */

export async function PreTradeAnalyticsCard({ userId }: { userId: string }) {
  const data = await loadPreTradeAnalyticsData(userId);

  const allInsufficient =
    data.reasonDistribution.kind === 'insufficient_data' &&
    data.planAlignmentRate.kind === 'insufficient_data' &&
    data.stopLossPredefinedRate.kind === 'insufficient_data';

  return (
    <section
      className="rounded-card-lg flex h-full flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-5"
      aria-labelledby="pre-trade-analytics-heading"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <ShieldCheck className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="t-eyebrow text-[var(--acc)]">Pré-trade · 30 derniers jours</span>
            <h2
              id="pre-trade-analytics-heading"
              className="text-[15px] font-semibold text-[var(--t-1)]"
            >
              Tes patterns d&apos;exécution
            </h2>
          </div>
        </div>
      </header>

      {allInsufficient ? (
        <AllEmptyState data={data} />
      ) : (
        <div className="flex flex-col gap-5">
          <ReasonDistributionRow result={data.reasonDistribution} />
          <RatePairRow plan={data.planAlignmentRate} stopLoss={data.stopLossPredefinedRate} />
        </div>
      )}
    </section>
  );
}

/**
 * Empty state global quand AUCUNE des 3 métriques n'a assez de données.
 * Distingue 2 cas : `no_checks` (member n'a JAMAIS fait de pré-trade) vs
 * `below_threshold` (member a démarré mais < 8 checks).
 */
function AllEmptyState({ data }: { data: Awaited<ReturnType<typeof loadPreTradeAnalyticsData>> }) {
  // On lit la `reason` depuis n'importe laquelle des 3 (elles sont toutes
  // `insufficient_data` ici, et toutes alignées sur la même `reason` puisque
  // la `reason` dépend uniquement du sampleSize qui est identique).
  const ref = data.reasonDistribution;
  if (ref.kind !== 'insufficient_data') return null;
  const copy = emptyCopyForReason(ref.reason, ref.sampleSize, 8);

  return (
    <div className="rounded-card flex flex-col gap-2 border border-dashed border-[var(--b-default)] bg-[var(--bg-2)] p-4">
      <p className="text-[13px] font-semibold text-[var(--t-1)]">{copy.title}</p>
      <p className="text-[12px] leading-relaxed text-[var(--t-3)]">{copy.subtitle}</p>
    </div>
  );
}

/**
 * Row "Distribution `reasonToTrade`" : 4 bars horizontales CSS natives
 * (carbone J6 `<SessionPerfBars>`). Affiché si `kind === 'ok'`, sinon
 * empty state in-line.
 */
function ReasonDistributionRow({
  result,
}: {
  result: Awaited<ReturnType<typeof loadPreTradeAnalyticsData>>['reasonDistribution'];
}) {
  if (result.kind === 'insufficient_data') {
    const copy = emptyCopyForReason(result.reason, result.sampleSize, 8);
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="t-eyebrow">Distribution des raisons</span>
          <Pill tone="mute">{formatSampleSize(result.sampleSize)}</Pill>
        </div>
        <p className="text-[12px] leading-relaxed text-[var(--t-3)]">{copy.subtitle}</p>
      </div>
    );
  }

  const pcts = distributionPercents(result.distribution, result.sampleSize);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-eyebrow">Distribution des raisons</span>
        <Pill tone="mute">{formatSampleSize(result.sampleSize)}</Pill>
      </div>
      <ul className="flex flex-col gap-2">
        {REASON_ORDER.map((reason) => {
          const count = result.distribution[reason];
          const pct = pcts[reason];
          const tone = REASON_TONE[reason];
          return (
            <li key={reason} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[12px]">
                <span
                  className={cn(
                    'font-medium',
                    tone === 'acc' ? 'text-[var(--acc)]' : 'text-[var(--t-1)]',
                  )}
                >
                  {REASON_LABEL_FR[reason]}
                </span>
                <span className="flex items-center gap-3">
                  <span className="t-mono-cap text-[var(--t-4)]">
                    {count} check{count > 1 ? 's' : ''}
                  </span>
                  <span
                    className={cn(
                      'f-mono w-12 text-right text-[12px] tabular-nums',
                      tone === 'acc' ? 'text-[var(--acc)]' : 'text-[var(--t-3)]',
                    )}
                  >
                    {pct.toFixed(0)}%
                  </span>
                </span>
              </div>
              <div className="rounded-pill h-1.5 overflow-hidden bg-[var(--bg-2)]">
                <div
                  className={cn(
                    'rounded-pill h-full',
                    tone === 'acc' ? 'bg-[var(--acc)]' : 'bg-[var(--t-4)]',
                  )}
                  style={{ width: `${Math.max(2, pct)}%` }}
                  aria-hidden="true"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Pair "Plan respecté + Stop-loss défini" en 2 colonnes responsive
 * (`grid-cols-1 sm:grid-cols-2`). Chaque cellule = 1 rate ou empty state.
 */
function RatePairRow({
  plan,
  stopLoss,
}: {
  plan: Awaited<ReturnType<typeof loadPreTradeAnalyticsData>>['planAlignmentRate'];
  stopLoss: Awaited<ReturnType<typeof loadPreTradeAnalyticsData>>['stopLossPredefinedRate'];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <RateCell label="Plan respecté" sublabel="Tu étais aligné avec ton plan" result={plan} />
      <RateCell
        label="Stop-loss défini"
        sublabel="Tu avais ton SL prêt avant d'entrer"
        result={stopLoss}
      />
    </div>
  );
}

function RateCell({
  label,
  sublabel,
  result,
}: {
  label: string;
  sublabel: string;
  result: Awaited<ReturnType<typeof loadPreTradeAnalyticsData>>['planAlignmentRate'];
}) {
  if (result.kind === 'insufficient_data') {
    const copy = emptyCopyForReason(result.reason, result.sampleSize, 8);
    return (
      <div className="rounded-card flex flex-col gap-1 border border-[var(--b-default)] bg-[var(--bg-2)] p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="t-eyebrow">{label}</span>
          <Pill tone="mute">{formatSampleSize(result.sampleSize)}</Pill>
        </div>
        <p className="text-[12px] leading-relaxed text-[var(--t-3)]">{copy.title}</p>
      </div>
    );
  }

  return (
    <div className="rounded-card flex flex-col gap-1 border border-[var(--b-default)] bg-[var(--bg-2)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-eyebrow">{label}</span>
        <Pill tone="mute">{formatSampleSize(result.sampleSize)}</Pill>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[24px] font-semibold text-[var(--t-1)] tabular-nums">
          {formatRatePercent(result.rate)}
        </span>
      </div>
      <p className="text-[12px] leading-relaxed text-[var(--t-3)]">{sublabel}</p>
    </div>
  );
}
