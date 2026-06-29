import 'server-only';

import { Resend } from 'resend';
import type { ReactElement } from 'react';

import { env } from '@/lib/env';

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
        `📧  [dev fallback] no RESEND_API_KEY set — email NOT sent`,
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
