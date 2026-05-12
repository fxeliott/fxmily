import { describe, expect, it } from 'vitest';

import {
  buildPayload,
  classifyError,
  EMAIL_FALLBACK_CAP_PER_24H,
  nextAttemptDelay,
  shouldSendFallbackEmail,
  TTL_BY_TYPE,
  URGENCY_BY_TYPE,
} from './dispatcher';
import type { SendResult } from './web-push-client';

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
  it('TTL covers exactly the 5 NotificationType slugs', () => {
    expect(Object.keys(TTL_BY_TYPE).sort()).toEqual([
      'annotation_received',
      'checkin_evening_reminder',
      'checkin_morning_reminder',
      'douglas_card_delivered',
      'weekly_report_ready',
    ]);
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
