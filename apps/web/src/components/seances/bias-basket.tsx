import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { biasMeta } from '@/lib/seances/derive';
import type { SeanceAssetView } from '@/lib/seances/service';

/**
 * SeanceBiasBasket — "le panier du jour" at a glance (Server Component, zero JS).
 * Groups EVERY followed asset by its stated direction (haussier / neutre /
 * baissier) so a member who has no time to read every deep-dive still grasps the
 * whole roster in one look. Complements the macro compass (which only shows the
 * DXY-correlated cluster) by also placing the indices in the picture.
 *
 * a11y: each group is a labelled region (icon + word + count, never colour
 * alone — WCAG 1.4.1) whose chips are a real <ul>; empty groups self-omit so a
 * one-sided basket never shows a dangling empty column. Direction tokens flip
 * with the theme (--ok / --t-3 / --bad).
 */

type Dir = 'up' | 'flat' | 'down';

interface Group {
  dir: Dir;
  label: string;
  /** Text/icon tint — a semantic token so it stays AA in light + dark. */
  color: string;
  Icon: typeof TrendingUp;
  assets: SeanceAssetView[];
}

/** Column order: convictions up first, neutral middle, down last (reading flow). */
const GROUP_ORDER: readonly { dir: Dir; label: string; color: string; Icon: typeof TrendingUp }[] =
  [
    { dir: 'up', label: 'Haussier', color: 'var(--ok)', Icon: TrendingUp },
    { dir: 'flat', label: 'Neutre', color: 'var(--t-3)', Icon: Minus },
    { dir: 'down', label: 'Baissier', color: 'var(--bad)', Icon: TrendingDown },
  ];

export function SeanceBiasBasket({ assets }: { assets: SeanceAssetView[] }) {
  if (assets.length === 0) return null;

  const groups: Group[] = GROUP_ORDER.map((g) => ({
    ...g,
    assets: assets.filter((a) => biasMeta(a.bias).dir === g.dir),
  })).filter((g) => g.assets.length > 0);

  if (groups.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Panier du jour, actifs groupés par biais"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {groups.map((g) => (
        <section
          key={g.dir}
          className="rounded-card flex flex-col gap-2.5 border border-[var(--b-default)] bg-[var(--bg-1)] p-3.5"
        >
          <h3 className="t-eyebrow inline-flex items-center gap-1.5" style={{ color: g.color }}>
            <g.Icon className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
            {g.label}
            <span className="ml-auto font-mono text-[11px] tabular-nums">{g.assets.length}</span>
          </h3>
          <ul className="flex flex-col gap-1.5">
            {g.assets.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-[13px] font-semibold text-[var(--t-1)] tabular-nums">
                  {a.symbol}
                </span>
                {a.name ? <span className="t-cap text-[var(--t-3)]">{a.name}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
