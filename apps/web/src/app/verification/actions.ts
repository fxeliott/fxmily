'use server';

import { revalidatePath } from 'next/cache';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { brokerAccountCreateSchema } from '@/lib/schemas/verification';
import {
  BrokerAccountLimitError,
  ProofNotFoundError,
  createBrokerAccount,
  deleteProof,
} from '@/lib/verification/service';

/**
 * S3 — Server Actions for the `/verification` member surface (SPEC §33).
 *
 * Pattern V1.7 §30 `/reunions` carbone:
 *   - Re-call `auth()` + `status === 'active'` at the top (defence in depth on
 *     top of `proxy.ts`).
 *   - Re-validate FormData with the strict Zod schema.
 *   - PII-FREE audit metadata (opaque ids + enum fields only — never the
 *     account label / broker name free-text, §33 audit invariant).
 *
 * The proof UPLOAD itself goes through `POST /api/uploads` (kind `mt5-proof`)
 * — the row is created there so the SHA-256 dedup hash is server-derived from
 * the validated bytes. These actions only cover account declaration + proof
 * deletion.
 */

export interface CreateBrokerAccountActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'limit_reached' | 'unknown';
  fieldErrors?: Record<string, string>;
  accountId?: string;
}

function flattenFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}

function getString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v : '';
}

export async function createBrokerAccountAction(
  _prev: CreateBrokerAccountActionState | null,
  formData: FormData,
): Promise<CreateBrokerAccountActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const brokerNameRaw = getString(formData, 'brokerName').trim();
  const parsed = brokerAccountCreateSchema.safeParse({
    label: getString(formData, 'label'),
    type: getString(formData, 'type'),
    ...(brokerNameRaw.length > 0 ? { brokerName: brokerNameRaw } : {}),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', fieldErrors: flattenFieldErrors(parsed.error) };
  }

  let accountId: string;
  try {
    const account = await createBrokerAccount(session.user.id, parsed.data);
    accountId = account.id;
  } catch (err) {
    if (err instanceof BrokerAccountLimitError) {
      return { ok: false, error: 'limit_reached' };
    }
    console.error('[verification.createBrokerAccount] failed', err);
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'verification.account.created',
    userId: session.user.id,
    metadata: { accountId, type: parsed.data.type },
  });

  revalidatePath('/verification');
  return { ok: true, accountId };
}

export interface DeleteProofActionState {
  ok: boolean;
  error?: 'unauthorized' | 'not_found' | 'unknown';
}

export async function deleteProofAction(
  proofId: string,
  _prev: DeleteProofActionState | null,
): Promise<DeleteProofActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  if (!/^[a-z0-9]{8,40}$/.test(proofId)) {
    return { ok: false, error: 'not_found' };
  }

  try {
    await deleteProof(session.user.id, proofId);
  } catch (err) {
    if (err instanceof ProofNotFoundError) {
      return { ok: false, error: 'not_found' };
    }
    console.error('[verification.deleteProof] failed', err);
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'verification.proof.deleted',
    userId: session.user.id,
    metadata: { proofId },
  });

  revalidatePath('/verification');
  return { ok: true };
}
