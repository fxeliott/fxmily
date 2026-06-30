import { buildLadder, type LevelRole, type RawLevel } from '@/lib/seances/levels-schema';
import { symbolSlug, type SeanceBias } from '@/lib/seances/derive';

/**
 * Anti-invention price ladder (Server Component, pure SVG — zero JS, zero
 * interactivity). Renders ONLY the numeric levels Eliott actually stated and
 * draws nothing unless ≥2 distinct prices exist (Règle n°1). Returns null when
 * fidelity forbids a chart → the caller shows the plain levels list instead.
 *
 * Roles map onto DS-v3 semantic tokens so the figure stays AA in light + dark:
 * bull→--ok, bear→--bad, brand→--acc, neutral→--t-3. The entry glow reuses
 * var(--acc) (auto-synced with the brand — improves on the static hub's
 * hardcoded #5DA8F2). Colour is NEVER the only cue: dash pattern + the recited
 * <desc> carry the same meaning (WCAG 1.4.1).
 */

const ROLE_COLOR: Record<LevelRole, string> = {
  bull: 'var(--ok)',
  bear: 'var(--bad)',
  brand: 'var(--acc)',
  neutral: 'var(--t-3)',
};

export function LevelsLadder({
  levels,
  bias,
  name,
  symbol,
}: {
  levels: RawLevel[];
  bias: SeanceBias | null;
  name: string | null;
  symbol: string;
}) {
  const ladder = buildLadder(levels, bias);
  if (!ladder) return null;

  const { width, height, labelX, lineX1, lineX2, biasDir, lines } = ladder;
  // Sanitise the symbol before using it in an id: a raw value with a space would
  // split the `aria-labelledby` token list and orphan the title/desc refs.
  const slug = symbolSlug(symbol);
  const titleId = `lad-t-${slug}`;
  const descId = `lad-d-${slug}`;
  const displayName = name ?? symbol;

  // Recited description (screen-reader fidelity, mirror levels-schema.mjs <desc>).
  const biasWord = biasDir === 'up' ? 'haussier' : biasDir === 'down' ? 'baissier' : 'neutre';
  const desc = [
    `Biais ${biasWord}.`,
    ...lines.map((l) => `${l.label} ${l.rawValue}.`),
    'Échelle verticale de prix, le haut correspond aux prix les plus élevés.',
  ].join(' ');

  // Bias arrow geometry in the left gutter (x = 20).
  const ax = 20;
  const arrow =
    biasDir === 'up' ? (
      <g stroke="var(--ok)" fill="var(--ok)">
        <line x1={ax} y1={height - 34} x2={ax} y2={34} strokeWidth={2} />
        <path d={`M ${ax - 5} 44 L ${ax} 30 L ${ax + 5} 44 Z`} />
      </g>
    ) : biasDir === 'down' ? (
      <g stroke="var(--bad)" fill="var(--bad)">
        <line x1={ax} y1={34} x2={ax} y2={height - 34} strokeWidth={2} />
        <path
          d={`M ${ax - 5} ${height - 44} L ${ax} ${height - 30} L ${ax + 5} ${height - 44} Z`}
        />
      </g>
    ) : (
      <g stroke="var(--t-3)" fill="var(--t-3)">
        <line
          x1={ax}
          y1={height / 2 - 18}
          x2={ax}
          y2={height / 2 + 18}
          strokeWidth={2}
          strokeDasharray="3 4"
        />
        <rect x={ax - 4} y={height / 2 - 2} width={8} height={4} />
      </g>
    );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-auto w-full"
    >
      {/* Template string (NOT `Schéma… — {displayName}`): mixed literal+expression
          children make React see a 2-element Array, which an SVG <title> can't
          hold as a single text node → console warning + SSR/CSR hydration mismatch. */}
      <title id={titleId}>{`Schéma de prix — ${displayName}`}</title>
      <desc id={descId}>{desc}</desc>

      {arrow}

      {lines.map((l, i) => {
        const color = ROLE_COLOR[l.role];
        return (
          <g key={`${l.label}-${i}`}>
            {/* Range band — ONLY for an actually-announced range (never a deduced R/R zone). */}
            {l.isRange ? (
              <>
                <rect
                  x={lineX1}
                  y={Math.min(l.yTop, l.yBot)}
                  width={lineX2 - lineX1}
                  height={Math.abs(l.yBot - l.yTop)}
                  fill={color}
                  opacity={0.08}
                />
                <line
                  x1={lineX1}
                  y1={l.yTop}
                  x2={lineX2}
                  y2={l.yTop}
                  stroke={color}
                  strokeWidth={1}
                  opacity={0.5}
                />
                <line
                  x1={lineX1}
                  y1={l.yBot}
                  x2={lineX2}
                  y2={l.yBot}
                  stroke={color}
                  strokeWidth={1}
                  opacity={0.5}
                />
              </>
            ) : null}

            {/* Entry glow — wider low-opacity stroke behind, var(--acc)-driven (auto-synced). */}
            {l.isEntry ? (
              <line
                x1={lineX1}
                y1={l.y}
                x2={lineX2}
                y2={l.y}
                stroke="var(--acc)"
                strokeWidth={l.width + 5}
                strokeLinecap="round"
                opacity={0.18}
              />
            ) : null}

            {/* The price line. */}
            <line
              x1={lineX1}
              y1={l.y}
              x2={lineX2}
              y2={l.y}
              stroke={color}
              strokeWidth={l.width}
              strokeDasharray={l.dash ?? undefined}
              strokeLinecap="round"
            />

            {/* Connector to the de-overlapped label (only if it moved). */}
            {Math.abs(l.labelY - l.y) > 3 ? (
              <line
                x1={lineX2}
                y1={l.y}
                x2={labelX - 2}
                y2={l.labelY}
                stroke={color}
                strokeWidth={0.75}
                opacity={0.5}
              />
            ) : null}

            {/* Value label, right gutter, text-anchor=end. */}
            <text
              x={labelX}
              y={l.labelY + 3.5}
              textAnchor="end"
              fill={color}
              style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '11px' }}
            >
              {l.rawValue}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
