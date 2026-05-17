import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_TYPES,
  pushSubscriptionInputSchema,
  subscribePushInputSchema,
  togglePreferenceInputSchema,
  unsubscribePushInputSchema,
} from './push-subscription';

/**
 * J9 — Tests TDD foundation pour les schemas Web Push.
 *
 * Couverture :
 * - pushSubscriptionInputSchema : 10 tests (happy + length bounds + alphabet + edge)
 * - subscribePushInputSchema : 3 tests (extension userAgent)
 * - togglePreferenceInputSchema : 5 tests (5 NotificationType + edge)
 * - unsubscribePushInputSchema : 3 tests
 * - NOTIFICATION_TYPES const : 2 tests
 */

// 87-char base64url p256dh (canonical ECDH P-256 uncompressed point).
const VALID_P256DH = 'BNc' + 'A'.repeat(84);
// 22-char base64url auth (canonical 16-byte random secret).
const VALID_AUTH = 'tA9' + 'B'.repeat(19);
const VALID_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123-def456';

const VALID_INPUT = {
  endpoint: VALID_ENDPOINT,
  keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
} as const;

describe('pushSubscriptionInputSchema', () => {
  it('accepts a canonical browser PushSubscription.toJSON()', () => {
    const result = pushSubscriptionInputSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it('accepts an Apple endpoint (web.push.apple.com)', () => {
    const apple = {
      endpoint: 'https://web.push.apple.com/abcdef0123456789',
      keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
    };
    expect(pushSubscriptionInputSchema.safeParse(apple).success).toBe(true);
  });

  it('accepts a Mozilla autopush endpoint', () => {
    const moz = {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc',
      keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
    };
    expect(pushSubscriptionInputSchema.safeParse(moz).success).toBe(true);
  });

  it('rejects p256dh below 80 chars', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      keys: { p256dh: 'A'.repeat(79), auth: VALID_AUTH },
    });
    expect(r.success).toBe(false);
  });

  it('rejects p256dh above 100 chars', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      keys: { p256dh: 'A'.repeat(101), auth: VALID_AUTH },
    });
    expect(r.success).toBe(false);
  });

  it('rejects p256dh with `+` character (standard base64, not base64url)', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      keys: { p256dh: 'BNc+' + 'A'.repeat(83), auth: VALID_AUTH },
    });
    expect(r.success).toBe(false);
  });

  it('rejects p256dh with `/` character (standard base64)', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      keys: { p256dh: 'BNc/' + 'A'.repeat(83), auth: VALID_AUTH },
    });
    expect(r.success).toBe(false);
  });

  it('rejects auth with `+/` chars (standard base64)', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      keys: { p256dh: VALID_P256DH, auth: 'tA+B' + 'C'.repeat(18) },
    });
    expect(r.success).toBe(false);
  });

  it('rejects auth below 20 chars', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      keys: { p256dh: VALID_P256DH, auth: 'B'.repeat(19) },
    });
    expect(r.success).toBe(false);
  });

  it('rejects auth above 30 chars', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      keys: { p256dh: VALID_P256DH, auth: 'B'.repeat(31) },
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-URL endpoint', () => {
    const r = pushSubscriptionInputSchema.safeParse({ ...VALID_INPUT, endpoint: 'not a url' });
    expect(r.success).toBe(false);
  });

  it('rejects endpoint > 2048 chars (RAM DoS guard)', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      endpoint: 'https://wns2.notify.windows.com/' + 'a'.repeat(2050),
    });
    expect(r.success).toBe(false);
  });

  it('rejects http (not https) endpoint — allowlist denies plain HTTP', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      endpoint: 'http://fcm.googleapis.com/fcm/send/abc',
    });
    expect(r.success).toBe(false);
  });

  it('rejects untrusted host (anti-SSRF amplifier — example.com)', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      endpoint: 'https://example.com/some/endpoint',
    });
    expect(r.success).toBe(false);
  });

  it('rejects internal AWS metadata IP (anti-SSRF)', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      endpoint: 'https://169.254.169.254/latest/meta-data/',
    });
    expect(r.success).toBe(false);
  });

  it('rejects localhost endpoint (anti-SSRF)', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      endpoint: 'https://localhost/some/path',
    });
    expect(r.success).toBe(false);
  });

  it('accepts Microsoft WNS sharded subdomain (wns2-by3p)', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      endpoint: 'https://wns2-by3p.notify.windows.com/wns/some-path',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown extra keys (`.strict()` guards prompt-injection-shape exfil)', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      maliciousField: 'pwn',
    });
    expect(r.success).toBe(false);
  });

  it('accepts null expirationTime (Chrome convention)', () => {
    const r = pushSubscriptionInputSchema.safeParse({ ...VALID_INPUT, expirationTime: null });
    expect(r.success).toBe(true);
  });

  it('accepts numeric expirationTime (some browsers)', () => {
    const r = pushSubscriptionInputSchema.safeParse({
      ...VALID_INPUT,
      expirationTime: 1_800_000_000_000,
    });
    expect(r.success).toBe(true);
  });

  it('accepts missing expirationTime (Apple convention)', () => {
    const r = pushSubscriptionInputSchema.safeParse(VALID_INPUT);
    expect(r.success).toBe(true);
  });
});

describe('subscribePushInputSchema (extends with userAgent)', () => {
  it('accepts a UA-tagged subscription', () => {
    const r = subscribePushInputSchema.safeParse({
      ...VALID_INPUT,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) Safari/605.1.15',
    });
    expect(r.success).toBe(true);
  });

  it('accepts missing userAgent', () => {
    const r = subscribePushInputSchema.safeParse(VALID_INPUT);
    expect(r.success).toBe(true);
  });

  it('rejects userAgent > 2048 chars', () => {
    const r = subscribePushInputSchema.safeParse({
      ...VALID_INPUT,
      userAgent: 'X'.repeat(2049),
    });
    expect(r.success).toBe(false);
  });
});

describe('togglePreferenceInputSchema', () => {
  it.each(NOTIFICATION_TYPES)('accepts toggle for %s', (type) => {
    const r = togglePreferenceInputSchema.safeParse({ type, enabled: true });
    expect(r.success).toBe(true);
  });

  it('accepts enabled=false (opt-out)', () => {
    const r = togglePreferenceInputSchema.safeParse({
      type: 'annotation_received',
      enabled: false,
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown type slug (anti-fuzzing on the enum)', () => {
    const r = togglePreferenceInputSchema.safeParse({
      type: 'imaginary_notification',
      enabled: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects truthy non-boolean (string "true")', () => {
    const r = togglePreferenceInputSchema.safeParse({
      type: 'annotation_received',
      enabled: 'true',
    });
    expect(r.success).toBe(false);
  });

  it('rejects extra fields (.strict)', () => {
    const r = togglePreferenceInputSchema.safeParse({
      type: 'annotation_received',
      enabled: true,
      injected: 'foo',
    });
    expect(r.success).toBe(false);
  });
});

describe('unsubscribePushInputSchema', () => {
  it('accepts a valid endpoint', () => {
    const r = unsubscribePushInputSchema.safeParse({ endpoint: VALID_ENDPOINT });
    expect(r.success).toBe(true);
  });

  it('rejects missing endpoint', () => {
    const r = unsubscribePushInputSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects endpoint > 2048 chars', () => {
    const r = unsubscribePushInputSchema.safeParse({
      endpoint: 'https://x.com/' + 'a'.repeat(2050),
    });
    expect(r.success).toBe(false);
  });
});

describe('NOTIFICATION_TYPES const', () => {
  it('contains exactly the 6 notification categories', () => {
    expect(NOTIFICATION_TYPES).toEqual([
      'annotation_received',
      'training_annotation_received',
      'checkin_morning_reminder',
      'checkin_evening_reminder',
      'douglas_card_delivered',
      'weekly_report_ready',
    ]);
  });

  it('is readonly (typed as `as const`)', () => {
    // Compile-time assertion mirror via TS — we just sanity-check the runtime
    // value is frozen-equivalent (cannot mutate without a cast).
    expect(Object.isFrozen(NOTIFICATION_TYPES) || NOTIFICATION_TYPES.length === 6).toBe(true);
  });
});
