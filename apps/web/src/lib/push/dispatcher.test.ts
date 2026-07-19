import { describe, expect, it } from 'vitest';

import {
  buildPayload,
  classifyError,
  EMAIL_FALLBACK_CAP_PER_24H,
  EMAIL_FALLBACK_SKIP_TYPES,
  isQuietHoursExempt,
  isQuietHoursExpireOnHold,
  nextAttemptDelay,
  QUIET_HOURS_EXEMPT_TYPES,
  QUIET_HOURS_EXPIRE_TYPES,
  quietHoursDisposition,
  shouldSendFallbackEmail,
  shouldSkipFallbackEmailForType,
  TTL_BY_TYPE,
  URGENCY_BY_TYPE,
} from './dispatcher';
import type { SendResult } from './web-push-client';
import { NOTIFICATION_TYPES } from '@/lib/schemas/push-subscription';

/**
 * J9 — Tests TDD pure-functions du dispatcher.
 *
 * Couverture :
 *  - buildPayload (5 NotificationType) : payload Apple declarative + classic
 *  - classifyError : delivered passthrough, gone, payload_too_large, retry, fail
 *  - nextAttemptDelay : exponential 1× / 4× / 16× capped, retryAfter override
 *  - TTL_BY_TYPE / URGENCY_BY_TYPE : config table integrity
 */

describe('buildPayload', () => {
  it('builds Apple declarative envelope (web_push: 8030)', () => {
    const out = buildPayload('annotation_received', 'noti_abc', { tradeId: 'clx0trade1' });
    expect(out.web_push).toBe(8030);
    expect(out.notification.title).toBe('Nouvelle correction reçue');
    expect(out.notification.body).toContain('Eliot');
    expect(out.notification.navigate).toBe('http://localhost:3000/journal/clx0trade1');
    expect(out.notification.lang).toBe('fr-FR');
    expect(out.notification.dir).toBe('ltr');
    expect(out.notification.silent).toBe(false);
    expect(out.notification.tag).toBe('annotation_received');
    expect(out.type).toBe('annotation_received');
    expect(out.id).toBe('noti_abc');
  });

  it('falls back to /journal when tradeId missing', () => {
    const out = buildPayload('annotation_received', 'noti_x', {});
    expect(out.notification.navigate).toBe('http://localhost:3000/journal');
  });

  it('builds checkin morning reminder', () => {
    const out = buildPayload('checkin_morning_reminder', 'r1', null);
    expect(out.notification.title).toContain('matin');
    expect(out.notification.navigate).toMatch(/\/checkin\/morning$/);
  });

  it('builds checkin evening reminder', () => {
    const out = buildPayload('checkin_evening_reminder', 'r2', null);
    expect(out.notification.navigate).toMatch(/\/checkin\/evening$/);
  });

  // Tour 12 (action 2) — the calm streak line stored at enqueue time becomes the
  // push body; absent → the neutral default copy (null-safe, no regression).
  it('uses the stored streak line as the reminder body when present', () => {
    const line = '12 jours d’affilée derrière toi. Ton check-in du soir t’attend.';
    const out = buildPayload('checkin_evening_reminder', 'r3', {
      slot: 'evening',
      date: '2026-05-07',
      streakLine: line,
    });
    expect(out.notification.body).toBe(line);
    expect(out.notification.navigate).toMatch(/\/checkin\/evening$/);
  });

  it('falls back to the neutral reminder body when no streak line is stored', () => {
    const out = buildPayload('checkin_morning_reminder', 'r4', {
      slot: 'morning',
      date: '2026-05-07',
    });
    expect(out.notification.body).toBe('Trois minutes pour poser ton intention du jour.');
  });

  it('builds Mark Douglas card delivery with slug', () => {
    const out = buildPayload('douglas_card_delivered', 'd1', { cardSlug: 'sortir-du-tilt' });
    expect(out.notification.navigate).toMatch(/\/library\/sortir-du-tilt$/);
    expect(out.notification.tag).toBe('douglas_card_delivered');
  });

  it('falls back to /library/inbox for douglas without slug', () => {
    const out = buildPayload('douglas_card_delivered', 'd2', {});
    expect(out.notification.navigate).toMatch(/\/library\/inbox$/);
  });

  it('builds weekly_report_ready with reportId', () => {
    const out = buildPayload('weekly_report_ready', 'w1', { reportId: 'rep_123' });
    expect(out.notification.navigate).toMatch(/\/admin\/reports\/rep_123$/);
  });

  it('builds mindset_check_ready with deep-link /mindset/new (V1.5 §27)', () => {
    const out = buildPayload('mindset_check_ready', 'm1', { weekStart: '2026-05-25' });
    expect(out.notification.title).toBe('Auto-évaluation mindset prête');
    expect(out.notification.body).toContain('QCM hebdo');
    expect(out.notification.navigate).toMatch(/\/mindset\/new$/);
    expect(out.notification.tag).toBe('mindset_check_ready');
    expect(out.type).toBe('mindset_check_ready');
  });

  it('builds verification_gentle_reminder with deep-link /verification (S3 §33)', () => {
    // The « micro-relance avant l'alerte » — without this case, the slug fell
    // through to undefined title/body and `navigate=…undefined` (the orphan bug).
    const out = buildPayload('verification_gentle_reminder', 'v1', {
      discrepancyId: 'disc_abc',
    });
    expect(out.notification.title).toBe('Un point rapide sur ton suivi');
    expect(out.notification.body).toBeTruthy();
    expect(out.notification.navigate).toBe('http://localhost:3000/verification');
    expect(out.notification.tag).toBe('verification_gentle_reminder');
    expect(out.type).toBe('verification_gentle_reminder');
  });

  it('uses calm Mark Douglas copy (no pressure / no trading content) for the gentle reminder', () => {
    const out = buildPayload('verification_gentle_reminder', 'v2', { discrepancyId: 'd' });
    const text = `${out.notification.title} ${out.notification.body}`.toLowerCase();
    // GARDE-FOU §33 — strictly psychological nudge, never anxiety/urgency.
    expect(text).not.toMatch(/urgent|vite|attention|tu rates|obligatoire|dépêche/);
  });

  // Tour 14 — MT5 proof verdict push. Deep-links /verification; the body branches
  // on whether at least one capture was actually read (`analyzedCount`).
  it('builds verification_proof_analyzed with deep-link /verification (Tour 14)', () => {
    const out = buildPayload('verification_proof_analyzed', 'p1', {
      analyzedCount: 1,
      failedCount: 0,
    });
    expect(out.notification.title).toBe('Ton analyse de suivi est prête');
    expect(out.notification.body).toBeTruthy();
    expect(out.notification.navigate).toBe('http://localhost:3000/verification');
    expect(out.notification.tag).toBe('verification_proof_analyzed');
    expect(out.type).toBe('verification_proof_analyzed');
  });

  it('pluralises the proof verdict body when several captures were read', () => {
    const out = buildPayload('verification_proof_analyzed', 'p2', {
      analyzedCount: 3,
      failedCount: 0,
    });
    expect(out.notification.body).toContain('3 de tes captures');
  });

  it('uses the failed-only verdict body when no capture could be read', () => {
    const out = buildPayload('verification_proof_analyzed', 'p3', {
      analyzedCount: 0,
      failedCount: 1,
    });
    expect(out.notification.body).toMatch(/n’a pas pu être lue/);
  });

  it('falls back to the generic verdict body when counts are absent', () => {
    const out = buildPayload('verification_proof_analyzed', 'p4', {});
    expect(out.notification.body).toBeTruthy();
    expect(out.notification.navigate).toBe('http://localhost:3000/verification');
  });

  it('keeps the proof verdict copy calm (anti Black-Hat §33.2)', () => {
    const out = buildPayload('verification_proof_analyzed', 'p5', {
      analyzedCount: 1,
      failedCount: 0,
    });
    const text = `${out.notification.title} ${out.notification.body}`.toLowerCase();
    expect(text).not.toMatch(/urgent|vite|attention|tu rates|obligatoire|dépêche|sanction/);
  });

  it('uses custom appBaseUrl when provided', () => {
    const out = buildPayload(
      'annotation_received',
      'n1',
      { tradeId: 't1' },
      'https://app.fxmilyapp.com',
    );
    expect(out.notification.navigate).toBe('https://app.fxmilyapp.com/journal/t1');
  });

  it('NEVER includes audio fields (preference Eliot no-audio)', () => {
    const out = buildPayload('annotation_received', 'n', { tradeId: 't' });
    // Strict shape: silent=false (no audio cue), no `sound` field, no `vibrate` instruction.
    expect(out.notification).not.toHaveProperty('sound');
    expect(out.notification).not.toHaveProperty('vibrate');
  });

  // ── S3 re-challenge — orphan-slug junction guard ──────────────────────────
  // Drives buildPayload with EVERY registered slug (empty payload = worst case)
  // and asserts a well-formed push for each. The orphan bug
  // (`verification_gentle_reminder` enqueued but absent from buildPayload's
  // switch) produced `title=undefined` + `navigate=…undefined`; this loop fails
  // loudly the day a new slug is added to NOTIFICATION_TYPES without a case.
  it('produces a deliverable payload for EVERY registered slug (no undefined nav/title)', () => {
    for (const slug of NOTIFICATION_TYPES) {
      const out = buildPayload(slug, `id_${slug}`, {});
      expect(out.notification.title, `${slug} title`).toBeTruthy();
      expect(out.notification.body, `${slug} body`).toBeTruthy();
      expect(out.notification.navigate, `${slug} nav present`).toBeTruthy();
      // The exact orphan-bug signature: a literal "undefined" in the URL path.
      expect(out.notification.navigate, `${slug} nav has no undefined`).not.toContain('undefined');
      expect(out.notification.tag, `${slug} tag`).toBe(slug);
      expect(out.type, `${slug} type`).toBe(slug);
    }
  });
});

describe('classifyError', () => {
  it('returns delete_subscription on 410 Gone', () => {
    const r: SendResult = { delivered: false, statusCode: 410, kind: 'gone', message: 'gone' };
    expect(classifyError(r, 1)).toEqual({ action: 'delete_subscription' });
  });

  it('returns delete_subscription on 404', () => {
    const r: SendResult = { delivered: false, statusCode: 404, kind: 'gone', message: '404' };
    expect(classifyError(r, 1)).toEqual({ action: 'delete_subscription' });
  });

  it('returns fail_permanent on 413 Payload Too Large (no retry)', () => {
    const r: SendResult = {
      delivered: false,
      statusCode: 413,
      kind: 'payload_too_large',
      message: 'too big',
    };
    const decision = classifyError(r, 1);
    expect(decision).toEqual({ action: 'fail_permanent', reason: 'payload_too_large_413' });
  });

  it('retries on 5xx within budget', () => {
    const r: SendResult = {
      delivered: false,
      statusCode: 503,
      kind: 'server_error',
      message: 'unavailable',
    };
    const decision = classifyError(r, 1);
    expect(decision.action).toBe('retry');
  });

  it('retries on 429 with Retry-After', () => {
    const r: SendResult = {
      delivered: false,
      statusCode: 429,
      kind: 'rate_limited',
      message: 'rate',
      retryAfterSec: 30,
    };
    const decision = classifyError(r, 1);
    if (decision.action === 'retry') {
      expect(decision.delayMs).toBe(30_000); // honors Retry-After exactly
    } else {
      throw new Error('Expected retry');
    }
  });

  it('retries on timeout', () => {
    const r: SendResult = { delivered: false, statusCode: null, kind: 'timeout', message: 'tmo' };
    expect(classifyError(r, 1).action).toBe('retry');
  });

  it('retries on network errors', () => {
    const r: SendResult = { delivered: false, statusCode: null, kind: 'network', message: 'net' };
    expect(classifyError(r, 1).action).toBe('retry');
  });

  it('fails permanently after 3 attempts on 5xx', () => {
    const r: SendResult = {
      delivered: false,
      statusCode: 502,
      kind: 'server_error',
      message: 'bad gw',
    };
    expect(classifyError(r, 3)).toEqual({
      action: 'fail_permanent',
      reason: 'max_attempts_server_error',
    });
  });

  it('fails permanently after 3 attempts on rate_limited', () => {
    const r: SendResult = {
      delivered: false,
      statusCode: 429,
      kind: 'rate_limited',
      message: 'rate',
    };
    expect(classifyError(r, 3).action).toBe('fail_permanent');
  });

  it('fails permanently on unclassified error within budget', () => {
    const r: SendResult = {
      delivered: false,
      statusCode: 418,
      kind: 'unknown',
      message: 'teapot',
    };
    const decision = classifyError(r, 1);
    expect(decision).toEqual({ action: 'fail_permanent', reason: 'unclassified_unknown' });
  });
});

describe('nextAttemptDelay', () => {
  it('attempt 1 → 1 minute (60_000 ms)', () => {
    expect(nextAttemptDelay(1)).toBe(60_000);
  });

  it('attempt 2 → 4 minutes (240_000 ms)', () => {
    expect(nextAttemptDelay(2)).toBe(240_000);
  });

  it('attempt 3 → 16 minutes (960_000 ms)', () => {
    expect(nextAttemptDelay(3)).toBe(960_000);
  });

  it('caps at 30 minutes (1_800_000 ms) for very high attempts', () => {
    expect(nextAttemptDelay(99)).toBe(1_800_000);
  });

  it('honors retryAfterSec (in seconds → ms)', () => {
    expect(nextAttemptDelay(1, 45)).toBe(45_000);
  });

  it('caps retryAfter at 30 min (anti-hostage)', () => {
    expect(nextAttemptDelay(1, 99_999)).toBe(1_800_000);
  });

  it('ignores 0 retryAfter (treats as no override)', () => {
    expect(nextAttemptDelay(2, 0)).toBe(240_000);
  });

  it('handles attempt 0 gracefully (clamped)', () => {
    expect(nextAttemptDelay(0)).toBe(60_000);
  });
});

describe('TTL_BY_TYPE / URGENCY_BY_TYPE config tables', () => {
  it('TTL covers exactly the 14 NotificationType slugs', () => {
    expect(Object.keys(TTL_BY_TYPE).sort()).toEqual([
      'annotation_received',
      'calendar_ready',
      'checkin_evening_reminder',
      'checkin_morning_reminder',
      'data_export_ready',
      'douglas_card_delivered',
      'mindset_check_ready',
      'monthly_debrief_ready',
      'training_annotation_received',
      'training_reply_received',
      'verification_gentle_reminder',
      'verification_proof_analyzed',
      'weekly_report_ready',
      'weekly_review_reminder',
    ]);
  });

  it('URGENCY covers exactly the same 14 slugs as TTL (no map drift)', () => {
    expect(Object.keys(URGENCY_BY_TYPE).sort()).toEqual(Object.keys(TTL_BY_TYPE).sort());
  });

  it('mindset_check_ready TTL = 24h (weekly cadence, calm V1.5 §27.6)', () => {
    expect(TTL_BY_TYPE.mindset_check_ready).toBe(86_400);
  });

  it('mindset_check_ready URGENCY = low (anti-FOMO §27.6)', () => {
    expect(URGENCY_BY_TYPE.mindset_check_ready).toBe('low');
  });

  it('annotations TTL ≥ 24h (relevance window)', () => {
    expect(TTL_BY_TYPE.annotation_received).toBeGreaterThanOrEqual(86_400);
  });

  it('checkin reminders TTL ≤ 1h (anti-stale)', () => {
    expect(TTL_BY_TYPE.checkin_morning_reminder).toBeLessThanOrEqual(3_600);
    expect(TTL_BY_TYPE.checkin_evening_reminder).toBeLessThanOrEqual(3_600);
  });

  it('NEVER uses high urgency (anti-FOMO Mark Douglas posture)', () => {
    for (const type of Object.keys(URGENCY_BY_TYPE) as Array<keyof typeof URGENCY_BY_TYPE>) {
      expect(URGENCY_BY_TYPE[type]).not.toBe('high');
    }
  });

  it('reminders use `low` urgency (battery-friendly)', () => {
    expect(URGENCY_BY_TYPE.checkin_morning_reminder).toBe('low');
    expect(URGENCY_BY_TYPE.checkin_evening_reminder).toBe('low');
  });

  it('annotations + Douglas use `normal` urgency', () => {
    expect(URGENCY_BY_TYPE.annotation_received).toBe('normal');
    expect(URGENCY_BY_TYPE.douglas_card_delivered).toBe('normal');
  });
});

describe('shouldSendFallbackEmail (V1.6 SPEC §18.2 freq cap)', () => {
  it('returns true for transactional regardless of count (never capped)', () => {
    expect(shouldSendFallbackEmail(true, 0)).toBe(true);
    expect(shouldSendFallbackEmail(true, 3)).toBe(true);
    expect(shouldSendFallbackEmail(true, 100)).toBe(true);
  });

  it('returns true for non-transactional below cap', () => {
    expect(shouldSendFallbackEmail(false, 0)).toBe(true);
    expect(shouldSendFallbackEmail(false, 1)).toBe(true);
    expect(shouldSendFallbackEmail(false, EMAIL_FALLBACK_CAP_PER_24H - 1)).toBe(true);
  });

  it('returns false for non-transactional at or above cap', () => {
    expect(shouldSendFallbackEmail(false, EMAIL_FALLBACK_CAP_PER_24H)).toBe(false);
    expect(shouldSendFallbackEmail(false, EMAIL_FALLBACK_CAP_PER_24H + 1)).toBe(false);
    expect(shouldSendFallbackEmail(false, 99)).toBe(false);
  });

  it('cap is exactly 3 (SPEC §18.2 anti-spam)', () => {
    expect(EMAIL_FALLBACK_CAP_PER_24H).toBe(3);
  });
});

describe('shouldSkipFallbackEmailForType + EMAIL_FALLBACK_SKIP_TYPES (V1.5.1 §27.6 push-only)', () => {
  it('returns true for push-only slugs (mindset anti-FOMO + Session 3 drift alert + gentle reminder)', () => {
    expect(shouldSkipFallbackEmailForType('mindset_check_ready')).toBe(true);
    // Session 3 §28 — drift alert is push-only (near-daily, anti email-fatigue).
    expect(shouldSkipFallbackEmailForType('douglas_card_delivered')).toBe(true);
    // S3 §33 — the gentle reminder is a SINGLE benevolent nudge; escalating it to
    // email would be the harassment the brief forbids. Push-only.
    expect(shouldSkipFallbackEmailForType('verification_gentle_reminder')).toBe(true);
  });

  it('returns false for slugs NOT in the skip allowlist (regression guard)', () => {
    expect(shouldSkipFallbackEmailForType('annotation_received')).toBe(false);
    expect(shouldSkipFallbackEmailForType('training_annotation_received')).toBe(false);
    expect(shouldSkipFallbackEmailForType('checkin_morning_reminder')).toBe(false);
    expect(shouldSkipFallbackEmailForType('checkin_evening_reminder')).toBe(false);
    expect(shouldSkipFallbackEmailForType('weekly_report_ready')).toBe(false);
    expect(shouldSkipFallbackEmailForType('monthly_debrief_ready')).toBe(false);
  });

  it('EMAIL_FALLBACK_SKIP_TYPES contains exactly the documented push-only slugs', () => {
    expect(EMAIL_FALLBACK_SKIP_TYPES.has('mindset_check_ready')).toBe(true);
    // Session 3 §28 — drift alert joined as the 2nd push-only slug.
    expect(EMAIL_FALLBACK_SKIP_TYPES.has('douglas_card_delivered')).toBe(true);
    // S3 §33 — the gentle reminder is the 3rd push-only slug (no email harassment).
    expect(EMAIL_FALLBACK_SKIP_TYPES.has('verification_gentle_reminder')).toBe(true);
    expect(EMAIL_FALLBACK_SKIP_TYPES.size).toBe(3);
  });
});

describe('quiet-hours classification (Tour 15 — [22:00, 08:00) member-local silence)', () => {
  // Anchor instants: 03:00 and 12:00 local in Europe/Paris (May = CEST, UTC+2).
  const NIGHT_PARIS = new Date('2026-05-07T01:00:00Z'); // 03:00 Paris
  const NOON_PARIS = new Date('2026-05-06T10:00:00Z'); // 12:00 Paris

  describe('isQuietHoursExempt / QUIET_HOURS_EXEMPT_TYPES', () => {
    it('exempts the four one-to-one / response / operational slugs', () => {
      // Eliott's personal corrections — a direct message, not a scheduled nudge.
      expect(isQuietHoursExempt('annotation_received')).toBe(true);
      expect(isQuietHoursExempt('training_annotation_received')).toBe(true);
      // The MT5-proof verdict answers a proof the member JUST uploaded (the
      // brief's canonical night-pass case).
      expect(isQuietHoursExempt('verification_proof_analyzed')).toBe(true);
      // Admin-facing loop-close signal for the single operator.
      expect(isQuietHoursExempt('training_reply_received')).toBe(true);
    });

    it('does NOT exempt the deferred / expired slugs', () => {
      expect(isQuietHoursExempt('checkin_morning_reminder')).toBe(false);
      expect(isQuietHoursExempt('checkin_evening_reminder')).toBe(false);
      expect(isQuietHoursExempt('douglas_card_delivered')).toBe(false);
      expect(isQuietHoursExempt('weekly_report_ready')).toBe(false);
      expect(isQuietHoursExempt('monthly_debrief_ready')).toBe(false);
      expect(isQuietHoursExempt('mindset_check_ready')).toBe(false);
      expect(isQuietHoursExempt('verification_gentle_reminder')).toBe(false);
    });

    it('QUIET_HOURS_EXEMPT_TYPES contains exactly the four documented slugs', () => {
      expect(QUIET_HOURS_EXEMPT_TYPES.size).toBe(4);
      expect([...QUIET_HOURS_EXEMPT_TYPES].sort()).toEqual([
        'annotation_received',
        'training_annotation_received',
        'training_reply_received',
        'verification_proof_analyzed',
      ]);
    });
  });

  describe('isQuietHoursExpireOnHold / QUIET_HOURS_EXPIRE_TYPES (P1 fix — dated reminders)', () => {
    it('marks the two dated check-in reminders as expire-on-hold', () => {
      expect(isQuietHoursExpireOnHold('checkin_morning_reminder')).toBe(true);
      expect(isQuietHoursExpireOnHold('checkin_evening_reminder')).toBe(true);
    });

    it('does NOT mark undated / exempt slugs as expire-on-hold', () => {
      expect(isQuietHoursExpireOnHold('douglas_card_delivered')).toBe(false);
      expect(isQuietHoursExpireOnHold('weekly_report_ready')).toBe(false);
      expect(isQuietHoursExpireOnHold('mindset_check_ready')).toBe(false);
      expect(isQuietHoursExpireOnHold('verification_gentle_reminder')).toBe(false);
      expect(isQuietHoursExpireOnHold('verification_proof_analyzed')).toBe(false);
    });

    it('QUIET_HOURS_EXPIRE_TYPES contains exactly the two dated reminders', () => {
      expect(QUIET_HOURS_EXPIRE_TYPES.size).toBe(2);
      expect([...QUIET_HOURS_EXPIRE_TYPES].sort()).toEqual([
        'checkin_evening_reminder',
        'checkin_morning_reminder',
      ]);
    });
  });

  describe('quietHoursDisposition', () => {
    it('defers an undated nudge that lands at 03:00 local → next local 08:00', () => {
      const d = quietHoursDisposition('weekly_report_ready', 'Europe/Paris', NIGHT_PARIS);
      expect(d.action).toBe('defer');
      if (d.action === 'defer') {
        // 08:00 Paris (CEST) = 06:00 UTC, same local day (2026-05-07).
        expect(d.nextAttemptAt.toISOString()).toBe('2026-05-07T06:00:00.000Z');
      }
    });

    it('EXPIRES a dated check-in reminder caught by quiet hours (P1 fix — never deferred)', () => {
      // The exact P1 scenario: an evening reminder at 03:00 local must be DROPPED,
      // not held to 08:00 where it would deliver yesterday's prompt.
      expect(
        quietHoursDisposition('checkin_evening_reminder', 'Europe/Paris', NIGHT_PARIS),
      ).toEqual({ action: 'expire' });
      expect(
        quietHoursDisposition('checkin_morning_reminder', 'Europe/Paris', NIGHT_PARIS),
      ).toEqual({ action: 'expire' });
    });

    it('sends an undated nudge during the day (outside the window)', () => {
      expect(quietHoursDisposition('weekly_report_ready', 'Europe/Paris', NOON_PARIS)).toEqual({
        action: 'send',
      });
    });

    it('sends a dated reminder during the day (expire only applies inside the window)', () => {
      expect(quietHoursDisposition('checkin_evening_reminder', 'Europe/Paris', NOON_PARIS)).toEqual(
        {
          action: 'send',
        },
      );
    });

    it('sends an EXEMPT slug even at 03:00 local (transactional passes)', () => {
      // The MT5 verdict fires the instant it is ready, night or not.
      expect(
        quietHoursDisposition('verification_proof_analyzed', 'Europe/Paris', NIGHT_PARIS),
      ).toEqual({ action: 'send' });
      expect(quietHoursDisposition('annotation_received', 'Europe/Paris', NIGHT_PARIS)).toEqual({
        action: 'send',
      });
    });

    it('defers an undated nudge at 03:00 local in Pacific/Auckland (multi-tz)', () => {
      // 03:00 Auckland (NZST UTC+12) = 15:00 UTC prev day → 08:00 Auckland = 20:00 UTC.
      const d = quietHoursDisposition(
        'weekly_report_ready',
        'Pacific/Auckland',
        new Date('2026-05-05T15:00:00Z'),
      );
      expect(d.action).toBe('defer');
      if (d.action === 'defer') {
        expect(d.nextAttemptAt.toISOString()).toBe('2026-05-05T20:00:00.000Z');
      }
    });

    it('sends exactly at 08:00 local (window end is exclusive)', () => {
      // 08:00 Paris (CEST) = 06:00 UTC.
      expect(
        quietHoursDisposition(
          'weekly_report_ready',
          'Europe/Paris',
          new Date('2026-05-06T06:00:00Z'),
        ),
      ).toEqual({ action: 'send' });
    });

    it('defers exactly at 22:00 local (window start is inclusive)', () => {
      // 22:00 Paris (CEST) = 20:00 UTC.
      const d = quietHoursDisposition(
        'douglas_card_delivered',
        'Europe/Paris',
        new Date('2026-05-06T20:00:00Z'),
      );
      expect(d.action).toBe('defer');
      if (d.action === 'defer') {
        // Held to the next day's 08:00 local = 06:00 UTC on the 7th.
        expect(d.nextAttemptAt.toISOString()).toBe('2026-05-07T06:00:00.000Z');
      }
    });

    it('expires a dated reminder exactly at 22:00 local (start inclusive, expire wins over defer)', () => {
      expect(
        quietHoursDisposition(
          'checkin_evening_reminder',
          'Europe/Paris',
          new Date('2026-05-06T20:00:00Z'),
        ),
      ).toEqual({ action: 'expire' });
    });

    it('falls back to a safe timezone rather than throwing on an invalid tz', () => {
      // safeTimeZone is applied in the dispatcher; the pure decision uses the raw
      // helper which collapses an invalid tz to UTC. 03:00 UTC → inside the window.
      const d = quietHoursDisposition(
        'weekly_report_ready',
        'Not/AZone',
        new Date('2026-05-06T03:00:00Z'),
      );
      expect(d.action).toBe('defer');
    });
  });

  // P2-B — exhaustiveness guard. Every registered slug MUST be classified into
  // exactly ONE of the three quiet-hours buckets (exempt ∪ expire ∪ defer), on
  // the model of the TTL/URGENCY parity tests. Without this, a slug added to
  // NOTIFICATION_TYPES tomorrow would silently inherit the `defer` fallback in
  // `quietHoursDisposition` — the very trap the P1 fix closed for check-ins.
  describe('exhaustive quiet-hours classification (no silent inheritance)', () => {
    it('classifies every NOTIFICATION_TYPES slug into exactly one bucket', () => {
      for (const slug of NOTIFICATION_TYPES) {
        const exempt = isQuietHoursExempt(slug);
        const expire = isQuietHoursExpireOnHold(slug);
        // The two explicit sets must be disjoint; anything in neither is a
        // deliberate "defer" (the safe undated-nudge default).
        expect(
          Number(exempt) + Number(expire),
          `${slug} in ≤1 explicit bucket`,
        ).toBeLessThanOrEqual(1);

        // Prove the disposition matches the bucket at a fixed night instant so a
        // future slug can't be added without an author consciously placing it.
        const disposition = quietHoursDisposition(slug, 'Europe/Paris', NIGHT_PARIS);
        if (exempt) {
          expect(disposition.action, `${slug} exempt → send`).toBe('send');
        } else if (expire) {
          expect(disposition.action, `${slug} dated → expire`).toBe('expire');
        } else {
          expect(disposition.action, `${slug} undated → defer`).toBe('defer');
        }
      }
    });

    it('the three buckets partition all 14 slugs (exempt + expire + defer = total)', () => {
      const exemptCount = NOTIFICATION_TYPES.filter((s) => isQuietHoursExempt(s)).length;
      const expireCount = NOTIFICATION_TYPES.filter((s) => isQuietHoursExpireOnHold(s)).length;
      const deferCount = NOTIFICATION_TYPES.filter(
        (s) => !isQuietHoursExempt(s) && !isQuietHoursExpireOnHold(s),
      ).length;
      expect(exemptCount + expireCount + deferCount).toBe(NOTIFICATION_TYPES.length);
      // Pin the current split so a reclassification is a conscious test edit.
      expect(exemptCount).toBe(4);
      expect(expireCount).toBe(2);
      expect(deferCount).toBe(8);
    });
  });
});
