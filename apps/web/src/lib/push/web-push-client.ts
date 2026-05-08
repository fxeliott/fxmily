import 'server-only';

import { env } from '@/lib/env';

/**
 * Web Push client — factory pattern with Mock + Live impls (J9, carbone J8 weekly-report client).
 *
 * Two impls live behind a single `IWebPushClient` interface :
 *   - `MockPushClient` — V1 default. Deterministic, no network, no VAPID
 *     required. Used in tests and as a graceful fallback when VAPID env vars
 *     are missing. Returns `{ delivered: true }` for every send.
 *   - `LiveWebPushClient` — wraps the `web-push` npm lib. Lazy-imports the lib
 *     so vitest unit tests (which don't touch network) don't pay the import
 *     cost. VAPID details are set once at construction.
 *
 * The factory `getWebPushClient()` reads `env.VAPID_*` and picks Live if all
 * three are set, otherwise Mock. `resetWebPushClient()` clears the cached
 * instance for tests.
 *
 * Error classification policy (codified in `dispatcher.ts`) :
 *   - 404 / 410 Gone     → permanent. Delete the subscription row.
 *   - 413 Payload too big → bug — log + drop. Don't retry (would just fail).
 *   - 429 Too Many Reqs   → transient. Retry honoring Retry-After.
 *   - 5xx                 → transient. Exponential backoff.
 *   - timeout / network   → transient. Exponential backoff.
 *
 * NEVER LOG the payload content — RGPD posture (SPEC §16). Only metadata
 * (subscriptionId, statusCode, attempts).
 */

export type SendOptions = {
  /// TTL in seconds. Default 86400 (24h) for annotations, 3600 (1h) for
  /// reminders. Caller decides per category — see `buildPayload` in
  /// `dispatcher.ts`.
  ttl?: number;
  /// `low` (battery-friendly), `normal` (default), or `high` (NEVER for
  /// Fxmily — high is reserved for incoming-call/2FA per RFC 8030 anti-FOMO).
  urgency?: 'very-low' | 'low' | 'normal';
  /// 32-char URL-safe base64 — replaces older messages with the same topic.
  /// E.g. `checkin-2026-05-08` → evening reminder coalesces morning reminder.
  topic?: string;
  /// Network timeout (ms). Default 5000.
  timeout?: number;
};

/// What the dispatcher feeds to `client.send()`. Keys + endpoint match the
/// `PushSubscription` table columns 1:1.
export type DispatchableSubscription = {
  endpoint: string;
  p256dhKey: string;
  authKey: string;
};

export type SendResult =
  | { delivered: true; statusCode: number }
  | {
      delivered: false;
      statusCode: number | null;
      /// Machine-readable taxonomy used by the dispatcher to decide retry vs delete.
      kind:
        | 'gone'
        | 'payload_too_large'
        | 'rate_limited'
        | 'server_error'
        | 'timeout'
        | 'network'
        | 'unknown';
      message: string;
      /// `Retry-After` from the response, in seconds. Only set on 429 typically.
      retryAfterSec?: number;
    };

export interface IWebPushClient {
  send(
    subscription: DispatchableSubscription,
    payload: object,
    options?: SendOptions,
  ): Promise<SendResult>;
}

// ── Mock impl — used in tests + as fallback ────────────────────────────────

export class MockPushClient implements IWebPushClient {
  /** Track how many times `send()` was called — exposed for tests only. */
  public callCount = 0;
  /** Track per-call args — exposed for tests only. */
  public calls: Array<{
    subscription: DispatchableSubscription;
    payload: object;
    options?: SendOptions;
  }> = [];

  send(
    subscription: DispatchableSubscription,
    payload: object,
    options?: SendOptions,
  ): Promise<SendResult> {
    this.callCount += 1;
    this.calls.push({ subscription, payload, ...(options ? { options } : {}) });
    return Promise.resolve({ delivered: true, statusCode: 201 });
  }
}

// ── Live impl — lazy-loads `web-push` ──────────────────────────────────────

export class LiveWebPushClient implements IWebPushClient {
  private initialized = false;

  constructor(
    private readonly subject: string,
    private readonly publicKey: string,
    private readonly privateKey: string,
  ) {}

  private async ensureInitialized(): Promise<typeof import('web-push')> {
    const lib = await import('web-push');
    if (!this.initialized) {
      lib.setVapidDetails(this.subject, this.publicKey, this.privateKey);
      this.initialized = true;
    }
    return lib;
  }

  async send(
    subscription: DispatchableSubscription,
    payload: object,
    options?: SendOptions,
  ): Promise<SendResult> {
    const lib = await this.ensureInitialized();
    try {
      const result = await lib.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey },
        },
        JSON.stringify(payload),
        {
          TTL: options?.ttl ?? 3600,
          urgency: options?.urgency ?? 'normal',
          ...(options?.topic !== undefined ? { topic: options.topic } : {}),
          timeout: options?.timeout ?? 5000,
          contentEncoding: 'aes128gcm',
        },
      );
      return { delivered: true, statusCode: result.statusCode };
    } catch (err) {
      const wpErr = err as {
        statusCode?: number;
        message?: string;
        headers?: Record<string, string>;
      };
      const statusCode = typeof wpErr.statusCode === 'number' ? wpErr.statusCode : null;
      const message = (wpErr.message ?? 'unknown').slice(0, 200);

      // Map status code → kind. The dispatcher uses `kind` to decide retry/delete.
      let kind: Exclude<SendResult, { delivered: true }>['kind'] = 'unknown';
      if (statusCode === 404 || statusCode === 410) kind = 'gone';
      else if (statusCode === 413) kind = 'payload_too_large';
      else if (statusCode === 429) kind = 'rate_limited';
      else if (statusCode !== null && statusCode >= 500) kind = 'server_error';
      else if (statusCode === null) {
        // No status code = network or timeout. Best signal is the error message.
        kind = /timeout|timed out/i.test(message) ? 'timeout' : 'network';
      }

      const retryAfter = wpErr.headers?.['retry-after'];
      const retryAfterSec =
        typeof retryAfter === 'string' && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;

      return {
        delivered: false,
        statusCode,
        kind,
        message,
        ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
      };
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

let cachedClient: IWebPushClient | null = null;

/**
 * Returns the singleton client for this process. Switches to Live if all
 * `VAPID_*` env vars are set, otherwise Mock. Cached for the lifetime of
 * the process; call `resetWebPushClient()` in tests.
 */
export function getWebPushClient(): IWebPushClient {
  if (cachedClient !== null) return cachedClient;
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT) {
    cachedClient = new LiveWebPushClient(
      env.VAPID_SUBJECT,
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    );
  } else {
    cachedClient = new MockPushClient();
  }
  return cachedClient;
}

/** Test-only: clear the cached client. */
export function resetWebPushClient(): void {
  cachedClient = null;
}
