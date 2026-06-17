'use server';

import { headers } from 'next/headers';
import { after } from 'next/server';

import { countPendingAccessRequests, createAccessRequest } from '@/lib/access-request/service';
import { logAudit } from '@/lib/auth/audit';
import { sendAccessRequestReceivedAlertEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import { reportWarning } from '@/lib/observability';
import { accessRequestIpLimiter, callerIdTrusted } from '@/lib/rate-limit/token-bucket';
import { accessRequestSchema } from '@/lib/schemas/auth';

/**
 * Public self-service access request (V2.5 — `/rejoindre` front door).
 *
 * NO AUTH: this Server Action is the unauthenticated front door. Because the
 * rate-limit bucket is consumed PRE-AUTH, the caller IP MUST be derived with
 * `callerIdTrusted` (last-entry XFF from Caddy — non-spoofable), NOT `callerId`
 * (first-entry, client-controlled). See the `callerIdTrusted` warning in
 * `lib/rate-limit/token-bucket.ts`.
 *
 * Anti-enumeration : `createAccessRequest` dedups silently but always returns
 * success, and the action always returns the same `{ ok: true, message: '…' }`
 * regardless — a visitor can never tell whether their email is already a member
 * or already pending. The audit row carries NO PII (no name/email) — just the
 * fact that a request flow ran.
 *
 * Shape mirrors `app/login/actions.ts`.
 */
export interface RequestAccessActionState {
  ok: boolean;
  message?: string;
  error?: 'rate_limited' | 'invalid_input' | 'unknown';
  retryAfterSec?: number;
  fieldErrors?: Partial<Record<'firstName' | 'lastName' | 'email', string>>;
}

export async function requestAccessAction(
  _prev: RequestAccessActionState | null,
  formData: FormData,
): Promise<RequestAccessActionState> {
  // Pre-auth rate-limit: consume FIRST so a flood can't even reach validation /
  // DB. Trusted IP (Caddy last-hop) — the form is unauthenticated.
  const reqHeaders = await headers();
  const ip = callerIdTrusted({ headers: reqHeaders });
  const decision = accessRequestIpLimiter.consume(ip);
  if (!decision.allowed) {
    return {
      ok: false,
      error: 'rate_limited',
      retryAfterSec: Math.ceil(decision.retryAfterMs / 1000),
    };
  }

  const parsed = accessRequestSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email'),
  });
  if (!parsed.success) {
    const fieldErrors: NonNullable<RequestAccessActionState['fieldErrors']> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === 'firstName' || key === 'lastName' || key === 'email') {
        fieldErrors[key] ??= issue.message;
      }
    }
    return { ok: false, error: 'invalid_input', fieldErrors };
  }

  let created = false;
  try {
    ({ created } = await createAccessRequest(parsed.data));
  } catch (err) {
    console.error('[access-request] createAccessRequest failed', err);
    return { ok: false, error: 'unknown', message: 'Une erreur est survenue, réessaie.' };
  }

  // §26.2 — notify the admin BY EMAIL (the other half of "email ET profil").
  // ONLY when a NEW row was actually created (`created`) — preserves
  // anti-enumeration: a dedup'd/raced submit sends nothing.
  //
  // Deferred via `after()` (post-response) so the awaited count+email network
  // round-trip is NOT on the response path: without this, the created:true
  // branch would return ~hundreds of ms slower than the dedup'd created:false
  // branch, leaking a TIMING oracle that would defeat the anti-enumeration
  // invariant the rest of this action upholds. BEST-EFFORT + count-only (no
  // requester PII): a delivery failure never breaks the public request.
  if (created) {
    const recipient = env.WEEKLY_REPORT_RECIPIENT;
    if (recipient) {
      after(async () => {
        try {
          const pendingCount = await countPendingAccessRequests();
          await sendAccessRequestReceivedAlertEmail({ to: recipient, pendingCount });
        } catch (err) {
          reportWarning('access-request.create', 'admin_notify_failed', {
            error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
          });
        }
      });
    }
  }

  // RGPD: NO PII in audit metadata (no email/name). The `AccessRequest` row
  // (when created) carries the PII with its own purge-cron path; re-logging it
  // here would break data minimisation. Empty metadata also preserves
  // anti-enumeration — the audit trail is identical whether or not a row was
  // actually created.
  await logAudit({ action: 'access_request.created', metadata: {} }).catch(() => undefined);

  return { ok: true, message: 'demande en attente' };
}
