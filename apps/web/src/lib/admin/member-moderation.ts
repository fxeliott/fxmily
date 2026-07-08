import 'server-only';

import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';
import { selectStorage } from '@/lib/storage';
import type { MemberModerationAction } from '@/generated/prisma/enums';
import type { MemberModerationEventModel } from '@/generated/prisma/models/MemberModerationEvent';

/**
 * Admin member-moderation service (F5, overhaul 2026-06-30).
 *
 * **Trust boundary** : every function assumes the caller is an authenticated
 * admin AND that the caller-level guards (self / admin-target) already ran.
 * The role is NOT re-checked here — that's the Server Action's job (single
 * source of truth at the edge), mirroring `lib/admin/members-service.ts`.
 *
 * "Expulser / retirer l'accès" = `suspendMember` : flip `status` active→
 * suspended AND bump `User.tokenVersion` in ONE atomic guarded `updateMany`.
 * That single write both ejects the member immediately (every outstanding JWT
 * is torn down on its next `auth()` round-trip via `applyRevocationCheck`) and
 * blocks reconnection (`authorize` refuses a non-active login). Mirror of the
 * canonical revocation write in `lib/account/deletion.ts:259-279` and
 * `lib/auth/password-reset.ts:159-162`.
 *
 * Reintegration = `reinstateMember` : suspended→active. NO tokenVersion bump
 * — a suspended member already holds no valid session, so there is nothing to
 * revoke; the bump would only invalidate a session they cannot have.
 *
 * Every transition is appended to `MemberModerationEvent` (with the optional
 * free-text motif) in the SAME transaction as the status flip, so a row in the
 * log always corresponds to a real status change and vice-versa.
 */

/** JSON-safe view of a `MemberModerationEvent`. Date → ISO string. */
export interface SerializedModerationEvent {
  id: string;
  memberId: string;
  actorId: string | null;
  action: MemberModerationAction;
  reason: string | null;
  createdAt: string;
}

function serialize(row: MemberModerationEventModel): SerializedModerationEvent {
  return {
    id: row.id,
    memberId: row.memberId,
    actorId: row.actorId,
    action: row.action,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ModerationInput {
  /** The member the action targets. */
  memberId: string;
  /** The admin performing the action. */
  actorId: string;
  /** Optional motif (already validated + normalised to null when empty). */
  reason: string | null;
}

export type SuspendMemberResult =
  | { ok: true; event: SerializedModerationEvent }
  // count!==1 : the member is not an ACTIVE member-role row (already suspended /
  // deleted / an admin / vanished) — the guarded predicate lost the race or the
  // caller-level pre-checks were stale.
  | { ok: false; reason: 'not_active' };

/**
 * Suspend (expel) a member: atomic guarded `status active→suspended` +
 * `tokenVersion` bump, then append a `suspended` event. The `WHERE
 * { status:'active', role:'member' }` predicate makes the guard race-proof —
 * an admin row or an already-suspended member yields `count 0`.
 */
export async function suspendMember(input: ModerationInput): Promise<SuspendMemberResult> {
  return db.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: input.memberId, status: 'active', role: 'member' },
      data: { status: 'suspended', tokenVersion: { increment: 1 } },
    });
    if (updated.count !== 1) return { ok: false as const, reason: 'not_active' as const };

    const event = await tx.memberModerationEvent.create({
      data: {
        memberId: input.memberId,
        actorId: input.actorId,
        action: 'suspended',
        reason: input.reason,
      },
    });
    return { ok: true as const, event: serialize(event) };
  });
}

export type ReinstateMemberResult =
  | { ok: true; event: SerializedModerationEvent }
  // count!==1 : the member is not currently suspended (active again / deleted /
  // vanished). A `deleted` member is intentionally NOT reinstatable here — that
  // is the RGPD lifecycle's concern, not moderation.
  | { ok: false; reason: 'not_suspended' };

/**
 * Reinstate a suspended member: atomic guarded `status suspended→active`, then
 * append a `reinstated` event. No tokenVersion bump (see file header).
 */
export async function reinstateMember(input: ModerationInput): Promise<ReinstateMemberResult> {
  return db.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      // `role:'member'` mirrors `suspendMember`'s predicate (defense-in-depth):
      // moderation never touches an admin account, and that invariant must hold
      // by construction on the reinstate branch too — an admin row could only be
      // `suspended` via a direct DB edit / a future out-of-scope path, and even
      // then reinstate must never silently flip it back to `active`.
      where: { id: input.memberId, status: 'suspended', role: 'member' },
      data: { status: 'active' },
    });
    if (updated.count !== 1) return { ok: false as const, reason: 'not_suspended' as const };

    const event = await tx.memberModerationEvent.create({
      data: {
        memberId: input.memberId,
        actorId: input.actorId,
        action: 'reinstated',
        reason: input.reason,
      },
    });
    return { ok: true as const, event: serialize(event) };
  });
}

export type RemoveMemberAvatarResult =
  | { ok: true; event: SerializedModerationEvent; removedKey: string }
  // The target is not an actionable member with a photo (admin row, no avatar
  // set, or vanished) — nothing to take down.
  | { ok: false; reason: 'no_avatar' };

/**
 * Admin takedown of a member's profile photo (an inappropriate/non-consensual
 * image). Atomic guarded clear of `User.avatarKey` + an `avatar_removed` event
 * in ONE transaction, then a best-effort sweep of the stored file. The
 * `WHERE { role:'member', avatarKey: { not: null } }` predicate keeps moderation
 * off admin rows (mirrors suspend/reinstate) and makes a photoless member a
 * `no_avatar` no-op — race-proof.
 *
 * The member KEEPS their account, ranking and place on the board — ONLY the
 * image is removed (they can upload a new one; the leaderboard falls back to
 * their initials). The file sweep runs AFTER the DB write, so the photo is off
 * the board the instant `avatarKey` is cleared even if the unlink fails (that
 * only orphans the file — swept later by the janitor); a failure is reported,
 * never thrown — same best-effort posture as the RGPD erasure sweeps
 * (`lib/account/deletion.ts`).
 */
export async function removeMemberAvatar(
  input: ModerationInput,
): Promise<RemoveMemberAvatarResult> {
  const outcome = await db.$transaction(async (tx) => {
    const member = await tx.user.findFirst({
      where: { id: input.memberId, role: 'member', avatarKey: { not: null } },
      select: { avatarKey: true },
    });
    if (!member?.avatarKey) return null;

    await tx.user.update({
      where: { id: input.memberId },
      data: { avatarKey: null },
    });
    const event = await tx.memberModerationEvent.create({
      data: {
        memberId: input.memberId,
        actorId: input.actorId,
        action: 'avatar_removed',
        reason: input.reason,
      },
    });
    return { event: serialize(event), removedKey: member.avatarKey };
  });

  if (outcome === null) return { ok: false as const, reason: 'no_avatar' as const };

  // Best-effort file sweep — the DB is already the source of truth (avatarKey
  // cleared), so a failed unlink only orphans the file; it never blocks the
  // takedown nor resurfaces the photo on the board.
  try {
    await selectStorage().delete(outcome.removedKey);
  } catch (err) {
    reportWarning('admin.member.avatar_removed', 'storage_sweep_failed', {
      userId: input.memberId,
      kind: 'avatar',
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
  }

  return { ok: true as const, event: outcome.event, removedKey: outcome.removedKey };
}

/**
 * Newest-first moderation history for a member (admin "Modération" tab).
 * Bounded by `take` (default 50 — a member's moderation log is tiny by nature).
 * Covered by `@@index([memberId, createdAt])`.
 */
export async function listModerationHistory(
  memberId: string,
  take = 50,
): Promise<SerializedModerationEvent[]> {
  const rows = await db.memberModerationEvent.findMany({
    where: { memberId },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map(serialize);
}
