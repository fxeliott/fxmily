import { ArrowLeft, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { AnnotationsSection } from '@/components/journal/annotations-section';
import { TradePsychologyTriad } from '@/components/journal/trade-psychology-triad';
import { TradeRiskSchema } from '@/components/journal/trade-risk-schema';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { SerializedAnnotation } from '@/lib/admin/annotations-service';
import { selectStorage } from '@/lib/storage';
import { splitNotes } from '@/lib/trades/notes';
import type { SerializedTrade } from '@/lib/trades/service';
import { SESSION_LABEL } from '@/lib/trading/sessions';
import { cn } from '@/lib/utils';

/**
 * Shared trade-detail rendering used by:
 *   - `/journal/[id]/page.tsx`             (member viewing their own trade)
 *   - `/admin/members/[id]/trades/[tradeId]/page.tsx` (admin variant)
 *
 * Élévation Sprint 1B : Card primary sur résultat hero (R réalisé big mono
 * avec drop-shadow lime/red selon outcome), Pill primitives, sémantique
 * long=ok / short=bad préservée. Sections cards default avec edge-top.
 */

const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const NUMBER_FMT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });

interface TradeDetailViewProps {
  trade: SerializedTrade;
  backHref: string;
  backLabel: string;
  closeHref: string | null;
  contextBadge?: string;
  footerSlot?: React.ReactNode;
  /** J4 — annotations attached to this trade. Empty array hides the section. */
  annotations?: SerializedAnnotation[];
  /** Identifier of the currently-authenticated user. Drives the admin
   * delete-CTA gate inside `<AnnotationsSection />`. */
  currentUserId?: string | null;
}

export function TradeDetailView({
  trade,
  backHref,
  backLabel,
  closeHref,
  contextBadge,
  footerSlot,
  annotations = [],
  currentUserId = null,
}: TradeDetailViewProps) {
  const storage = selectStorage();
  const entryUrl = trade.screenshotEntryKey ? storage.getReadUrl(trade.screenshotEntryKey) : null;
  const exitUrl = trade.screenshotExitKey ? storage.getReadUrl(trade.screenshotExitKey) : null;

  // S4 §33 #2 — split the merged notes back into the pre-entry intention and the
  // post-exit débrief so the arc lays each next to the right moment. A
  // delimiter-less note is ambiguous on a CLOSED trade (could be either) → kept
  // as a neutral « Notes » card ; on an OPEN trade it can only be the entry note.
  const splitNote = splitNotes(trade.notes);
  const entryNote = splitNote.hasSections ? splitNote.entry : trade.isClosed ? null : splitNote.raw;
  const debrief = splitNote.hasSections ? splitNote.debrief : null;
  const looseNote = !splitNote.hasSections && trade.isClosed ? splitNote.raw : null;

  const realizedR = trade.realizedR ? Number(trade.realizedR) : null;
  const isWin = realizedR !== null && realizedR > 0;
  const isLoss = realizedR !== null && realizedR < 0;
  const isAdmin = !!contextBadge;

  return (
    <main className="dash-stagger mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:py-10">
      {/* Header */}
      <header className="flex flex-col gap-3">
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          {backLabel}
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="f-mono text-[28px] leading-none font-semibold tracking-[0.01em] text-[var(--t-1)] sm:text-[32px]">
            {trade.pair}
          </h1>
          <Pill tone={trade.direction === 'long' ? 'ok' : 'bad'}>
            {trade.direction === 'long' ? (
              <TrendingUp className="h-2.5 w-2.5" strokeWidth={2} />
            ) : (
              <TrendingDown className="h-2.5 w-2.5" strokeWidth={2} />
            )}
            {trade.direction === 'long' ? 'LONG' : 'SHORT'}
          </Pill>
          {!trade.isClosed ? (
            <Pill tone="warn" dot="live">
              EN COURS
            </Pill>
          ) : null}
          {contextBadge ? (
            <Pill tone="acc">
              <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2} />
              {contextBadge.toUpperCase()}
            </Pill>
          ) : null}
        </div>

        <p className="t-body text-[var(--t-3)]">
          Entré le{' '}
          <span className="font-mono text-[var(--t-2)] tabular-nums">
            {DATETIME_FMT.format(new Date(trade.enteredAt))}
          </span>{' '}
          · {SESSION_LABEL[trade.session]}
        </p>
      </header>

      {/* Open warning + close CTA */}
      {!trade.isClosed && closeHref ? (
        <div className="rounded-card border border-[var(--warn-edge)] bg-[var(--warn-dim)] p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="flex flex-col gap-1">
            <span className="t-eyebrow text-[var(--warn)]">Trade ouvert</span>
            <p className="t-body text-[var(--t-2)]">
              Ajoute le résultat et la capture à la sortie pour calculer ton R réalisé.
            </p>
          </div>
          <Link
            href={closeHref}
            className={cn(
              btnVariants({ kind: 'primary', size: 'm' }),
              'mt-3 w-full sm:mt-0 sm:w-auto',
            )}
          >
            Clôturer maintenant
          </Link>
        </div>
      ) : null}

      {/* Result hero card (closed only) */}
      {trade.isClosed && trade.outcome ? (
        <Card primary className="p-5">
          <div className="flex items-center justify-between">
            <span className="t-eyebrow">Résultat clôturé</span>
            <Pill tone={trade.outcome === 'win' ? 'ok' : trade.outcome === 'loss' ? 'bad' : 'mute'}>
              {trade.outcome === 'win' ? 'GAIN' : trade.outcome === 'loss' ? 'PERTE' : 'BREAK-EVEN'}
            </Pill>
          </div>
          {realizedR !== null ? (
            <div className="mt-3 flex items-baseline gap-3">
              <span
                className={cn(
                  'f-mono text-[48px] leading-none font-bold tracking-[-0.04em] tabular-nums sm:text-[56px]',
                  isWin ? 'text-[var(--ok)]' : isLoss ? 'text-[var(--bad)]' : 'text-[var(--t-3)]',
                )}
                style={
                  isWin
                    ? { filter: 'drop-shadow(0 0 18px var(--ok-glow))' }
                    : isLoss
                      ? { filter: 'drop-shadow(0 0 18px var(--bad-glow))' }
                      : undefined
                }
              >
                {realizedR > 0 ? '+' : ''}
                {realizedR.toFixed(2)}R
              </span>
              <span className="t-eyebrow mb-1.5">R réalisé</span>
            </div>
          ) : null}
          {trade.realizedRSource === 'estimated' ? (
            <p className="t-cap mt-2 text-[var(--t-4)]">
              Valeur estimée, fournir le stop-loss au moment de l&apos;entrée permet un R exact.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* Plan d'entrée */}
      <Card className="p-4">
        <h2 className="t-eyebrow mb-3">Plan d&apos;entrée</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Stat label="Prix entrée" value={NUMBER_FMT.format(Number(trade.entryPrice))} mono />
          <Stat label="Lot / contrats" value={NUMBER_FMT.format(Number(trade.lotSize))} mono />
          <Stat
            label="Stop-loss"
            value={trade.stopLossPrice ? NUMBER_FMT.format(Number(trade.stopLossPrice)) : '—'}
            mono
          />
          <Stat label="R:R prévu" value={Number(trade.plannedRR).toFixed(2)} mono />
          <Stat
            label="Plan respecté"
            value={trade.planRespected ? 'Oui' : 'Non'}
            tone={trade.planRespected ? 'good' : 'bad'}
          />
          <Stat
            label="Hedge respecté"
            value={trade.hedgeRespected === null ? 'N/A' : trade.hedgeRespected ? 'Oui' : 'Non'}
            tone={trade.hedgeRespected === null ? 'neutral' : trade.hedgeRespected ? 'good' : 'bad'}
          />
          {/* §22-23 — the "oublis" axis (SPEC §21/§28), captured at close. Shown
              per-trade so the admin supervises process-completeness on EACH
              trade (not only via the aggregate discipline sub-score), and the
              member sees their own answer back. Tri-state: null (open / not
              answered) renders « — », never a fabricated "Non". */}
          <Stat
            label="Process complet"
            value={trade.processComplete === null ? '—' : trade.processComplete ? 'Oui' : 'Non'}
            tone={
              trade.processComplete === null ? 'neutral' : trade.processComplete ? 'good' : 'bad'
            }
          />
        </dl>

        {/* S11 — animated entry / stop / target geometry. Renders only when a
            stop-loss exists (else the dl above already carries the numbers).
            Descriptive diagram of the member's own plan — no market call (§2). */}
        {trade.stopLossPrice ? (
          <div className="mt-4 border-t border-[var(--b-default)] pt-4">
            <h3 className="t-mono-cap mb-2 text-[var(--t-4)]">Géométrie du plan</h3>
            <TradeRiskSchema
              trade={{
                entryPrice: Number(trade.entryPrice),
                stopLossPrice: Number(trade.stopLossPrice),
                plannedRR: Number(trade.plannedRR),
                direction: trade.direction,
                exitPrice: trade.exitPrice != null ? Number(trade.exitPrice) : null,
                realizedR: trade.realizedR != null ? Number(trade.realizedR) : null,
              }}
            />
          </div>
        ) : null}
      </Card>

      {/* S4 §33 (enrichissement #2) — le parcours du trade assemblé en un bloc :
          émotion + capture par moment (avant/pendant/après) + lecture écrite
          (intention d'entrée, débrief de sortie). Avant, ces dimensions étaient
          dispersées dans la fiche. Composant partagé membre/admin ; gère l'état
          « ouvert » (pendant/après se renseignent à la clôture, jamais « manquant »). */}
      <TradePsychologyTriad
        before={trade.emotionBefore}
        during={trade.emotionDuring}
        after={trade.emotionAfter}
        isClosed={trade.isClosed}
        entryPhotoUrl={entryUrl}
        exitPhotoUrl={exitUrl}
        entryNote={entryNote}
        debrief={debrief}
        pair={trade.pair}
      />

      {/* §31 — additional analysis photos. Click opens the full image in a new
          tab (same calm pattern as the /verification MT5 proofs, no modal). */}
      {(trade.media ?? []).length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="t-eyebrow">
            Photos d&apos;analyse additionnelles ({(trade.media ?? []).length})
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(trade.media ?? []).map((m, i) => (
              <li key={m.id}>
                <a
                  href={m.readUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="wow-hover-glow rounded-card block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.readUrl}
                    alt={`Photo d'analyse ${i + 1} du trade ${trade.pair}`}
                    loading="lazy"
                    className="rounded-card aspect-[16/9] w-full border border-[var(--b-default)] object-cover"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Sortie (closed only) — les chiffres bruts de sortie. La capture de sortie
          et le débrief ont rejoint « Le parcours de ce trade » ci-dessus (§33 #2). */}
      {trade.isClosed ? (
        <Card className="p-4">
          <h2 className="t-eyebrow mb-3">Sortie</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Stat
              label="Date sortie"
              value={trade.exitedAt ? DATETIME_FMT.format(new Date(trade.exitedAt)) : '—'}
            />
            <Stat
              label="Prix sortie"
              value={trade.exitPrice ? NUMBER_FMT.format(Number(trade.exitPrice)) : '—'}
              mono
            />
          </dl>
        </Card>
      ) : null}

      {/* Notes — seulement le cas AMBIGU : une note sans délimiteur sur un trade
          clôturé (impossible de prouver « avant » vs « débrief »). Les notes
          scindées sont rendues, étiquetées, dans le parcours ci-dessus (§33 #2). */}
      {looseNote ? (
        <Card className="p-4">
          <h2 className="t-eyebrow mb-2">Notes</h2>
          <p className="t-body leading-relaxed whitespace-pre-wrap text-[var(--t-2)]">
            {looseNote}
          </p>
        </Card>
      ) : null}

      {/* J4 — annotations list (admin sees "Corrections envoyées" with delete
          + non-lue badges; member sees "Corrections reçues" read-only). */}
      <AnnotationsSection
        annotations={annotations}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
      />

      {/* Footer admin/member-specific slot */}
      {footerSlot ? (
        <footer className="border-t border-[var(--b-default)] pt-4">{footerSlot}</footer>
      ) : null}
    </main>
  );
}

function Stat({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-[var(--ok)]'
      : tone === 'bad'
        ? 'text-[var(--bad)]'
        : tone === 'neutral'
          ? 'text-[var(--t-3)]'
          : 'text-[var(--t-1)]';
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="t-mono-cap text-[var(--t-4)]">{label}</dt>
      <dd className={cn('text-[14px] break-words tabular-nums', mono && 'f-mono', toneClass)}>
        {value}
      </dd>
    </div>
  );
}
