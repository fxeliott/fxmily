/**
 * Anti-invention price ladder geometry (Règle n°1) — pure, dependency-free, NO DB.
 *
 * Faithful port of the static hub's `levels-schema.mjs`
 * (D:/Projects/reunion-trading-hub). The ladder is the differentiator of the
 * réunion hub: it ONLY ever plots numeric values that Eliott actually stated,
 * and it refuses to draw at all unless at least two DISTINCT prices exist — so
 * it can never fabricate a level or a trade that was not announced.
 *
 * This module returns a structured, COLOUR-AGNOSTIC model (`role` names, never
 * CSS values) so the React renderer can map roles onto Fxmily DS-v3 tokens
 * (bull→--ok, bear→--bad, brand→--acc, neutral→--t-3) and stay AA in light+dark.
 * Kept pure + deterministic for unit testing (isPriceLike / parseNums / the
 * `<2 distinct` guard are the invariants of fidelity).
 */
import type { SeanceBias } from './derive';

// ── SVG canvas (viewBox; the element is sized in CSS, never width/height attrs) ─
const W = 360;
const H = 300;
const PAD_T = 26;
const PAD_B = 26;
const PLOT_H = H - PAD_T - PAD_B;
const LABEL_X = 348; // right gutter, text-anchor=end
const LINE_X1 = 44; // price line start (after the left bias gutter)
const LINE_X2 = 300; // price line end (before the label gutter)
const MIN_GAP = 22; // min vertical gap between two labels
const PAD_DOMAIN = 0.12; // domain margin = span * 0.12 (no extrapolation)

export type LevelRole = 'bull' | 'bear' | 'brand' | 'neutral';

export interface LadderLine {
  role: LevelRole;
  /** SVG stroke-dasharray, or null for a solid line. */
  dash: string | null;
  width: number;
  isRange: boolean;
  /** True for an entry/zone line → gets the brand glow. */
  isEntry: boolean;
  /** y of the mid price (range → midpoint). */
  y: number;
  /** y of the range high (== y when not a range). */
  yTop: number;
  /** y of the range low (== y when not a range). */
  yBot: number;
  /** De-overlapped label y (may differ from `y` → draw a connector). */
  labelY: number;
  label: string;
  /** Raw value string shown in the label (verbatim). */
  rawValue: string;
}

export interface Ladder {
  width: number;
  height: number;
  labelX: number;
  lineX1: number;
  lineX2: number;
  biasDir: 'up' | 'down' | 'flat';
  lines: LadderLine[];
}

export interface RawLevel {
  label: string;
  value: string;
}

/** Strip diacritics + lowercase (accent-insensitive classify). */
function fold(s: string): string {
  return Array.from(s.normalize('NFD'))
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c < 0x0300 || c > 0x036f; // drop combining diacritical marks
    })
    .join('')
    .toLowerCase();
}

/**
 * Extract every number from a string (comma decimal → dot). Mirror
 * `parseNums` levels-schema.mjs:26-35.
 */
export function parseNums(value: string): number[] {
  const matches = value.match(/-?\d+(?:[.,]\d+)?/g);
  if (!matches) return [];
  return matches.map((m) => Number(m.replace(',', '.'))).filter((n) => Number.isFinite(n));
}

/**
 * True iff `value` STARTS with a price token (optional comparator, a number,
 * optional " a - b " range) AND the remainder contains NO other digit. This is
 * what rejects prose with an incidental number (e.g. "cassure du plus haut de
 * 2024 vers 2400"). Mirror `isPriceLike` levels-schema.mjs:45-51.
 */
export function isPriceLike(value: string): boolean {
  const v = value.trim();
  // Leading: optional comparator, a number, optional range "<num> - <num>".
  const m = /^[<>≤≥]?\s*-?\d+(?:[.,]\d+)?(?:\s*[-–]\s*-?\d+(?:[.,]\d+)?)?/.exec(v);
  if (!m) return false;
  const rest = v.slice(m[0].length);
  return !/\d/.test(rest);
}

/** label → role + stroke style (accent-insensitive). Mirror classify levels-schema.mjs:54-62. */
function classify(label: string): {
  role: LevelRole;
  dash: string | null;
  width: number;
  isEntry: boolean;
} {
  const l = fold(label);
  if (l.includes('invalidation') || l.includes('stop')) {
    return { role: 'bear', dash: '2 5', width: 2, isEntry: false };
  }
  if (l.includes('objectif') || l.includes('cible') || l.includes('target')) {
    return { role: 'bull', dash: '9 5', width: 2, isEntry: false };
  }
  if (l.includes('entree') || l.includes('achat') || l.includes('zone d')) {
    return { role: 'brand', dash: null, width: 2.6, isEntry: true };
  }
  if (l.includes('support') || l.includes('borne basse') || l.includes('plancher')) {
    return { role: 'bull', dash: null, width: 2, isEntry: false };
  }
  if (l.includes('resistance') || l.includes('borne haute') || l.includes('plafond')) {
    return { role: 'bear', dash: null, width: 2, isEntry: false };
  }
  return { role: 'neutral', dash: null, width: 1.6, isEntry: false };
}

/** Normalised bias → arrow direction. Mirror `biasWord` levels-schema.mjs:64-69. */
function biasDir(bias: SeanceBias | string | null | undefined): 'up' | 'down' | 'flat' {
  const b = fold(bias ?? '');
  if (b.includes('haussier') || b === 'long' || b === 'bull') return 'up';
  if (b.includes('baissier') || b === 'short' || b === 'bear') return 'down';
  return 'flat';
}

/**
 * Build the ladder model, or `null` when fidelity forbids drawing (fewer than
 * two distinct stated prices). The renderer draws nothing on `null` and falls
 * back to the plain levels list. Mirror `levelsSchema` levels-schema.mjs:72-123.
 */
export function buildLadder(
  levels: RawLevel[] | null | undefined,
  bias: SeanceBias | string | null | undefined,
): Ladder | null {
  if (!levels || levels.length === 0) return null;

  interface Drawable {
    label: string;
    rawValue: string;
    nums: number[];
    style: ReturnType<typeof classify>;
  }

  const drawables: Drawable[] = [];
  const allNums: number[] = [];

  for (const lv of levels) {
    if (typeof lv?.value !== 'string' || !isPriceLike(lv.value)) continue;
    const nums = parseNums(lv.value);
    if (nums.length === 0) continue;
    drawables.push({ label: lv.label, rawValue: lv.value, nums, style: classify(lv.label) });
    allNums.push(...nums);
  }

  if (new Set(allNums).size < 2) return null;

  const pMin = Math.min(...allNums);
  const pMax = Math.max(...allNums);
  const span = pMax - pMin; // > 0 (≥2 distinct values guaranteed)
  const pad = span * PAD_DOMAIN;
  const domainMax = pMax + pad;
  const domainMin = pMin - pad;
  const scaleY = (p: number): number =>
    PAD_T + ((domainMax - p) / (domainMax - domainMin)) * PLOT_H;

  const lines: LadderLine[] = drawables.map((d) => {
    const hi = Math.max(...d.nums);
    const lo = Math.min(...d.nums);
    const isRange = d.nums.length >= 2 && hi !== lo;
    const mid = isRange ? (hi + lo) / 2 : lo;
    const y = scaleY(mid);
    return {
      role: d.style.role,
      dash: d.style.dash,
      width: d.style.width,
      isRange,
      isEntry: d.style.isEntry,
      y,
      yTop: scaleY(hi),
      yBot: scaleY(lo),
      labelY: y,
      label: d.label,
      rawValue: d.rawValue,
    };
  });

  // Anti-overlap: sort by y, push labels down to keep MIN_GAP, then keep the
  // block inside the canvas (mirror levels-schema.mjs:111-123).
  const ordered = [...lines].sort((a, b) => a.y - b.y);
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (!prev || !cur) continue;
    if (cur.labelY - prev.labelY < MIN_GAP) cur.labelY = prev.labelY + MIN_GAP;
  }
  // Usable label band [TOP, BOTTOM]. Two cases:
  //  - the stacked block FITS → reframe it within the band (the static behaviour);
  //  - it OVERFLOWS (≈14+ levels: (n−1)·MIN_GAP > USABLE) → the original two
  //    reframes fight (pin the bottom, then pinning the top re-pushes the bottom
  //    past the viewBox), spilling labels outside H. Distribute UNIFORMLY across
  //    the band instead: labels compress below MIN_GAP but never spill, and each
  //    connector still points to its level's true price y.
  const TOP = PAD_T - 6; // 20
  const BOTTOM = H - 14; // 286
  const USABLE = BOTTOM - TOP; // 266
  const n = ordered.length;
  const first = ordered[0];
  const last = ordered[n - 1];
  if (n >= 2 && first && last && last.labelY - first.labelY > USABLE) {
    const gap = USABLE / (n - 1);
    for (let i = 0; i < n; i += 1) {
      const o = ordered[i];
      if (o) o.labelY = TOP + i * gap;
    }
  } else {
    if (last && last.labelY > BOTTOM) {
      const over = last.labelY - BOTTOM;
      for (const o of ordered) o.labelY -= over;
    }
    if (first && first.labelY < TOP) {
      const under = TOP - first.labelY;
      for (const o of ordered) o.labelY += under;
    }
  }

  return {
    width: W,
    height: H,
    labelX: LABEL_X,
    lineX1: LINE_X1,
    lineX2: LINE_X2,
    biasDir: biasDir(bias),
    lines,
  };
}
