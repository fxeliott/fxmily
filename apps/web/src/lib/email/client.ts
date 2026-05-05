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

  const { data, error } = await resendClient.emails.send({
    from: fromAddress,
    to: [to],
    subject,
    react,
    text,
  });

  if (error) {
    throw new EmailDeliveryError(error.message ?? 'Resend rejected the email', error);
  }

  return { id: data?.id ?? null, delivered: true };
}
