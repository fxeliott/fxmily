'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { ZodError } from 'zod';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import {
  CheckinDateOutOfWindowError,
  submitEveningCheckin,
  submitMorningCheckin,
} from '@/lib/checkin/service';
import { eveningCheckinSchema, morningCheckinSchema } from '@/lib/schemas/checkin';
import { scheduleDouglasDispatch } from '@/lib/cards/scheduler';
import { scheduleScoreRecompute } from '@/lib/scoring/scheduler';

/**
 * Server Actions for the daily check-in flows (J5, SPEC §7.4).
 *
 * Pattern recap (matches J1+J2 conventions):
 *   - Re-call `auth()` at the top — defence in depth.
 *   - Re-validate `FormData` with the Zod schemas.
 *   - Return a discriminated `ActionState` for `useActionState`.
 *   - Re-throw `NEXT_REDIRECT` so navigation isn't swallowed.
 */

export interface CheckinActionState {
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

function getStringArray(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((v): v is string => typeof v === 'string');
}

export async function submitMorningCheckinAction(
  _prev: CheckinActionState | null,
  formData: FormData,
): Promise<CheckinActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    date: getString(formData, 'date'),
    sleepHours: getString(formData, 'sleepHours'),
    sleepQuality: getString(formData, 'sleepQuality'),
    morningRoutineCompleted: getString(formData, 'morningRoutineCompleted'),
    meditationMin: getString(formData, 'meditationMin'),
    sportType: getString(formData, 'sportType'),
    sportDurationMin: getString(formData, 'sportDurationMin'),
    moodScore: getString(formData, 'moodScore'),
    intention: getString(formData, 'intention'),
    emotionTags: getStringArray(formData, 'emotionTags'),
  };

  const parsed = morningCheckinSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  try {
    const row = await submitMorningCheckin(session.user.id, parsed.data, {
      timezone: session.user.timezone,
    });
    await logAudit({
      action: 'checkin.morning.submitted',
      userId: session.user.id,
      metadata: {
        checkinId: row.id,
        date: row.date,
        moodScore: row.moodScore,
        sleepQuality: row.sleepQuality,
      },
    });
    scheduleDouglasDispatch(session.user.id, 'checkin.morning.submitted');
  } catch (err) {
    if (err instanceof CheckinDateOutOfWindowError) {
      return {
        ok: false,
        error: 'invalid_input',
        fieldErrors: { date: 'Date hors fenêtre autorisée pour ton fuseau.' },
      };
    }
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    console.error('[checkin.morning] submit failed', { code });
    return { ok: false, error: 'unknown' };
  }

  revalidatePath('/checkin');
  revalidatePath('/dashboard');
  scheduleScoreRecompute(
    session.user.id,
    'checkin.morning.submitted',
    session.user.timezone || 'Europe/Paris',
  );

  // `redirect()` always throws (NEXT_REDIRECT). No try/catch: if it ever
  // doesn't throw (Next bug), letting the bug surface is preferable to
  // silently returning `{ ok: true }` and leaving the wizard hanging.
  // Audit J5 H2 fix.
  redirect('/checkin?slot=morning&done=1');
}

export async function submitEveningCheckinAction(
  _prev: CheckinActionState | null,
  formData: FormData,
): Promise<CheckinActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }

  const raw = {
    date: getString(formData, 'date'),
    planRespectedToday: getString(formData, 'planRespectedToday'),
    hedgeRespectedToday: getString(formData, 'hedgeRespectedToday'),
    caffeineMl: getString(formData, 'caffeineMl'),
    waterLiters: getString(formData, 'waterLiters'),
    stressScore: getString(formData, 'stressScore'),
    moodScore: getString(formData, 'moodScore'),
    emotionTags: getStringArray(formData, 'emotionTags'),
    journalNote: getString(formData, 'journalNote'),
    gratitudeItems: getStringArray(formData, 'gratitudeItems'),
  };

  const parsed = eveningCheckinSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: flattenFieldErrors(parsed.error),
    };
  }

  try {
    const row = await submitEveningCheckin(session.user.id, parsed.data, {
      timezone: session.user.timezone,
    });
    await logAudit({
      action: 'checkin.evening.submitted',
      userId: session.user.id,
      metadata: {
        checkinId: row.id,
        date: row.date,
        moodScore: row.moodScore,
        stressScore: row.stressScore,
        planRespected: row.planRespectedToday,
      },
    });
    scheduleDouglasDispatch(session.user.id, 'checkin.evening.submitted');
  } catch (err) {
    if (err instanceof CheckinDateOutOfWindowError) {
      return {
        ok: false,
        error: 'invalid_input',
        fieldErrors: { date: 'Date hors fenêtre autorisée pour ton fuseau.' },
      };
    }
    const code =
      err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
        ? err.code
        : 'unknown';
    console.error('[checkin.evening] submit failed', { code });
    return { ok: false, error: 'unknown' };
  }

  revalidatePath('/checkin');
  revalidatePath('/dashboard');
  scheduleScoreRecompute(
    session.user.id,
    'checkin.evening.submitted',
    session.user.timezone || 'Europe/Paris',
  );

  // See morning action — `redirect()` always throws, no try/catch needed.
  redirect('/checkin?slot=evening&done=1');
}
