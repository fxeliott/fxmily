// Track-record formatters.
// All public chiffres exclusively en % — JAMAIS en €/$/CFD nominal value
// (cf. brief Eliot 2026-05-21 + risque AMF promesse de gain).

const FR_PCT = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FR_PCT_SIGNED = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  signDisplay: 'always',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FR_NUMBER_2 = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FR_NUMBER_1 = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Render `1.5` as "1,5 %". Input is a percentage VALUE (not fraction). */
export function formatPercent(pct: number, opts?: { signed?: boolean }): string {
  const fraction = pct / 100;
  return (opts?.signed ? FR_PCT_SIGNED : FR_PCT).format(fraction);
}

/** Render `1.5` as "+1,5R" / "−1,0R" (typographic minus). */
export function formatR(r: number): string {
  const sign = r > 0 ? '+' : r < 0 ? '−' : '';
  const abs = Math.abs(r);
  return `${sign}${FR_NUMBER_1.format(abs)}R`;
}

/** Render a count "1 234". */
export function formatCount(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(n);
}

/** Render a profit factor like "2,34". Infinity → "∞". */
export function formatRatio(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  return FR_NUMBER_2.format(n);
}

/** Render a winrate fraction 0..1 as "68,4 %". */
export function formatWinrate(fraction: number): string {
  return FR_PCT.format(fraction);
}

/** ISO 8601 absolute date "2026-01-20" — pas de "il y a 3 jours". */
export function formatDateIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** French long date "lundi 20 janvier 2026". */
export function formatDateLong(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}
