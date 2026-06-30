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
import { reportError, reportWarning } from '@/lib/observability';
import { detectCrisis } from '@/lib/safety/crisis-detection';
import {
  buildCheckinCrisisCorpus,
  eveningCheckinSchema,
  morningCheckinSchema,
} from '@/lib/schemas/checkin';
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
    marketAnalysisDone: getString(formData, 'marketAnalysisDone'),
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

  // T1 safety — scan the member's free-text (morning = `intention`) for crisis
  // signals BEFORE persisting. Pure + non-blocking: we ALWAYS persist, then
  // surface a calm resource banner on the redirect (never silent-skip member
  // input). Numeric/structured fields are never scanned.
  const crisis = detectCrisis(buildCheckinCrisisCorpus({ intention: parsed.data.intention }));
  const crisisMatchedLabels = crisis.matches.map((m) => m.label);

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
        crisisLevel: crisis.level,
      },
    });
    if (crisis.level === 'high' || crisis.level === 'medium') {
      await logAudit({
        action: 'checkin.crisis_detected',
        userId: session.user.id,
        metadata: {
          checkinId: row.id,
          date: row.date,
          level: crisis.level,
          matchedLabels: crisisMatchedLabels,
          source: 'checkin',
        },
      });
      if (crisis.level === 'high') {
        reportError(
          'checkin.crisis',
          new Error(`crisis_signal_high_in_checkin: ${crisisMatchedLabels.join(',')}`),
          { userId: session.user.id, checkinId: row.id, slot: 'morning' },
        );
      } else {
        reportWarning('checkin.crisis', 'crisis_signal_medium_in_checkin', {
          userId: session.user.id,
          checkinId: row.id,
          slot: 'morning',
          matchedLabels: crisisMatchedLabels,
        });
      }
    }
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
    reportWarning('checkin.morning', 'submit_failed', { code });
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
  const qs = new URLSearchParams({ slot: 'morning', done: '1' });
  if (crisis.level === 'high' || crisis.level === 'medium') {
    qs.set('crisis', crisis.level);
  }
  redirect(`/checkin?${qs.toString()}`);
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
    // #13 — evening "intention kept?" self-report ('' → null in the schema).
    // The wizard POSTs `intentionKept` (evening-checkin-wizard.tsx) and the
    // schema/service/scoring (discipline sub-score, weight 10) all consume it,
    // but it was never read here — so it always persisted null and the
    // morning→evening intention loop stayed dead. Mirror of `formationFollowed`.
    intentionKept: getString(formData, 'intentionKept'),
    // SPEC §28/§22 — optional course self-report ('' → null in the schema).
    formationFollowed: getString(formData, 'formationFollowed'),
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

  // T1 safety — scan the member's free-text (evening = `journalNote` +
  // `gratitudeItems`) for crisis signals BEFORE persisting. Pure +
  // non-blocking: we ALWAYS persist, then surface a calm resource banner on
  // the redirect (never silent-skip member input).
  const crisis = detectCrisis(
    buildCheckinCrisisCorpus({
      journalNote: parsed.data.journalNote,
      gratitudeItems: parsed.data.gratitudeItems,
    }),
  );
  const crisisMatchedLabels = crisis.matches.map((m) => m.label);

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
        crisisLevel: crisis.level,
      },
    });
    if (crisis.level === 'high' || crisis.level === 'medium') {
      await logAudit({
        action: 'checkin.crisis_detected',
        userId: session.user.id,
        metadata: {
          checkinId: row.id,
          date: row.date,
          level: crisis.level,
          matchedLabels: crisisMatchedLabels,
          source: 'checkin',
        },
      });
      if (crisis.level === 'high') {
        reportError(
          'checkin.crisis',
          new Error(`crisis_signal_high_in_checkin: ${crisisMatchedLabels.join(',')}`),
          { userId: session.user.id, checkinId: row.id, slot: 'evening' },
        );
      } else {
        reportWarning('checkin.crisis', 'crisis_signal_medium_in_checkin', {
          userId: session.user.id,
          checkinId: row.id,
          slot: 'evening',
          matchedLabels: crisisMatchedLabels,
        });
      }
    }
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
    reportWarning('checkin.evening', 'submit_failed', { code });
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
  const qs = new URLSearchParams({ slot: 'evening', done: '1' });
  if (crisis.level === 'high' || crisis.level === 'medium') {
    qs.set('crisis', crisis.level);
  }
  redirect(`/checkin?${qs.toString()}`);
}
