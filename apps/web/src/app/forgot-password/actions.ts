'use server';

import { headers } from 'next/headers';
import { after } from 'next/server';

import { logAudit } from '@/lib/auth/audit';
import { createPasswordResetToken } from '@/lib/auth/password-reset';
import { db } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/email/send';
import { reportWarning } from '@/lib/observability';
import {
  callerIdTrusted,
  passwordResetEmailLimiter,
  passwordResetIpLimiter,
} from '@/lib/rate-limit/token-bucket';
import { forgotPasswordSchema } from '@/lib/schemas/auth';

export interface ForgotPasswordActionState {
  /** `sent` = neutral success (shown WHETHER OR NOT the email exists). */
  status: 'idle' | 'sent' | 'rate_limited' | 'invalid';
  retryAfterSec?: number;
  fieldErrors?: { email?: string };
}

/**
 * "Mot de passe oublié" request (SPEC §7.1). UNAUTHENTICATED.
 *
 * Anti-enumeration is the core security property — and TIMING is part of it.
 * The response is byte-identical whether or not an account exists, AND it is
 * returned in constant time: ALL existence-dependent work (DB lookup + token
 * mint + Resend round-trip + audit) is deferred off the response path via
 * `after()`. Without this, the active-account branch would `await` a ~hundreds-
 * of-ms email send while the unknown/inactive branch does almost nothing,
 * leaking which addresses are real through latency. This mirrors the sibling
 * `app/rejoindre/actions.ts` (same invariant, same fix). We therefore:
 *   - consume BOTH rate-limit buckets BEFORE anything else (so a rate-limit
 *     never leaks existence, and a flood can't reach the DB);
 *   - return the SAME neutral `sent` state immediately;
 *   - in the deferred task, only mint a token + send an email for an ACTIVE
 *     user, and on email-send failure delete the dangling token.
 */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordActionState | null,
  formData: FormData,
): Promise<ForgotPasswordActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return {
      status: 'invalid',
      fieldErrors: { email: parsed.error.issues[0]?.message ?? 'Email invalide.' },
    };
  }
  const email = parsed.data.email;

  const reqHeaders = await headers();
  const ip = callerIdTrusted({ headers: reqHeaders });
  const userAgent = reqHeaders.get('user-agent');
  const emailDecision = passwordResetEmailLimiter.consume(email);
  const ipDecision = passwordResetIpLimiter.consume(ip);
  if (!emailDecision.allowed || !ipDecision.allowed) {
    const retryAfterMs = Math.max(emailDecision.retryAfterMs, ipDecision.retryAfterMs);
    after(() =>
      logAudit({
        action: 'auth.password_reset.rate_limited',
        ip,
        userAgent,
        metadata: {
          kind:
            !emailDecision.allowed && !ipDecision.allowed
              ? 'both'
              : !emailDecision.allowed
                ? 'email'
                : 'ip',
          retryAfterMs,
        },
      }).catch(() => undefined),
    );
    return { status: 'rate_limited', retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }

  // Deferred (post-response) — see the constant-time rationale above. A throw
  // anywhere in here can never reach the (already-sent) client; it degrades to
  // a Sentry warning.
  after(async () => {
    try {
      // Only ACTIVE members are ever sent a reset link (a suspended/deleted
      // member must not regain access via reset).
      const user = await db.user.findUnique({
        where: { email },
        select: { id: true, status: true, firstName: true },
      });

      if (user && user.status === 'active') {
        try {
          const { plainToken, expiresAt } = await createPasswordResetToken(user.id);
          await sendPasswordResetEmail({
            to: email,
            plainToken,
            firstName: user.firstName,
            expiresAt,
          });
          // Audit WITH userId (a real link left the building). PII-free: id only.
          await logAudit({
            action: 'auth.password_reset.requested',
            userId: user.id,
            ip,
            userAgent,
          }).catch(() => undefined);
        } catch (err) {
          // Token minted but email failed → remove the dangling token so a
          // leaked link can't be reused, then degrade to a Sentry warning.
          await db.passwordResetToken
            .deleteMany({ where: { userId: user.id } })
            .catch((rollbackErr) =>
              reportWarning('password_reset.request', 'rollback_failed', {
                error: rollbackErr instanceof Error ? rollbackErr.message.slice(0, 200) : 'unknown',
              }),
            );
          reportWarning('password_reset.request', 'email_delivery_failed', {
            error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
          });
        }
      } else {
        // Unknown / inactive email: audit WITHOUT userId (anti-enumeration — the
        // operator sees a request happened, never which non-account was probed).
        await logAudit({
          action: 'auth.password_reset.requested',
          ip,
          userAgent,
          metadata: { matched: false },
        }).catch(() => undefined);
      }
    } catch (err) {
      reportWarning('password_reset.request', 'deferred_task_failed', {
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
    }
  });

  return { status: 'sent' };
}
