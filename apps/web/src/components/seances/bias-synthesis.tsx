import { BiasPill } from '@/components/seances/bias-pill';
import type { SeanceAssetView } from '@/lib/seances/service';

/**
 * Bias overview table (Server Component) — the at-a-glance synthesis of every
 * followed asset's stated bias + its key reference level. Replaces the static
 * hub's decorative SVG panel with a fully accessible table (AA, real <th scope>),
 * which carries the same information without colour-only encoding. Self-omits
 * below 2 assets (nothing to compare).
 */
export function BiasSynthesis({ assets }: { assets: SeanceAssetView[] }) {
  if (assets.length < 2) return null;

  return (
    <div className="rounded-card overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)]">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Vue d&apos;ensemble des biais par actif</caption>
        <thead>
          <tr className="border-b border-[var(--b-default)]">
            <th scope="col" className="t-eyebrow px-3 py-2 text-[var(--t-3)]">
              Actif
            </th>
            <th scope="col" className="t-eyebrow px-3 py-2 text-[var(--t-3)]">
              Biais
            </th>
            <th scope="col" className="t-eyebrow px-3 py-2 text-[var(--t-3)]">
              Repère clé
            </th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a, i) => (
            <tr key={a.id} className={i > 0 ? 'border-t border-[var(--b-default)]' : undefined}>
              <th scope="row" className="px-3 py-2.5 align-middle">
                <span className="font-mono text-[13px] font-semibold text-[var(--t-1)] tabular-nums">
                  {a.symbol}
                </span>
                {a.name ? <span className="t-cap ml-2 text-[var(--t-3)]">{a.name}</span> : null}
              </th>
              <td className="px-3 py-2.5 align-middle">
                <BiasPill bias={a.bias} />
              </td>
              <td className="px-3 py-2.5 align-middle font-mono text-[12px] text-[var(--t-2)] tabular-nums">
                {a.levels[0]?.value ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
