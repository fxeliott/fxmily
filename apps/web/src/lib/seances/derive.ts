/**
 * Pure derivations for the réunion hub (séances) — NO `server-only`, NO DB.
 *
 * Ported from the static generator's `helpers.mjs` (D:/Projects/reunion-trading-hub)
 * so the Fxmily re-platform keeps byte-for-byte the same labels, slot vocabulary
 * and FR date formatting. Kept dependency-free + deterministic so it is unit-
 * testable without a database (mirror `lib/meeting/occurrence.ts`, which avoids
 * `server-only` on purpose for the same reason).
 *
 * Posture §2 / Règle n°1: these helpers only QUALIFY what Eliott said (a slot, a
 * normalised bias label) — never a live recommendation emitted by the app.
 */
import { formatLocalDate } from '@/lib/checkin/timezone';

export type SeanceSlot = 'analyse' | 'debrief';
export type SeanceStatus = 'scheduled' | 'done' | 'cancelled';
export type SeanceBias = 'haussier' | 'baissier' | 'neutre';

/** Default FR display time per slot (mirror the static hub DEFAULT_TIMES). */
const SLOT_DEFAULT_TIME: Record<SeanceSlot, string> = {
  analyse: '12h00',
  debrief: '20h00',
};

export interface SlotMeta {
  label: string;
  long: string;
  /**
   * CSS custom property carrying the slot accent, used for the DECORATIVE rail
   * (a background, no contrast floor). analyse = `--acc` (Fxmily brand blue),
   * debrief = `--acc-2` (indigo) — the static hub's brand/violet distinction,
   * mapped onto existing DS-v3 tokens (never cyan §21.7, both vars defined in
   * light + dark).
   */
  accentVar: 'var(--acc)' | 'var(--acc-2)';
  /**
   * Slot accent for TEXT (eyebrow). MUST stay ≥4.5:1 in both themes, so debrief
   * uses `--acc-2-hi` (not `--acc-2`): the saturated `--acc-2` indigo is only
   * 3.98:1 as text on `--bg-1` in dark — below AA — whereas `--acc-2-hi`
   * (the DS's "text-accent-2" variant) computes 6.27:1 dark / higher in light.
   * analyse keeps `--acc` (5.46:1 dark, 4.6:1 light). Verified by OKLCH→WCAG calc.
   */
  accentText: 'var(--acc)' | 'var(--acc-2-hi)';
}

/** Slot → display metadata (mirror `slotMeta` helpers.mjs:46-51). */
export function slotMeta(slot: SeanceSlot): SlotMeta {
  if (slot === 'analyse') {
    return {
      label: 'Analyse',
      long: 'Analyse de séance',
      accentVar: 'var(--acc)',
      accentText: 'var(--acc)',
    };
  }
  return {
    label: 'Débrief',
    long: 'Bilan / débrief de séance',
    accentVar: 'var(--acc-2)',
    accentText: 'var(--acc-2-hi)',
  };
}

export interface BiasMeta {
  /** Fxmily semantic tone: haussier→ok (gain/long), baissier→bad (perte/short). */
  tone: 'ok' | 'bad' | 'mute';
  label: string;
  /** Non-chromatic direction cue (WCAG 1.4.1 — never colour alone). */
  dir: 'up' | 'down' | 'flat';
}

/**
 * Normalised bias → display metadata (mirror `biasMeta` helpers.mjs:95-104).
 * The DB only ever holds the 3 canonical values (the pipeline normalises
 * long/bull→haussier, short/bear→baissier at ingest), but we keep the tolerant
 * mapping so a future vocabulary drift degrades to `neutre`, never throws.
 */
export function biasMeta(bias: string | null | undefined): BiasMeta {
  const b = (bias ?? '').toLowerCase();
  if (b === 'haussier' || b === 'long' || b === 'bull') {
    return { tone: 'ok', label: 'Haussier', dir: 'up' };
  }
  if (b === 'baissier' || b === 'short' || b === 'bear') {
    return { tone: 'bad', label: 'Baissier', dir: 'down' };
  }
  return { tone: 'mute', label: 'Neutre', dir: 'flat' };
}

/**
 * FR display title fallback derived from date+slot when `title` is null
 * (mirror the pipeline-derived "Analyse du 29 juin"). `formatLocalDate` renders
 * "lundi 29 juin 2026" at UTC — we take the `d month` slice for a compact title.
 */
export function deriveSeanceTitle(localDate: string, slot: SeanceSlot): string {
  const full = formatLocalDate(localDate); // e.g. "lundi 29 juin 2026"
  const parts = full.split(' ');
  // ["lundi","29","juin","2026"] → "29 juin" (drop weekday + year for the title)
  const dayMonth = parts.length >= 3 ? `${parts[1]} ${parts[2]}` : full;
  return `${slotMeta(slot).long} du ${dayMonth}`;
}

/** FR display time fallback per slot when `time` is null. */
export function deriveSeanceTime(slot: SeanceSlot): string {
  return SLOT_DEFAULT_TIME[slot];
}

/**
 * Build the Vimeo privacy embed URL (mirror `vimeoEmbedUrl` helpers.mjs:81-92).
 * Returns null when there is no id (→ "replay indisponible" degraded state).
 * `dnt=1` (RGPD do-not-track), chrome stripped (title/byline/portrait=0).
 */
export function buildVimeoEmbedUrl(
  vimeoId: string | null,
  vimeoHash: string | null,
  precomputed: string | null,
): string | null {
  // A precomputed URL is only trusted if it resolves to the official Vimeo
  // player over https — never injected verbatim into the iframe `src`. A
  // malformed / off-host / `javascript:` / `data:` value falls through to the
  // id-based construction below (or null). Defence-in-depth alongside the CSP
  // `frame-src https://player.vimeo.com` allowlist.
  if (precomputed) {
    try {
      const u = new URL(precomputed);
      if (u.protocol === 'https:' && u.hostname === 'player.vimeo.com') return precomputed;
    } catch {
      // malformed URL → ignore, fall through to id-based construction
    }
  }
  // Id-based construction interpolates `vimeoId` RAW into the URL path, so it is
  // only trusted when it matches Vimeo's own shape — digits only. A malformed id
  // (path/query/`#`/scheme chars from a future pipeline bug) degrades to the
  // "replay indisponible" state instead of building a surprising player URL.
  // The hash is set via `URLSearchParams` (already encoded) but is likewise
  // dropped unless alphanumeric. Symmetric to the precomputed branch above +
  // the CSP `frame-src https://player.vimeo.com` allowlist (defence-in-depth).
  if (!vimeoId || !/^[0-9]+$/.test(vimeoId)) return null;
  const params = new URLSearchParams({
    dnt: '1',
    title: '0',
    byline: '0',
    portrait: '0',
    transparent: '0',
    playsinline: '1',
  });
  if (vimeoHash && /^[A-Za-z0-9]+$/.test(vimeoHash)) params.set('h', vimeoHash);
  return `https://player.vimeo.com/video/${vimeoId}?${params.toString()}`;
}

/**
 * Sanitise a free-form symbol into a safe id fragment (`[A-Za-z0-9_-]` only).
 * Shared by the HTML anchor id and the SVG `aria-labelledby` ids so a symbol
 * containing a space (e.g. "SP 500" from a future pipeline) can never split the
 * id-list and break the ladder's accessible name.
 */
export function symbolSlug(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9_-]/g, '') || 'x';
}

/** Sanitise a symbol into a stable HTML anchor id (mirror `anchorId` session.mjs:14-18). */
export function assetAnchorId(symbol: string): string {
  return `actif-${symbolSlug(symbol)}`;
}

/** Human "X actif(s)" with correct pluralisation. */
export function assetCountLabel(count: number): string {
  return `${count} actif${count > 1 ? 's' : ''}`;
}

/** Seconds → "X min" (<60min) or "X h MM" / "X h" (mirror `fmtDuration` session.mjs:20-27). */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} h ${`${m}`.padStart(2, '0')}` : `${h} h`;
}
