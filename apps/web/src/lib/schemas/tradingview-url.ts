import { z } from 'zod';

import { containsBidiOrZeroWidth } from '@/lib/text/safe';

/**
 * Shared TradingView-link validation (J1 — pivot capture → lien).
 *
 * Single source of truth for every surface that accepts a member-pasted
 * TradingView screenshot link: the real journal (entry + exit), the training
 * backtest journal, and any future analysis-link field. Extracted verbatim
 * from the F1 inline validator (`training-trade.ts`) so the hardening logic
 * lives in ONE place and the journal + training surfaces can never drift.
 *
 * This is the app's only user-supplied URL rendered as a clickable `<a>` to
 * an admin, so it is hardened at the Zod edge exactly like the
 * `push-subscription` `endpointSchema`:
 *   - length cap (btree-index + RAM-DoS guard),
 *   - reject Trojan-Source bidi / zero-width (a hidden homograph could spoof
 *     the host to a human reviewer),
 *   - HTTPS-only + hostname allowlisted to `tradingview.com` via `new URL()`
 *     in a try/catch (a thrown parse error becomes a clean FIELD error, never
 *     a 500). This blocks `javascript:` / `data:` schemes (stored-XSS via
 *     href) and any off-host link (open-redirect / phishing / SSRF surface).
 */

/** Hard upper bound on a TradingView link. ~2 048 chars is far above any real
 *  `/x/` snapshot or `/chart/` layout URL; protects the index + guards a RAM
 *  DoS. Mirrors the `push-subscription` endpoint cap. */
export const TRADINGVIEW_URL_MAX = 2048;

/** TradingView hosts allowlist — anchored, case-insensitive, accepting any
 *  sub-domain prefix (`www.`, `fr.`, `in.`, …) of `tradingview.com`. The host
 *  is the security-relevant part (an off-host link rendered as a clickable
 *  `<a>` to the admin would be an open-redirect / phishing / SSRF amplifier).
 *  Hosts confirmed against tradingview.com (snapshot `/x/`, layout `/chart/`,
 *  regional sub-domains). */
export const TRADINGVIEW_HOST_REGEX = /^([a-z0-9-]+\.)*tradingview\.com$/i;

/** Returns true iff `url` parses, is HTTPS, and its hostname is on the
 *  tradingview.com allowlist. A thrown `new URL()` parse error → false (the
 *  caller turns it into a clean field error, never a 500). */
export function isTradingViewUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return TRADINGVIEW_HOST_REGEX.test(u.hostname);
  } catch {
    return false;
  }
}

const TRADINGVIEW_URL_MESSAGE = 'Lien TradingView uniquement (https://www.tradingview.com/…).';

/** REQUIRED TradingView link (J1). The member must paste a valid link — this
 *  REPLACES the former mandatory screenshot upload on the real journal (entry
 *  + exit) and the training backtest. `.min(1)` first so an empty submit
 *  surfaces "obligatoire" rather than the generic host message. */
export const tradingViewUrlRequiredSchema = z
  .string()
  .trim()
  .min(1, 'Le lien TradingView est obligatoire.')
  .max(TRADINGVIEW_URL_MAX, `Maximum ${TRADINGVIEW_URL_MAX} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .refine(isTradingViewUrl, TRADINGVIEW_URL_MESSAGE);

/** OPTIONAL TradingView link — kept for any surface that wants the link beside
 *  another mandatory artefact (the original F1 semantics). `.nullable()
 *  .optional()` short-circuits an absent/empty value before the string checks
 *  run; the consumer is expected to send the field GUARDED (omit when empty). */
export const tradingViewUrlOptionalSchema = z
  .string()
  .trim()
  .max(TRADINGVIEW_URL_MAX, `Maximum ${TRADINGVIEW_URL_MAX} caractères.`)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .refine(isTradingViewUrl, TRADINGVIEW_URL_MESSAGE)
  .nullable()
  .optional();
