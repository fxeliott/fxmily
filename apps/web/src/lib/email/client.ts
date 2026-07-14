import 'server-only';

import { Resend } from 'resend';
import type { ReactElement } from 'react';

import { env } from '@/lib/env';
import { reportWarning } from '@/lib/observability';
import { isEmailSuppressed } from '@/lib/email/suppression';
import {
  RESEND_DAILY_ALERT_THRESHOLD,
  RESEND_DAILY_CAP,
  reserveDailySend,
} from '@/lib/email/send-counter';

/**
 * Resend wrapper with a dev-friendly fallback.
 *
 * In production we require `RESEND_API_KEY` and `RESEND_FROM`. In development
 * (or anywhere they are unset) the wrapper degrades to a structured `console`
 * log so the local invitation flow stays clickable: the magic URL goes through
 * the `text` body, which we mirror to the terminal.
 */

const resendClient = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const DEFAULT_FROM = 'Fxmily <onboarding@resend.dev>';
const fromAddress = env.RESEND_FROM ?? DEFAULT_FROM;

export interface SendEmailParams {
  to: string;
  subject: string;
  react: ReactElement;
  /** Plain-text fallback for non-HTML clients and for the dev-mode log. */
  text: string;
}

export class EmailDeliveryError extends Error {
  readonly providerError: unknown;
  constructor(message: string, providerError: unknown) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.providerError = providerError;
  }
}

export async function sendEmail({
  to,
  subject,
  react,
  text,
}: SendEmailParams): Promise<{ id: string | null; delivered: boolean }> {
  if (!resendClient) {
    // Dev fallback. We deliberately log the plain-text body so links are
    // clickable from the terminal.
    if (env.NODE_ENV === 'production') {
      throw new EmailDeliveryError('RESEND_API_KEY is required in production', null);
    }
    console.log(
      [
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `📧  [dev fallback] no RESEND_API_KEY set : email NOT sent`,
        `    To:      ${to}`,
        `    Subject: ${subject}`,
        '',
        text,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
      ].join('\n'),
    );
    return { id: null, delivered: false };
  }

  // J2 — public-surface guards before hitting Resend. Repo is public : Sentry
  // extras carry the event name + counters only, never the address or subject.
  try {
    if (await isEmailSuppressed(to)) {
      // Hard bounce / complaint already on file : never re-send (protects the
      // shared sending reputation). No quota consumed.
      reportWarning('email.send', 'suppressed recipient skipped', {
        reason: 'suppressed',
      });
      return { id: null, delivered: false };
    }
  } catch (error) {
    // Fail-open : a suppression-store outage must not block transactional mail.
    reportWarning('email.send', 'suppression check failed (fail-open)', {
      error: error instanceof Error ? error.name : 'unknown',
    });
  }

  try {
    const reservation = await reserveDailySend();
    if (reservation.capped) {
      // Daily Resend budget exhausted : refuse cleanly (piège J2 — refus propre
      // + log à 100 %). Callers treat a non-delivered result as soft.
      reportWarning('email.send', 'daily send cap reached', {
        cap: RESEND_DAILY_CAP,
      });
      return { id: null, delivered: false };
    }
    if (reservation.count === RESEND_DAILY_ALERT_THRESHOLD) {
      reportWarning('email.send', 'daily send cap 80% reached', {
        count: reservation.count,
        cap: RESEND_DAILY_CAP,
      });
    }
  } catch (error) {
    // Fail-open : if the counter store is unreachable we still attempt delivery
    // rather than silently dropping mail.
    reportWarning('email.send', 'send counter failed (fail-open)', {
      error: error instanceof Error ? error.name : 'unknown',
    });
  }

  // Bound the outbound Resend call with a Promise.race timeout. The SDK (v6.x)
  // exposes no type-safe per-request `signal`/`timeout`, and Node's `fetch`
  // applies no overall-request deadline — so a stalled-but-open connection would
  // otherwise hang this await, and (via the push dispatcher's awaited fallback
  // leg) stall a cron run toward its 600s ceiling. On timeout we reject with the
  // same EmailDeliveryError every best-effort caller already catches, so a hung
  // gateway degrades to the existing Sentry-warning path (audit RES-3).
  const SEND_TIMEOUT_MS = 10_000;

  const sendPromise = resendClient.emails.send({
    from: fromAddress,
    to: [to],
    subject,
    react,
    text,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new EmailDeliveryError(`Resend send timed out after ${SEND_TIMEOUT_MS}ms`, null)),
      SEND_TIMEOUT_MS,
    );
  });

  let result: Awaited<typeof sendPromise>;
  try {
    result = await Promise.race([sendPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  const { data, error } = result;
  if (error) {
    throw new EmailDeliveryError(error.message ?? 'Resend rejected the email', error);
  }

  return { id: data?.id ?? null, delivered: true };
}
