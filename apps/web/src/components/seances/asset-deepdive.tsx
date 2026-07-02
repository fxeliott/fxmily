import { LevelsLadder } from '@/components/seances/levels-ladder';
import { BiasPill } from '@/components/seances/bias-pill';
import type { SeanceAssetView } from '@/lib/seances/service';
import { cn } from '@/lib/utils';

/**
 * Per-asset deep-dive (Server Component). Faithful A-Z reading (Règle n°1) +
 * the stated key levels + the anti-invention price ladder (which self-omits
 * unless ≥2 distinct prices were given). Two-column on desktop (reading | aside),
 * stacked on mobile. `--gold` (scoped to the séance page) accents XAU EXCLUSIVELY
 * (editorial invariant) — every other asset uses the neutral DS surface.
 */
export function AssetDeepDive({ asset }: { asset: SeanceAssetView }) {
  const isGold = asset.symbol.toUpperCase().startsWith('XAU');
  const hasLevels = asset.levels.length > 0;
  const hasReading = asset.reading.some((p) => p.trim().length > 0);

  return (
    <article
      id={asset.anchorId}
      className="rounded-card relative scroll-mt-24 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] p-4 sm:p-5"
    >
      {/* XAU gets the gold treatment (editorial invariant) — a DECORATIVE rail
          only, so the symbol text stays --t-1 (AA in light + dark). --gold is
          scoped on the séance page root. */}
      {isGold ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1"
          style={{ background: 'var(--gold)' }}
        />
      ) : null}

      {/* Header — symbol chip + name + bias. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5">
          {isGold ? (
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--gold)' }}
            />
          ) : null}
          <span className="font-mono text-[15px] font-semibold tracking-[0.02em] text-[var(--t-1)] tabular-nums">
            {asset.symbol}
          </span>
        </span>
        {asset.name ? <span className="t-cap text-[var(--t-3)]">{asset.name}</span> : null}
        <span className="ml-auto">
          <BiasPill bias={asset.bias} />
        </span>
      </div>

      <div
        className={cn('mt-4 grid gap-5', hasLevels ? 'lg:grid-cols-[1fr_minmax(220px,300px)]' : '')}
      >
        {/* Reading. */}
        <div className="flex flex-col gap-2.5">
          {hasReading ? (
            asset.reading
              .filter((p) => p.trim().length > 0)
              .map((para, i) => (
                <p key={i} className="t-body text-[var(--t-2)]">
                  {para}
                </p>
              ))
          ) : (
            <p className="t-cap text-[var(--t-3)] italic">Analyse à venir.</p>
          )}
        </div>

        {/* Aside — key levels list + ladder. */}
        {hasLevels ? (
          <aside className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1.5">
              {asset.levels.map((lv, i) => (
                <li
                  key={i}
                  className="rounded-control flex flex-col gap-0.5 border border-[var(--b-default)] bg-[var(--bg-2)] px-2.5 py-1.5"
                >
                  <span className="t-eyebrow text-[var(--t-3)]">{lv.label}</span>
                  <span className="font-mono text-[13px] text-[var(--t-1)] tabular-nums">
                    {lv.value}
                  </span>
                </li>
              ))}
            </ul>
            <LevelsLadder
              levels={asset.levels}
              bias={asset.bias}
              name={asset.name}
              symbol={asset.symbol}
            />
          </aside>
        ) : null}
      </div>
    </article>
  );
}
