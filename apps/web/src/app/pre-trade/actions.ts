'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { reportWarning } from '@/lib/observability';
import { createPreTradeCheck } from '@/lib/pre-trade/service';
import { preTradeCheckSchema } from '@/lib/schemas/pre-trade-check';

/**
 * Server Action for V2.3 pre-trade circuit breaker wizard (ADR-003, jalon
 * Session BB+CC).
 *
 * Pattern J5 `submitMorningCheckinAction` carbone:
 *   - Re-call `auth()` at the top (defence in depth on top of `proxy.ts`).
 *   - Re-validate FormData with the strict Zod schema (the wizard's
 *     client-side validation is best-effort UX, the Server Action is the
 *     only authority).
 *   - Return a discriminated `PreTradeCheckActionState` for `useActionState`.
 *   - Call `redirect()` directly: it ALWAYS throws `NEXT_REDIRECT`. No
 *     try/catch wrapper — if Next ever breaks the throw contract, letting
 *     the bug surface beats silently returning `{ ok: true }` and leaving
 *     the wizard hanging (J5 H2 fix carbone).
 *
 * FormData → boolean coercion (`coerceBool`): HTML checkboxes / radio yield
 * `'on'` / `'true'` / `'false'` / missing. The Zod schema is strict
 * `z.boolean()` per ADR-003 §Scope V1 (no `z.coerce` — defense against the
 * `Boolean('false') === true` footgun). We coerce HERE so the schema stays a
 * pure structural assertion at the trust boundary.
 *
 * Posture §2 / ADR-003 §Scope V1 invariants enforced here:
 *   - ZERO free-text in the payload (the schema rejects unknown keys via
 *     `.strict()` — defense in depth against UI/LLM drift).
 *   - PII-FREE audit metadata (no notes, no body, just the 4 closed-instrument
 *     enums + booleans + `checkId` + `linkedTradeId: null` placeholder).
 *   - `linkedTradeId: null` at creation — auto-link fires later in
 *     `createTradeAction` / `closeTradeAction` (Etape 7).
 */

export interface PreTradeCheckActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'unknown';
  fieldErrors?: Record<string, string>;
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

/**
 * Coerce a FormData entry to a boolean. Recognised truthy forms (case-insens.):
 * `'on'` (HTML checkbox checked), `'true'`, `'1'`, `'yes'`. Anything else
 * (`'off'`, `'false'`, `'0'`, `'no'`, missing, non-string) → `false`.
 *
 * Defense against the `Boolean('false') === true` JS footgun: we never call
 * `Boolean()` on a FormData string.
 */
function coerceBool(formData: FormData, key: string): boolean {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return false;
  const v = raw.trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}

export async function submitPreTradeCheckAction(
  _prev: PreTradeCheckActionState | null,
  formData: FormData,
): Promise<PreTradeCheckActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    reasonToTrade: getString(formData, 'reasonToTrade'),
    emotionLabel: getString(formData, 'emotionLabel'),
    planAlignment: coerceBool(formData, 'planAlignment'),
    stopLossPredefined: coerceBool(formData, 'stopLossPredefined'),
  };

  const parsed = preTradeCheckSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  let check;
  try {
    check = await createPreTradeCheck(session.user.id, parsed.data);
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    reportWarning('pre-trade.submit', 'persist_failed', { code });
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: 'pre_trade_check.created',
    userId: session.user.id,
    metadata: {
      checkId: check.id,
      reasonToTrade: parsed.data.reasonToTrade,
      emotionLabel: parsed.data.emotionLabel,
      planAlignment: parsed.data.planAlignment,
      stopLossPredefined: parsed.data.stopLossPredefined,
      linkedTradeId: null,
    },
  });

  // Revalidate only `/dashboard` — the source page `/pre-trade/new` is itself
  // `export const dynamic = 'force-dynamic'` (`new/page.tsx:12`), so it does
  // NOT participate in Next's RSC cache and revalidating it is a no-op (V2.3.1
  // reviewer P3 nit cleanup, scar W1 anti dead-call).
  revalidatePath('/dashboard');

  // J5 H2 fix: `redirect()` always throws (NEXT_REDIRECT). No try/catch —
  // if Next ever doesn't throw, letting the bug surface beats silently
  // returning `{ ok: true }` and leaving the wizard hanging.
  //
  // Target: `/dashboard?done=pre-trade` (NOT brief's `/?done=pre-trade` —
  // `/` is the public SplashHero, landing an authenticated post-submit user
  // there breaks the confirmation UX. The Card trigger lives on /dashboard
  // — returning the user there with a confirmation flag is the consistent
  // J5 pattern. Documented deviation from auto_session_resume §4 brief).
  redirect('/dashboard?done=pre-trade');
}
