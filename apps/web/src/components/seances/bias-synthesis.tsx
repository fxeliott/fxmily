import { BiasPill } from '@/components/seances/bias-pill';
import type { SeanceAssetView } from '@/lib/seances/service';

/**
 * Bias overview table (Server Component) — the at-a-glance synthesis of every
 * followed asset's stated bias + its key reference level. Replaces the static
 * hub's decorative SVG panel with a fully accessible table (AA, real <th scope>),
 * which carries the same information without colour-only encoding. Self-omits
 * below 2 assets (nothing to compare).
 *
 * The "Repère clé" column is ADAPTIVE: when no asset stated a numeric level
 * (a structural-only séance — Règle n°1: never invent a price), the column is
 * dropped entirely rather than rendered as a wall of "-" placeholders.
 */
export function BiasSynthesis({ assets }: { assets: SeanceAssetView[] }) {
  if (assets.length < 2) return null;

  const showLevels = assets.some((a) => a.levels.length > 0);

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
            {showLevels ? (
              <th scope="col" className="t-eyebrow px-3 py-2 text-[var(--t-3)]">
                Repère clé
              </th>
            ) : null}
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
              {showLevels ? (
                <td className="px-3 py-2.5 align-middle font-mono text-[12px] text-[var(--t-2)] tabular-nums">
                  {a.levels[0]?.value ?? '-'}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
