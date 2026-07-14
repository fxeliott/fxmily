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
///
/// Google is pinned to `fcm.googleapis.com` (the ONLY Google host that serves
/// Web Push) rather than the broad `googleapis.com`: the wide form let any
/// `*.googleapis.com` (storage., compute., …) through as a push endpoint,
/// needlessly widening the SSRF-amplifier surface. Chrome's modern endpoint is
/// `https://fcm.googleapis.com/...`; legacy `android.googleapis.com` GCM was
/// removed in 2019, so nothing real regresses.
const ALLOWED_PUSH_HOSTS_REGEX =
  /^([a-z0-9-]+\.)*(?:fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/i;

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

/// The 13 notification categories. Mirrors the
/// `NotificationType` enum in `prisma/schema.prisma` 1:1 — the parity is
/// enforced by a unit test (`push-subscription.test.ts`) so a value added to
/// the Prisma enum but NOT registered here FAILS the suite. This kills the
/// drift class that had let `verification_gentle_reminder` (S3 §33) ship as a
/// Prisma enum value with NO dispatcher wiring (absent here → absent from
/// `buildPayload`/TTL/URGENCY/preferences → an undeliverable push). `training_
/// annotation_received` (J-T3) is DISTINCT from `annotation_received` on
/// purpose: a backtest correction must never conflate with a real-trade
/// correction (statistical isolation §21.5). `monthly_debrief_ready` (V1.4 §25)
/// is the member-facing monthly AI synthesis push (distinct from the admin-only
/// `weekly_report_ready`). `mindset_check_ready` (V1.5 §27) is the weekly
/// gentle nudge for the 12-item QCM athlète mindset wizard, calm anti-FOMO
/// (no email, no fanfare — §27.4/§27.6). `verification_gentle_reminder` (S3 §33)
/// is the single benevolent nudge on an isolated unexcused gap BEFORE any
/// repetition alert — push-only, calm, strictly psychological (Mark Douglas),
/// never a trading advice. `training_reply_received` (S8 V2 §32-4) is the
/// ADMIN-facing counterpart of `training_annotation_received`: it fires for the
/// correction's author when the MEMBER replies to it, so the coaching loop
/// closes without the admin polling each backtest. Admin-only (hidden from the
/// member preferences grid, like `weekly_report_ready`). §21.5: ids only, never
/// the reply text nor any backtest P&L. `weekly_review_reminder` (J2) is the
/// Sunday-morning nudge to complete the week's review if it hasn't been done
/// yet — calm, informative, respects the member's opt-out like every other
/// reminder. `calendar_ready` (J2) fires when the member's weekly calendar is
/// published, so they know it's ready to open — distinct from
/// `weekly_report_ready` (admin-only digest) and `monthly_debrief_ready`
/// (member's monthly synthesis).
export const NOTIFICATION_TYPES = [
  'annotation_received',
  'training_annotation_received',
  'checkin_morning_reminder',
  'checkin_evening_reminder',
  'douglas_card_delivered',
  'weekly_report_ready',
  'monthly_debrief_ready',
  'mindset_check_ready',
  'verification_gentle_reminder',
  // Tour 14 — member-facing verdict push when an uploaded MT5 proof reaches a
  // terminal state (done/failed) in the vision batch. Mirror monthly_debrief_ready,
  // one push per member per run, PII-free (counts only).
  'verification_proof_analyzed',
  'training_reply_received',
  // J2 — Sunday-morning nudge to complete the weekly review if not yet done.
  // Deep-link /review, calm and non-urgent.
  'weekly_review_reminder',
  // J2 — fires when the member's weekly adaptive calendar is published.
  // Deep-link /calendrier, calm and non-urgent.
  'calendar_ready',
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
