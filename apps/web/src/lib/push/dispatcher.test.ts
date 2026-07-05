import { describe, expect, it } from 'vitest';

import {
  buildPayload,
  classifyError,
  EMAIL_FALLBACK_CAP_PER_24H,
  EMAIL_FALLBACK_SKIP_TYPES,
  nextAttemptDelay,
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
  it('TTL covers exactly the 11 NotificationType slugs', () => {
    expect(Object.keys(TTL_BY_TYPE).sort()).toEqual([
      'annotation_received',
      'checkin_evening_reminder',
      'checkin_morning_reminder',
      'douglas_card_delivered',
      'mindset_check_ready',
      'monthly_debrief_ready',
      'training_annotation_received',
      'training_reply_received',
      'verification_gentle_reminder',
      'verification_proof_analyzed',
      'weekly_report_ready',
    ]);
  });

  it('URGENCY covers exactly the same 11 slugs as TTL (no map drift)', () => {
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
