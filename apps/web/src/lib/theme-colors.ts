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
 * Source of truth stays the CSS — we just reflect it. When Eliott tweaks a
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
  acc: '#3b82f6', // blue — process / discipline scores (DS-v3)
  acc2: '#5b5bd6', // indigo — 2nd data series (mirror of --acc-2, anti-fade multi-series)
  cy: '#22d3ee', // cyan — secondary / charts secondary
  ok: '#4ade80', // green — outcome / gain
  warn: '#fbbf24', // amber — caution
  warnHi: '#fcd34d', // brighter amber for low-contrast surfaces (tooltips)
  bad: '#f87171', // red — loss / critical
  badHi: '#fca5a5', // brighter red for low-contrast surfaces (tooltips)
} as const;

export type ChartColorKey = keyof typeof CHART_COLORS;

/**
 * LIGHT mirror (S18). Hex values are the `.light` block annotations in
 * `globals.css` (the recalibrated WCAG-AA light tokens). Same keys/shape as
 * CHART_COLORS so consumers can swap the whole object. Surfaces become
 * white/soft-grey, accent/cyan/state hues DARKEN to clear 4.5:1 on white,
 * finance grammar (ok/bad) re-saturated never inverted, tooltip *Hi tones get
 * DARKER (the tooltip bg is now white). Keep in sync with globals.css `.light`.
 */
export const CHART_COLORS_LIGHT = {
  // Surfaces (light)
  bg: '#f1f3f7',
  bg1: '#ffffff',
  bg2: '#e9ecf2',
  bg3: '#ffffff',

  // Text gradient (AA on white)
  t1: '#20283a',
  t2: '#4a5366',
  t3: '#5b6478',
  t4: '#555e70',

  // Borders (rgba on the light neutral oklch(0.4 0.02 258) ≈ #4a5263)
  bSubtle: 'rgba(74, 82, 99, 0.1)',
  bDefault: 'rgba(74, 82, 99, 0.16)',
  bStrong: 'rgba(74, 82, 99, 0.26)',

  // Semantic (darkened for white canvas)
  acc: '#2563eb', // blue — process / discipline (light --acc)
  acc2: '#4f46e5', // indigo — 2nd data series (light --acc-2)
  cy: '#0e7c99', // teal — cyan illegible on white → teal (light --cy)
  ok: '#18914e', // green — gain (light --ok)
  warn: '#936713', // amber — caution (light --warn)
  warnHi: '#7d5810', // darker amber for the now-white tooltip bg (light --warn-hi)
  bad: '#c92a26', // red — loss (light --bad)
  badHi: '#b01f1d', // darker red for the now-white tooltip bg (light --bad-hi)
} as const satisfies Record<ChartColorKey, string>;

/** Sugar — same shape, named for ergonomics in JSX. DARK set (SSR-safe default).
 * For theme-aware charts use `useChartColors()` (use-chart-colors.ts). */
export const C = CHART_COLORS;
