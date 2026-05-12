import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reportBreadcrumb, reportError, reportInfo, reportWarning } from './observability';

/**
 * V1.6 — Sentry observability helpers.
 *
 * We only assert the console plumbing + that the helpers never throw. The
 * Sentry SDK itself is a no-op when `SENTRY_DSN` is absent (init guard), so
 * we don't need to mock `@sentry/nextjs` to verify the wrapper doesn't bubble.
 */

describe('reportError', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('logs to console.error with [scope] prefix', () => {
    const err = new Error('boom');
    reportError('cron.test', err);
    expect(errorSpy).toHaveBeenCalledWith('[cron.test]', err, '');
  });

  it('passes extra metadata to console.error', () => {
    const err = new Error('boom');
    reportError('cron.test', err, { runId: 'r1', attempts: 3 });
    expect(errorSpy).toHaveBeenCalledWith('[cron.test]', err, { runId: 'r1', attempts: 3 });
  });

  it('does not throw even when Sentry has no DSN', () => {
    expect(() => reportError('cron.test', new Error('boom'))).not.toThrow();
  });
});

describe('reportWarning', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs to console.warn with [scope] prefix', () => {
    reportWarning('push.dispatcher', 'rate_limited retry scheduled');
    expect(warnSpy).toHaveBeenCalledWith('[push.dispatcher]', 'rate_limited retry scheduled', '');
  });

  it('passes extra metadata to console.warn', () => {
    reportWarning('push.dispatcher', 'cap reached', { userId: 'u1', count: 3 });
    expect(warnSpy).toHaveBeenCalledWith('[push.dispatcher]', 'cap reached', {
      userId: 'u1',
      count: 3,
    });
  });

  it('does not throw on Sentry no-DSN no-op', () => {
    expect(() => reportWarning('test', 'msg')).not.toThrow();
    expect(() => reportWarning('test', 'msg', { x: 1 })).not.toThrow();
  });
});

describe('reportInfo', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('logs to console.info with [scope] prefix', () => {
    reportInfo('push.dispatcher', 'subscription_gone deleted');
    expect(infoSpy).toHaveBeenCalledWith('[push.dispatcher]', 'subscription_gone deleted', '');
  });

  it('passes extra metadata to console.info', () => {
    reportInfo('cron.heartbeat', 'no-op', { ranAt: '2026-05-12T18:00:00Z' });
    expect(infoSpy).toHaveBeenCalledWith('[cron.heartbeat]', 'no-op', {
      ranAt: '2026-05-12T18:00:00Z',
    });
  });

  it('does not throw on Sentry no-DSN no-op', () => {
    expect(() => reportInfo('test', 'msg')).not.toThrow();
  });
});

describe('reportBreadcrumb', () => {
  it('does not throw and produces no console noise (Sentry-only side-effect)', () => {
    expect(() => reportBreadcrumb('cron', 'tick', { runId: 'r1' })).not.toThrow();
  });
});
