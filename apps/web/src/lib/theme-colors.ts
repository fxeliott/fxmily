/**
 * Theme color hex constants for Recharts SVG fills/strokes.
 *
 * Why hex constants instead of `var(--token)` strings (J6.6 ui-designer
 * BLOCKER B1):
 *
 * Recharts injects whatever you pass in `fill=` / `stroke=` directly as an
 * SVG attribute, and `fill="var(--bad)"` is **not consistently resolved**
 * across browsers — Safari < 15.4 and several Android WebViews evaluate
 * the literal string and render nothing (or black). This gives flat-black
 * bars on iOS users while everything looks fine on Chrome.
 *
 * The community-standard workaround is to read the CSS custom property at
 * runtime via `getComputedStyle(document.documentElement).getPropertyValue`,
 * but that introduces a hydration mismatch (SSR returns the fallback, the
 * client switches after mount) and re-render churn on theme toggles.
 *
 * Fxmily V1 is dark-only with a fixed token palette. Hardcoding the hex
 * mirrors of `globals.css` here is the simplest, fastest, SSR-safe path.
 * Source of truth stays the CSS — we just reflect it. When Eliot tweaks a
 * token, this file gets the hex update too (one-line PR).
 *
 * Hex values are the comments in `apps/web/src/app/globals.css` (the OKLCH
 * tokens with `/* #xxx *​/` annotations). Keep them in sync.
 */

export const CHART_COLORS = {
  // Surfaces
  bg: '#07090f',
  bg1: '#0f131c',
  bg2: '#141823',
  bg3: '#1a1f2c',

  // Text gradient
  t1: '#ecedf2',
  t2: '#b8bdc9',
  t3: '#8c92a3',
  t4: '#959aab',

  // Borders (rgba on the underlying neutral)
  bSubtle: 'rgba(140, 146, 163, 0.08)',
  bDefault: 'rgba(140, 146, 163, 0.14)',
  bStrong: 'rgba(140, 146, 163, 0.22)',

  // Semantic
  acc: '#a3e635', // lime — process / discipline scores
  accGlow: 'rgba(163, 230, 53, 0.55)',
  cy: '#22d3ee', // cyan — secondary / charts secondary
  ok: '#4ade80', // green — outcome / gain
  warn: '#fbbf24', // amber — caution
  warnHi: '#fcd34d', // brighter amber for low-contrast surfaces (tooltips)
  bad: '#f87171', // red — loss / critical
  badHi: '#fca5a5', // brighter red for low-contrast surfaces (tooltips)
} as const;

export type ChartColorKey = keyof typeof CHART_COLORS;

/** Sugar — same shape, named for ergonomics in JSX. */
export const C = CHART_COLORS;
