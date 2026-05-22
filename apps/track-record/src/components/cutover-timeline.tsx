import { formatCount } from '@/lib/format';

interface CutoverTimelineProps {
  /** Number of historical trades (left band). */
  historicalCount: number;
  /** Number of instruments traded in the historical segment. */
  historicalInstruments: number;
  /** Historical period label (e.g. "Jan – Nov 2025"). */
  historicalLabel: string;
  /** ISO date of the cutover. */
  cutoverDate: string;
  /** Long human label of the cutover (e.g. "21 mai 2026"). */
  cutoverLabel: string;
}

/**
 * Cutover timeline horizontal — remplace `<SegmentDivider>` (audit ui-designer
 * 2026-05-22 : "Refonte structurelle" = jargon développeur, pas institutionnel).
 *
 * Pattern : 2 bandes étiquetées "HISTORIQUE" + "LIVE" avec date pivot prominent
 * au centre. Pas de pill décorative. Couleurs : historique en `--tr-bg-2` calme,
 * live en `--tr-acc-dim` cyan tinté + ping animation. Signal verbatim "Bascule
 * live · premier trade horodaté en direct".
 *
 * Placement (audit priority 4) : AVANT le full AMF disclaimer, pas après.
 */
export function CutoverTimeline({
  historicalCount,
  historicalInstruments,
  historicalLabel,
  cutoverDate,
  cutoverLabel,
}: CutoverTimelineProps) {
  return (
    <section
      aria-label="Bascule entre les segments historique et live"
      className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] p-5 sm:p-6"
    >
      <header className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-[11px] font-medium tracking-[0.08em] text-[var(--tr-t-3)] uppercase">
          Bascule live · structure du track record
        </h2>
        <span className="hidden font-mono text-[11px] text-[var(--tr-t-3)] tabular-nums sm:inline">
          2 segments
        </span>
      </header>

      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
        {/* Historique band */}
        <div
          className="relative rounded-lg border px-4 py-4 sm:px-5"
          style={{
            background: 'var(--tr-bg-2)',
            borderColor: 'var(--tr-b-default)',
          }}
        >
          <div className="mb-1 text-[10px] font-medium tracking-[0.1em] text-[var(--tr-t-3)] uppercase">
            Historique · {historicalLabel}
          </div>
          <div className="font-mono text-[15px] text-[var(--tr-t-1)] tabular-nums">
            {formatCount(historicalCount)} trades · {historicalInstruments} instruments
          </div>
          <div className="mt-1 text-[11px] text-[var(--tr-t-3)]">Source : export ODS verbatim</div>
        </div>

        {/* Cutover pivot — date prominent, ping animation */}
        <div className="relative flex flex-col items-center justify-center px-3 py-2">
          <div
            aria-hidden
            className="absolute inset-x-0 top-1/2 -z-10 h-px"
            style={{
              background:
                'linear-gradient(90deg, var(--tr-b-default), color-mix(in oklab, var(--tr-acc), transparent 50%) 50%, var(--tr-b-default))',
            }}
          />
          <span className="text-[9px] font-medium tracking-[0.16em] text-[var(--tr-acc-hi)] uppercase">
            Cutover
          </span>
          <time
            dateTime={cutoverDate}
            className="my-1 font-mono text-[18px] leading-tight font-semibold text-[var(--tr-t-1)] tabular-nums"
          >
            {cutoverLabel}
          </time>
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--tr-t-3)] tabular-nums">
            <span aria-hidden className="relative inline-flex h-1.5 w-1.5">
              <span className="tr-ping absolute inline-flex h-full w-full rounded-full bg-[var(--tr-acc)] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--tr-acc)]" />
            </span>
            T-zero
          </span>
        </div>

        {/* Live band */}
        <div
          className="relative rounded-lg border px-4 py-4 sm:px-5"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in oklab, var(--tr-acc), transparent 92%) 0%, var(--tr-bg-2) 80%)',
            borderColor: 'color-mix(in oklab, var(--tr-acc), transparent 60%)',
          }}
        >
          <div className="mb-1 text-[10px] font-medium tracking-[0.1em] text-[var(--tr-acc-hi)] uppercase">
            Live · à partir d’aujourd’hui
          </div>
          <div className="font-mono text-[15px] text-[var(--tr-t-1)] tabular-nums">
            Streaming trades horodatés
          </div>
          <div className="mt-1 text-[11px] text-[var(--tr-t-3)]">
            Source : setups partagés en réunion live
          </div>
        </div>
      </div>
    </section>
  );
}
