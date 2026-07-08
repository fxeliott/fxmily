'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';

/**
 * Server Action backing `/account/visibilite` — the member's RGPD self-service
 * control over their presence on the public leaderboard (`/classement`).
 *
 * `updateLeaderboardOptOutAction(optOut)` — persist `User.leaderboardOptOut`.
 * `true` hides the member's row from OTHER members (they still always see their
 * own rank via `me`); `false` shows it. The READ layer already honours the
 * column (`getLeaderboardBoard` filters `!leaderboardOptOut || isViewer`), so
 * this action is the only missing half: the control that flips it.
 *
 * Pattern carbone `checkin/off-day-actions.ts#updateWeekendsOffAction` :
 *   - re-call `auth()` + `status === 'active'` (defence in depth on the proxy);
 *   - never trust the wire type crossing the Server Action boundary;
 *   - direct `db.user.update` scoped to the session id (no BOLA surface);
 *   - PII-free audit (the resulting boolean only — never any ranking data);
 *   - `revalidatePath` the leaderboard + dashboard + the settings page itself.
 */

export type LeaderboardOptOutActionState =
  | { ok: true; optOut: boolean }
  | { ok: false; error: 'unauthorized' | 'invalid_input' | 'unknown' };

export async function updateLeaderboardOptOutAction(
  optOut: boolean,
): Promise<LeaderboardOptOutActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  // The arg crosses a Server Action boundary — never trust the wire type.
  if (typeof optOut !== 'boolean') {
    return { ok: false, error: 'invalid_input' };
  }

  try {
    await db.user.update({
      where: { id: session.user.id },
      data: { leaderboardOptOut: optOut },
    });
  } catch (err) {
    reportWarning('account.leaderboard.opt_out', 'update_failed', {
      code:
        err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
          ? err.code
          : 'unknown',
    });
    return { ok: false, error: 'unknown' };
  }

  await logAudit({
    action: optOut ? 'account.leaderboard.opted_out' : 'account.leaderboard.opted_in',
    userId: session.user.id,
    metadata: { leaderboardOptOut: optOut },
  });

  // The board hides/shows the row for other members; the dashboard widget + the
  // AppShell rank slot read the same snapshot, so refresh those surfaces too.
  revalidatePath('/classement');
  revalidatePath('/dashboard');
  revalidatePath('/account/visibilite');

  return { ok: true, optOut };
}
