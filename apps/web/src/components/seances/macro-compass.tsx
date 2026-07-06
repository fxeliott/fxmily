import { ArrowDown, ArrowRight, Radio } from 'lucide-react';

import { BiasPill } from '@/components/seances/bias-pill';
import { biasMeta } from '@/lib/seances/derive';
import type { SeanceAssetView } from '@/lib/seances/service';

/**
 * SeanceMacroCompass — the session's causal ENGINE, visualised (Server Component,
 * zero JS). Renders the "chef d'orchestre" mental model: the macro conductor
 * (DXY) drives its inverse-correlated satellites (EUR / GBP / XAU) — when the
 * dollar falls, they tend to rise, and vice-versa. This is the single highest-
 * comprehension schema of the page: it answers WHY the day's basket looks the
 * way it does, in one glance, before any per-asset detail.
 *
 * Built as a semantic HTML <figure> (not an opaque SVG chart) so it stays
 * pixel-legible, selectable, translatable and reflow-safe at any width — the
 * decorative flow motif is the ONLY SVG and is aria-hidden. Fidelity (Règle
 * n°1): each satellite shows its ACTUAL stated bias (never a bias forced from
 * the correlation) — a satellite that stayed neutre despite the tendency reads
 * as neutre. Colour is never the sole cue (BiasPill carries icon + word).
 *
 * Self-omits unless a conductor AND ≥1 correlated satellite are present, so a
 * séance without the macro context degrades to the rest of the page untouched.
 */

/** Symbols that move INVERSELY to the US dollar (Eliott's correlation basket). */
const INVERSE_TO_USD: ReadonlySet<string> = new Set(['EURUSD', 'GBPUSD', 'XAUUSD']);

/** Pick the correlated satellites out of a séance's assets, in their given order. */
export function pickCorrelatedSatellites(assets: SeanceAssetView[]): SeanceAssetView[] {
  return assets.filter((a) => INVERSE_TO_USD.has(a.symbol.toUpperCase()));
}

export function SeanceMacroCompass({
  conductor,
  satellites,
}: {
  conductor: SeanceAssetView;
  satellites: SeanceAssetView[];
}) {
  if (satellites.length === 0) return null;

  const cMeta = biasMeta(conductor.bias);
  // The mechanism sentence adapts to the conductor's actual direction (faithful
  // to what was said, reusable for any future séance). `flat` → we can't state a
  // direction, so we frame the correlation itself without a directional verb.
  const mechanism =
    cMeta.dir === 'down'
      ? 'Quand le dollar baisse, l’euro, la livre et l’or ont tendance à monter.'
      : cMeta.dir === 'up'
        ? 'Quand le dollar monte, l’euro, la livre et l’or ont tendance à baisser.'
        : 'Par corrélation inverse, l’euro, la livre et l’or évoluent à l’opposé du dollar.';

  return (
    <figure className="card-premium border-edge-top rounded-card m-0 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 sm:p-5">
      <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,0.9fr)_auto_minmax(0,1.15fr)] lg:gap-4">
        {/* Conductor — the macro driver, given visual primacy. */}
        <div className="rounded-control relative flex flex-col gap-2 border border-[var(--b-acc)] bg-[var(--acc-dim-2)] p-3.5">
          <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--acc-hi)]">
            <span aria-hidden className="live-dot inline-flex">
              <Radio className="h-3 w-3" strokeWidth={2} />
            </span>
            Chef d’orchestre
          </span>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-mono text-[15px] font-semibold tracking-[0.02em] text-[var(--t-1)] tabular-nums">
              {conductor.symbol}
            </span>
            {conductor.name ? (
              // `--t-2` (pas t-3) : sur le fond teinté `--acc-dim-2`, t-3 tombe à
              // 4,35:1 en light (< AA 4,5) — mesuré au sweep T16, worst gradient stop.
              <span className="t-cap text-[var(--t-2)]">{conductor.name}</span>
            ) : null}
          </div>
          <BiasPill bias={conductor.bias} />
          <p className="t-cap text-[var(--t-2)]">Tout se lit par rapport à lui.</p>
        </div>

        {/* Flow motif — decorative only (aria-hidden). The meaning is carried by
            the caption + BiasPills; this is pure visual connective tissue. Two
            orientation variants (never both visible) avoid fragile mixed
            responsive utilities: a vertical arrow on mobile, a horizontal rail
            on desktop, both anchored by the "corrélation inverse" chip. */}
        <div aria-hidden className="flex items-center justify-center">
          {/* Mobile: down arrow + chip. */}
          <span className="inline-flex items-center gap-1.5 py-0.5 text-[var(--t-3)] lg:hidden">
            <span className="t-eyebrow rounded-pill border border-[var(--b-default)] bg-[var(--bg-2)] px-2 py-1">
              corrélation inverse
            </span>
            <ArrowDown className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          {/* Desktop: vertical rail with the chip and a rightward arrow. */}
          <span className="hidden flex-col items-center gap-2 self-stretch text-[var(--t-3)] lg:flex">
            <span className="w-px grow bg-[var(--b-strong)]" />
            <span className="t-eyebrow rounded-pill border border-[var(--b-default)] bg-[var(--bg-2)] px-2 py-1 whitespace-nowrap">
              corrélation inverse
            </span>
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="w-px grow bg-[var(--b-strong)]" />
          </span>
        </div>

        {/* Satellites — the correlated basket, each with its OWN stated bias. */}
        <ul className="flex flex-col gap-2">
          {satellites.map((s) => (
            <li
              key={s.id}
              className="rounded-control flex flex-wrap items-center gap-x-2.5 gap-y-1 border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2"
            >
              <span className="font-mono text-[13px] font-semibold text-[var(--t-1)] tabular-nums">
                {s.symbol}
              </span>
              {s.name ? <span className="t-cap text-[var(--t-3)]">{s.name}</span> : null}
              <span className="ml-auto">
                <BiasPill bias={s.bias} />
              </span>
            </li>
          ))}
        </ul>
      </div>

      <figcaption className="t-cap mt-3.5 text-[var(--t-3)]">
        {mechanism} Chaque actif garde toutefois son propre biais : la corrélation donne le sens
        général, pas une certitude.
      </figcaption>
    </figure>
  );
}
