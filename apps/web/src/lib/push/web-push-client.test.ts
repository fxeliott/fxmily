import { afterEach, describe, expect, it } from 'vitest';

import { MockPushClient, getWebPushClient, resetWebPushClient } from './web-push-client';

/**
 * J9 — Tests TDD pour MockPushClient + factory `getWebPushClient`.
 * No live network. The Live impl is tested indirectly via the smoke-test-j9
 * script (real `web-push.sendNotification` against a Postgres-seeded
 * subscription).
 */

afterEach(() => {
  resetWebPushClient();
});

describe('MockPushClient', () => {
  it('returns delivered=true with statusCode 201', async () => {
    const client = new MockPushClient();
    const result = await client.send(
      { endpoint: 'https://fcm.googleapis.com/x', p256dhKey: 'p', authKey: 'a' },
      { web_push: 8030, notification: { title: 't', body: 'b', navigate: '/' } },
    );
    expect(result.delivered).toBe(true);
    if (result.delivered) {
      expect(result.statusCode).toBe(201);
    }
  });

  it('tracks call count + args (test-only state)', async () => {
    const client = new MockPushClient();
    expect(client.callCount).toBe(0);
    expect(client.calls).toEqual([]);

    await client.send(
      { endpoint: 'https://x.com/1', p256dhKey: 'p', authKey: 'a' },
      { kind: 'test' },
      { ttl: 100, urgency: 'low' },
    );

    expect(client.callCount).toBe(1);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.subscription.endpoint).toBe('https://x.com/1');
    expect(client.calls[0]?.options).toEqual({ ttl: 100, urgency: 'low' });
  });

  it('supports concurrent sends (independent calls)', async () => {
    const client = new MockPushClient();
    const sub = { endpoint: 'https://x.com/y', p256dhKey: 'p', authKey: 'a' };
    const results = await Promise.all([
      client.send(sub, { id: 1 }),
      client.send(sub, { id: 2 }),
      client.send(sub, { id: 3 }),
    ]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.delivered === true)).toBe(true);
    expect(client.callCount).toBe(3);
  });
});

describe('getWebPushClient factory', () => {
  it('returns the SAME instance across calls (singleton)', () => {
    const a = getWebPushClient();
    const b = getWebPushClient();
    expect(a).toBe(b);
  });

  it('returns a Mock when VAPID env is absent (vitest stubs absent)', () => {
    // vitest setup doesn't stub VAPID_*, so the factory falls back to Mock.
    const c = getWebPushClient();
    expect(c).toBeInstanceOf(MockPushClient);
  });

  it('resetWebPushClient() clears the cache', () => {
    const a = getWebPushClient();
    resetWebPushClient();
    const b = getWebPushClient();
    expect(a).not.toBe(b);
  });
});
