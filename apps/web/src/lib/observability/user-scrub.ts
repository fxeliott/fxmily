/**
 * Shared user-id pseudonymizer for Sentry `beforeSend`.
 *
 * Session W Voie A2 — Sentry dashboards currently group events by raw
 * `event.user.id` (the member's cuid 25-char). RGPD §16 + SPEC §16 demand PII
 * minimisation : even though cuid is not a direct identifier, paired with
 * other Sentry tags (URL, breadcrumb) it lets Sentry SaaS staff re-identify
 * a member's session trail.
 *
 * Pseudonymisation policy : SHA-256 hex first 16 chars (= 64-bit space,
 * birthday collision 50% threshold ≈ 77 163 members per
 * `pseudonymizeMember` V1.5 reference). Preserves the Sentry "events grouped
 * by user" feature while breaking the raw-cuid leak. NFC-normalize input
 * before hashing (defense against UTF-8 NFC/NFD splits — no-op for cuid
 * alphanum-only V1, robust if future callers pass Apple Health UID / ULID).
 *
 * Pure functions, isomorphic Edge-compat (Web Crypto API `crypto.subtle`
 * natif Node 22 LTS + tous les browsers cibles). No `server-only` import —
 * safe to load in client + server + edge bundles.
 *
 * Pattern carbone `url-scrub.ts` (V1.11 Phase 2) shared module symmetric
 * across the 3 Sentry runtime configs.
 *
 * Migration note : SHA-256 first 16 chars (64-bit space) is sufficient V1
 * cohort 30 members and through V2 launch (~77k members threshold). V3 :
 * widen to `.slice(0, 24)` (96-bit space ≈ 5G members threshold) if Sentry
 * remains the chosen telemetry sink.
 */

const HASH_HEX_LENGTH = 16;

/**
 * Hash a userId to a stable 16-char hex pseudonym. Async because Web Crypto
 * `crypto.subtle.digest` returns a Promise (Sentry `beforeSend` accepts an
 * async return per official SDK contract).
 *
 * Returns `null` on empty/whitespace input — defensive guard for Sentry
 * `beforeSend` callsites which may receive `event.user.id` as undefined when
 * the SDK couldn't attach a session.
 */
export async function hashUserId(id: string | undefined | null): Promise<string | null> {
  if (typeof id !== 'string' || id.trim().length === 0) return null;
  const normalised = id.normalize('NFC');
  const data = new TextEncoder().encode(normalised);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, HASH_HEX_LENGTH);
}
