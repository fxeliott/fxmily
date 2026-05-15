'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { upsertHabitLog } from '@/lib/habit/service';
import { reportError } from '@/lib/observability';
import { callerIdTrusted } from '@/lib/rate-limit/token-bucket';
import { habitLogInputSchema, type HabitKind } from '@/lib/schemas/habit-log';

/**
 * V2.1 TRACK — Server Action for `HabitLog` upsert.
 *
 * Pattern carbone J5 / V1.8 :
 *   - `auth()` re-check + status==='active' guard
 *   - Build per-kind discriminated raw input from FormData
 *   - Zod safeParse → return `{ ok:false, fieldErrors }` on invalid
 *   - `upsertHabitLog` service (idempotent on `(userId, date, kind)`)
 *   - V1.12 P4 L3 — propagate `ip` to `logAudit({ip})` for forensic
 *     correlation via top-level `ipHash` SHA-256 column
 *   - `revalidatePath('/track')` + `revalidatePath('/dashboard')`
 *   - `redirect` re-throws NEXT_REDIRECT to navigate to /track?done=1
 *
 * The `kind` discriminant in FormData picks the parser branch. V2.1.0 ships
 * the `sleep` branch only (Sleep wizard). V2.1.1+ adds nutrition / caffeine /
 * sport / meditation branches — each is a switch case + builder helper, no
 * touch to the rest of the action.
 */

export type TrackActionState =
  | { ok: true }
  | {
      ok: false;
      error: 'invalid_input' | 'persist_failed' | 'unauthorized';
      fieldErrors?: Record<string, string[] | undefined>;
    };

function pickStr(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === 'string' ? v : null;
}

function pickNum(fd: FormData, key: string): number | undefined {
  const raw = fd.get(key);
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  const num = Number(raw.replace(',', '.'));
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Build the discriminated `HabitLogInput` raw object from FormData. Each kind
 * has its own shape — see `lib/schemas/habit-log.ts` for the canonical Zod
 * schemas this gets fed into.
 *
 * Returns `null` if the `kind` field is missing or unknown — the caller
 * surfaces `error: 'invalid_input'` in that case.
 */
function buildRawInput(fd: FormData): { kind: HabitKind; raw: unknown } | null {
  const kind = pickStr(fd, 'kind');
  const date = pickStr(fd, 'date');
  const notes = pickStr(fd, 'notes')?.trim() || undefined;

  switch (kind) {
    case 'sleep': {
      const durationMin = pickNum(fd, 'value.durationMin');
      const quality = pickNum(fd, 'value.quality');
      return {
        kind,
        raw: {
          kind,
          date,
          value: {
            durationMin: durationMin ?? -1, // will fail Zod min(0) — surfaces fieldError
            ...(quality !== undefined && quality >= 1 ? { quality } : {}),
          },
          ...(notes ? { notes } : {}),
        },
      };
    }
    // V2.1.1+ : nutrition / caffeine / sport / meditation builders go here.
    default:
      return null;
  }
}

export async function submitHabitLogAction(
  _prev: TrackActionState | null,
  formData: FormData,
): Promise<TrackActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const built = buildRawInput(formData);
  if (!built) {
    return { ok: false, error: 'invalid_input' };
  }

  const parsed = habitLogInputSchema.safeParse(built.raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // V1.12 P4 L3 — extract `ip` once for the audit row top-level `ipHash`
  // column (RGPD §16 SHA-256 hashed, no raw IP). Fail-open if `headers()`
  // throws (Auth.js v5 Route-Handler context regression).
  let ip: string | null = null;
  try {
    const reqHeaders = await headers();
    ip = callerIdTrusted({ headers: reqHeaders });
  } catch {
    /* fail-open — audit row still emits with `ip: null` */
  }

  let result;
  try {
    result = await upsertHabitLog(session.user.id, parsed.data);
  } catch (err) {
    reportError('habit.upsert', err instanceof Error ? err : new Error(String(err)), {
      userId: session.user.id,
      kind: parsed.data.kind,
    });
    return { ok: false, error: 'persist_failed' };
  }

  await logAudit({
    action: 'habit_log.upserted',
    userId: session.user.id,
    ip,
    metadata: {
      kind: parsed.data.kind,
      wasNew: result.wasNew,
      date: parsed.data.date,
    },
  }).catch(() => undefined);

  revalidatePath('/track');
  revalidatePath('/dashboard');
  redirect(`/track?done=1&kind=${parsed.data.kind}`);
}
