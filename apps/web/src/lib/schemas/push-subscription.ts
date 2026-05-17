import { z } from 'zod';

/**
 * Zod schemas for the J9 Web Push subscription flow.
 *
 * Three concerns live here:
 * 1. `pushSubscriptionInputSchema` validates what the browser hands us via
 *    `PushSubscription.toJSON()` (the canonical Web Push API shape) — endpoint
 *    URL, ECDH P-256 public key (`p256dh`), and 16-byte random auth secret.
 * 2. `subscribePushInputSchema` extends (1) with the optional `userAgent`
 *    captured at subscribe time (for admin debug only).
 * 3. `togglePreferenceInputSchema` validates the per-category preference toggle.
 *
 * Why strict regex on the keys (vs just `z.string().min(20)`):
 * - p256dh is exactly **65 raw bytes** (uncompressed ECDH point) → 87 chars
 *   base64url without padding. We allow [80, 100] for tolerance across browsers
 *   that may include or omit padding (Apple sometimes emits 88-char with `=`,
 *   we strip it client-side before submit but accept either at the schema edge).
 * - auth is exactly **16 raw bytes** → 22 chars base64url no-pad. Tolerance
 *   [20, 30] covers padded variants and base64-vs-base64url edge cases.
 * - Both alphabets are URL-safe base64 (RFC 4648 §5): A-Z a-z 0-9 - _.
 *   We deliberately reject standard base64 (`+/`) because the Web Push spec
 *   mandates URL-safe — and accepting both would let mismatched keys through.
 *
 * RFC references:
 * - [RFC 8030 — Generic Event Delivery Using HTTP Push](https://www.rfc-editor.org/rfc/rfc8030)
 * - [RFC 8291 — Message Encryption for Web Push](https://www.rfc-editor.org/rfc/rfc8291)
 * - [RFC 8292 — VAPID](https://datatracker.ietf.org/doc/html/rfc8292)
 */

/// Browser-emitted ECDH P-256 public key. Base64url, no `+/` allowed.
const p256dhKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'p256dh must be base64url (no `+/`)')
  .min(80, 'p256dh too short (expected ~87 chars base64url for P-256)')
  .max(100, 'p256dh too long');

/// Browser-emitted 16-byte random auth secret. Base64url, no `+/` allowed.
const authKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'auth must be base64url (no `+/`)')
  .min(20, 'auth too short (expected ~22 chars base64url for 16 random bytes)')
  .max(30, 'auth too long');

/// Allowed push service hostnames (anti-SSRF amplifier). Restricts the
/// `endpoint` URL to the canonical push providers a real browser will produce.
/// Without this allowlist, a malicious client could subscribe with
/// `endpoint: 'http://169.254.169.254/...'` (AWS metadata) or
/// `endpoint: 'http://localhost:6379/'` and amplify dispatcher cost into
/// internal services. Each pattern matches the host with optional arbitrary
/// subdomain prefixes — push services use sharded subdomains
/// (e.g. `wns2-by3p.notify.windows.com`, `updates.push.services.mozilla.com`,
/// `web.push.apple.com`, `fcm.googleapis.com`).
const ALLOWED_PUSH_HOSTS_REGEX =
  /^([a-z0-9-]+\.)*(?:googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/i;

/// Push service endpoint URL. Three layers of defense:
/// 1. Valid URL (Zod `.url()`).
/// 2. Length cap 2048 (RAM DoS guard + btree index safety).
/// 3. Allowlist of trusted push service hostnames + HTTPS-only (spec mandate).
const endpointSchema = z
  .string()
  .url('endpoint must be a valid URL')
  .max(2048, 'endpoint too long (max 2048 chars)')
  .refine((url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return false;
      return ALLOWED_PUSH_HOSTS_REGEX.test(u.hostname);
    } catch {
      return false;
    }
  }, 'endpoint must come from a trusted push service (FCM, APNs, Mozilla, Microsoft)');

/// What the browser passes us via `subscription.toJSON()`. Spec-canonical shape.
export const pushSubscriptionInputSchema = z
  .object({
    endpoint: endpointSchema,
    keys: z
      .object({
        p256dh: p256dhKeySchema,
        auth: authKeySchema,
      })
      .strict(),
    /// `expirationTime` is part of the spec but unreliable across browsers
    /// (Apple omits it entirely). We accept null/undefined/number but never
    /// store it — callers who care can read it from the raw JSON.
    expirationTime: z.number().nullable().optional(),
  })
  .strict();
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;

/// Server Action input — the Zod-validated subscription + the captured UA.
/// `userAgent` is truncated server-side (DB column accepts arbitrary length but
/// we cap at 512 to avoid noisy logs and indexable PII bloat).
export const subscribePushInputSchema = pushSubscriptionInputSchema.extend({
  userAgent: z.string().max(2048).optional(),
});
export type SubscribePushInput = z.infer<typeof subscribePushInputSchema>;

/// The 6 notification categories a member can toggle. Mirrors the
/// `NotificationType` enum in `prisma/schema.prisma`. `training_annotation_
/// received` (J-T3) is DISTINCT from `annotation_received` on purpose: a
/// backtest correction must never conflate with a real-trade correction
/// (statistical isolation §21.5).
export const NOTIFICATION_TYPES = [
  'annotation_received',
  'training_annotation_received',
  'checkin_morning_reminder',
  'checkin_evening_reminder',
  'douglas_card_delivered',
  'weekly_report_ready',
] as const;
export type NotificationTypeSlug = (typeof NOTIFICATION_TYPES)[number];

/// Toggle a preference. `enabled = true` means the member opts IN (or accepts
/// the default-on). `enabled = false` means opt OUT — the dispatcher must skip.
export const togglePreferenceInputSchema = z
  .object({
    type: z.enum(NOTIFICATION_TYPES),
    enabled: z.boolean(),
  })
  .strict();
export type TogglePreferenceInput = z.infer<typeof togglePreferenceInputSchema>;

/// Used by the unsubscribe Server Action — only the endpoint is required since
/// `(userId, endpoint)` is unique on the subscriptions table. The auth check
/// happens upstream in the action (session.user.id must match the row's userId).
export const unsubscribePushInputSchema = z
  .object({
    endpoint: endpointSchema,
  })
  .strict();
export type UnsubscribePushInput = z.infer<typeof unsubscribePushInputSchema>;
