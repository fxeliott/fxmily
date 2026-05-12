import 'server-only';

import * as Sentry from '@sentry/nextjs';

/**
 * J10 — single entry-point for "something went wrong server-side, tell
 * everyone who needs to know".
 *
 * Three responsibilities :
 *   - log to stderr with a `[scope]` prefix (the existing convention used
 *     across `lib/scoring`, `lib/cards`, `lib/weekly-report`, `lib/push`),
 *     so `journalctl -u fxmily` on Hetzner stays readable without Sentry ;
 *   - forward to Sentry with a `scope` tag and structured extras so we can
 *     filter the dashboard by subsystem ;
 *   - swallow internal failures (Sentry captures are best-effort — a
 *     network glitch in the SDK must NEVER bubble up and double-fault a
 *     cron job).
 *
 * Sentry itself is a no-op when `SENTRY_DSN` is absent (the SDK guards on
 * init). So this helper is safe to call from any code path.
 */
export function reportError(scope: string, err: unknown, extra?: Record<string, unknown>): void {
  console.error(`[${scope}]`, err, extra ?? '');
  try {
    Sentry.captureException(err, {
      tags: { scope },
      ...(extra ? { extra } : {}),
    });
  } catch {
    // Last-line defence : Sentry SDK should never bubble an error.
  }
}

/**
 * V1.6 — Sentry taxonomy distinct from `reportError`.
 *
 * Use `reportWarning` for known-transient or retryable conditions that don't
 * indicate a code bug but deserve operator visibility :
 *   - push 429 rate-limited (the dispatcher will retry, but a sustained burst
 *     means we should look at our enqueue cadence) ;
 *   - email fallback frequency cap reached (member is dropping push events) ;
 *   - cron heartbeat ran but found nothing to do (only sampled, not every run).
 *
 * Use `reportInfo` for expected lifecycle events that don't need an alert :
 *   - push 410 Gone subscription deletion (browser unsubscribed, normal) ;
 *   - cron heartbeat success.
 *
 * Why `captureMessage(msg, { level })` instead of `captureException` :
 *   - we have a string we want to track, not an Error instance ;
 *   - Sentry groups by message+level so warnings never pollute the error
 *     dashboard (which is the primary on-call surface for cron failures) ;
 *   - both still pass `tags.scope` so existing dashboard filters keep working.
 *
 * No-op when `SENTRY_DSN` is absent (Sentry SDK init guard). Best-effort —
 * a Sentry hiccup must NEVER bubble up and double-fault a cron.
 */
export function reportWarning(
  scope: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  console.warn(`[${scope}]`, message, extra ?? '');
  try {
    Sentry.captureMessage(message, {
      level: 'warning',
      tags: { scope },
      ...(extra ? { extra } : {}),
    });
  } catch {
    /* swallow */
  }
}

export function reportInfo(scope: string, message: string, extra?: Record<string, unknown>): void {
  console.info(`[${scope}]`, message, extra ?? '');
  try {
    Sentry.captureMessage(message, {
      level: 'info',
      tags: { scope },
      ...(extra ? { extra } : {}),
    });
  } catch {
    /* swallow */
  }
}

/**
 * Drop a structured breadcrumb (no event captured). Useful for tracing a
 * cron run's intermediate state into Sentry's "before this error" panel
 * without burning a separate event quota.
 */
export function reportBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  try {
    Sentry.addBreadcrumb({
      category,
      message,
      level: 'info',
      ...(data ? { data } : {}),
    });
  } catch {
    /* swallow */
  }
}

/**
 * J10 Phase J — performance-profiler T3.6 fix : flush the Sentry queue
 * before a one-shot worker (cron) returns, so events queued by
 * `reportError` are not lost when the request handler exits.
 *
 * `Sentry.flush(timeoutMs)` returns true when the queue drained, false on
 * timeout. Best-effort : we never throw here so a Sentry hiccup can't
 * mask the actual cron result.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    /* swallow — Sentry must never be the reason a cron looks broken. */
  }
}
