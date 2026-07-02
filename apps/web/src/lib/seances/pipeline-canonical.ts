/**
 * Réunion hub (séances) J4 — Règle n°1 re-validation at the Fxmily ingest
 * boundary. PURE, dependency-free, NO `server-only`, NO DB (exhaustively
 * unit-testable, mirror `levels-schema.ts` / `derive.ts`).
 *
 * Faithful port of the standalone hub's `generate-content.mjs` editorial gate
 * (`CANONICAL_ASSETS`, `OUTPUT_BIAS`, `EMOJI_RE`/`hasEmoji`, `AI_ATTRIBUTION_RE`,
 * `assembleContent`). The standalone produces the content with TWO nets
 * (`assembleContent` + the JSON-schema `validate`); when the content crosses the
 * wire into Fxmily it is UNTRUSTED again (the local pipeline machine is a
 * distinct compromise blast radius), so we re-run the SAME semantic gate here —
 * a defence-in-depth carbon of the verification batch's server-side double net.
 *
 * The cardinal invariant (Règle n°1, supreme): the asset/message IDENTITIES
 * (`symbol`/`name`/`macro`) are INJECTED from this canon, NEVER trusted from the
 * payload. The local side only ever provides `bias`/`levels`/`reading`/`text` —
 * so even a fully-compromised pipeline machine can neither invent an asset, drop
 * one, reorder them, nor relabel DXY as a non-macro pivot.
 *
 * Typography belt (F-J1): every editorial TEXT field the pipeline produced is
 * AI output persisted then shown to members, so it passes through
 * `normalizeAiTypography` here (the ingest boundary = the persist boundary for
 * séance content) — em/en dashes never reach `/seances`. Deterministic and
 * idempotent; the symbol/name/macro IDENTITIES are canonical (never text), so
 * they are untouched.
 */

import { normalizeAiTypography } from '@/lib/text/normalize-typography';

/** One canonical followed asset (display order; identity is authoritative). */
export interface CanonicalAsset {
  readonly symbol: string;
  readonly name: string;
  readonly macro: boolean;
}

/**
 * The 6 followed assets, in DISPLAY ORDER (5 assets + DXY macro pivot in 6th —
 * contract S03/S04). `symbol`/`name`/`macro` are CANONICAL: the AI only ever
 * fills `bias`/`levels`/`reading` per symbol. Every asset card (and every
 * message) is rebuilt from this list → order guaranteed, DXY always 6th, never a
 * missing/extra asset, never a fabricated identity. Byte-for-byte the standalone
 * `generate-content.mjs:CANONICAL_ASSETS`.
 */
export const CANONICAL_ASSETS: readonly CanonicalAsset[] = Object.freeze([
  { symbol: 'EURUSD', name: 'Euro / Dollar', macro: false },
  { symbol: 'XAUUSD', name: 'Or', macro: false },
  { symbol: 'NQ', name: 'Nasdaq 100', macro: false },
  { symbol: 'SP500', name: 'S&P 500', macro: false },
  { symbol: 'GBPUSD', name: 'Livre / Dollar', macro: false },
  { symbol: 'DXY', name: 'Indice dollar', macro: true }, // pivot macro, 6e message
]);

/** Canonical symbols in display order (the AI output enum). */
export const CANONICAL_SYMBOLS: readonly string[] = CANONICAL_ASSETS.map((a) => a.symbol);

/** Bias values the AI may emit — the 3 unambiguous canonical values. */
export const OUTPUT_BIAS = Object.freeze(['haussier', 'baissier', 'neutre'] as const);
export type OutputBias = (typeof OUTPUT_BIAS)[number];

// ── Editorial hard constraints (mechanically verified, Règle n°1) ─────────────

/**
 * Emoji forbidden (cahier). We test Unicode pictographs AFTER stripping the
 * benign letter-like symbols (c)(R)(TM)(i) — technically Extended_Pictographic
 * but allowed. Sober glyphs (→ ↑ ↓ ·) are NOT Extended_Pictographic. FULL
 * COVERAGE: `\p{Extended_Pictographic}` alone MISSES composed emojis — regional
 * indicator flags (U+1F1E6–U+1F1FF) and keycaps (U+20E3) — so we add them
 * explicitly for "0 emoji" to be a real mechanical guarantee, not a leaky one.
 * Byte-for-byte the standalone `EMOJI_RE`.
 */
export const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}\u{20E3}]|\p{Extended_Pictographic}/u;

export function hasEmoji(text: string): boolean {
  return EMOJI_RE.test(String(text).replace(/[©®™ℹ︎️]/g, ''));
}

/**
 * AI self-attribution forbidden (cahier: "never mention the page was made by
 * Claude"). Targets ONLY the published-artefact SIGNATURE: a document-subject
 * ("ce contenu / cette page / cette analyse / ...") followed (short span, no
 * sentence break) by a production VERB ("généré / rédigé / réalisé / ...") then
 * an AI AGENT. This anchored shape avoids the false positive of rejecting a
 * faithful TOPICAL mention (e.g. "j'utilise un assistant IA" describing the
 * trader's own process) — by Règle n°1 a reported remark is CONTENT to preserve,
 * not a signature to ban. Byte-for-byte the standalone `AI_ATTRIBUTION_RE`.
 */
export const AI_ATTRIBUTION_RE =
  /\b(ce|cet|cette|ces|l[ae]|les|l['’])\s+(contenu|page|analyse|r[ée]sum[ée]|synth[èe]se|message|texte|document|rapport|note|compte[\s-]?rendu|d[ée]brief)\b[^.\n!?]{0,40}?\b(g[ée]n[ée]r[ée]|r[ée]dig[ée]|r[ée]alis[ée]|[ée]crit|produit|cr[ée][ée]|propuls[ée])e?s?\s+(par|avec|gr[âa]ce\s+[àa])\s+(une?\s+|le\s+|du\s+|l['’]\s*)?(i\.?a\.?\b|intelligence\s+artificielle|claude|chatgpt|gpt|un\s+assistant|cet?\s+assistant|l['’]?\s*assistant|un\s+mod[èe]le|le\s+mod[èe]le)/i;

export function hasAiAttribution(text: string): boolean {
  return AI_ATTRIBUTION_RE.test(text);
}

// ── Untrusted wire shapes (what the local pipeline pushes; identities ignored) ─

export interface PipelineLevel {
  readonly label: string;
  readonly value: string;
}

/** One asset entry as the local pipeline pushes it (identity is NOT trusted). */
export interface PipelineAssetInput {
  readonly symbol: string;
  readonly bias: string;
  // `| undefined` is explicit so a Zod-inferred payload (optional() → `T |
  // undefined`) assigns cleanly under `exactOptionalPropertyTypes`.
  readonly levels?: readonly PipelineLevel[] | undefined;
  readonly reading?: readonly string[] | undefined;
}

export interface PipelineMessageInput {
  readonly asset: string;
  readonly text: string;
}

export interface PipelineContentInput {
  readonly summary?: string;
  readonly keyTakeaways?: readonly string[];
  readonly assets?: readonly PipelineAssetInput[];
  readonly messages?: readonly PipelineMessageInput[];
}

// ── Assembled (trusted) shapes — identities injected from canon ───────────────

export interface AssembledAsset {
  readonly symbol: string;
  readonly name: string;
  readonly macro: boolean;
  readonly bias: OutputBias;
  readonly levels: PipelineLevel[];
  readonly reading: string[];
}

export interface AssembledMessage {
  readonly asset: string;
  readonly text: string;
}

export interface AssembledContent {
  readonly summary: string;
  readonly keyTakeaways: string[];
  readonly assets: AssembledAsset[];
  readonly messages: AssembledMessage[];
}

export interface AssembleResult {
  readonly ok: boolean;
  readonly errors: string[];
  readonly content: AssembledContent;
}

/**
 * Re-assemble the CANONICAL content from an untrusted pipeline payload: for each
 * `CANONICAL_ASSETS` entry (guaranteed order), inject `name`/`macro` from canon
 * and take `bias`/`levels`/`reading` the pipeline produced for THAT symbol; same
 * for the 6 messages. Verifies cardinality (6 assets + 6 messages), the
 * non-emptiness of required fields, and the editorial hard constraints (emoji,
 * AI self-attribution). Returns `{ok, errors, content}`.
 *
 * Faithful port of the standalone `generate-content.mjs:assembleContent` — the
 * SAME error strings + the SAME `ok` predicate (errors empty AND exactly 6
 * assets AND exactly 6 messages), so a payload that passed the local gate passes
 * here too, and a forged one is rejected identically.
 */
export function assembleSeanceContent(
  input: PipelineContentInput | null | undefined,
): AssembleResult {
  const errors: string[] = [];

  const assetIn = new Map<string, PipelineAssetInput>();
  for (const a of Array.isArray(input?.assets) ? input!.assets : []) {
    if (a && typeof a.symbol === 'string' && !assetIn.has(a.symbol)) assetIn.set(a.symbol, a);
  }
  const msgIn = new Map<string, PipelineMessageInput>();
  for (const m of Array.isArray(input?.messages) ? input!.messages : []) {
    if (m && typeof m.asset === 'string' && !msgIn.has(m.asset)) msgIn.set(m.asset, m);
  }

  const assets: AssembledAsset[] = [];
  const messages: AssembledMessage[] = [];
  for (const canon of CANONICAL_ASSETS) {
    const a = assetIn.get(canon.symbol);
    if (!a) {
      errors.push(`actif manquant: ${canon.symbol}`);
    } else {
      const reading = (Array.isArray(a.reading) ? a.reading : [])
        .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
        .map((p) => normalizeAiTypography(p.trim()));
      if (!reading.length) errors.push(`lecture (reading) vide: ${canon.symbol}`);
      if (!OUTPUT_BIAS.includes(a.bias as OutputBias)) {
        errors.push(`biais invalide (${a.bias}): ${canon.symbol}`);
      }
      const levels = (Array.isArray(a.levels) ? a.levels : [])
        .filter(
          (l): l is PipelineLevel =>
            !!l &&
            typeof l.label === 'string' &&
            l.label.trim() !== '' &&
            typeof l.value === 'string' &&
            l.value.trim() !== '',
        )
        .map((l) => ({
          label: normalizeAiTypography(l.label.trim()),
          value: normalizeAiTypography(l.value.trim()),
        }));
      assets.push({
        symbol: canon.symbol,
        name: canon.name,
        macro: canon.macro,
        bias: a.bias as OutputBias,
        levels,
        reading,
      });
    }

    const m = msgIn.get(canon.symbol);
    if (!m || typeof m.text !== 'string' || m.text.trim() === '') {
      errors.push(`message manquant ou vide: ${canon.symbol}`);
    } else {
      messages.push({ asset: canon.symbol, text: normalizeAiTypography(m.text.trim()) });
    }
  }

  const summary =
    typeof input?.summary === 'string' ? normalizeAiTypography(input.summary.trim()) : '';
  if (!summary) errors.push('summary manquant');

  // Key takeaways OPTIONAL (a thin session may have none → never invent, never
  // reject). Filter empties + trim, nothing else (truncating/dropping a long
  // point would mutilate faithful content → Règle n°1 violation).
  const keyTakeaways = (Array.isArray(input?.keyTakeaways) ? input!.keyTakeaways : [])
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => normalizeAiTypography(p.trim()));

  // Editorial hard constraints, over ALL published text (incl. the A-Z points).
  const allText = [
    summary,
    ...keyTakeaways,
    ...assets.flatMap((a) => [...a.reading, ...a.levels.map((l) => `${l.label} ${l.value}`)]),
    ...messages.map((m) => m.text),
  ].join('\n');
  if (hasEmoji(allText)) errors.push('emoji detecte (interdit)');
  if (hasAiAttribution(allText)) errors.push('auto-attribution a une IA detectee (interdit)');

  const ok =
    errors.length === 0 &&
    assets.length === CANONICAL_ASSETS.length &&
    messages.length === CANONICAL_ASSETS.length;

  return { ok, errors, content: { summary, keyTakeaways, assets, messages } };
}
