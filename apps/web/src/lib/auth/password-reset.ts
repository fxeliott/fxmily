import 'server-only';

import { createHash } from 'node:crypto';
import { customAlphabet } from 'nanoid';

import { logAudit } from '@/lib/auth/audit';
import { hashPassword } from '@/lib/auth/password';
import { db } from '@/lib/db';

/**
 * Password-reset tokens ("mot de passe oublié", SPEC §7.1 — 2026-06-30).
 *
 * Exact mirror of the invitation token pattern (`lib/auth/invitations.ts`):
 * generate a high-entropy plain token, e-mail it, and store ONLY its SHA-256
 * hash. The plain token never touches disk, so a DB compromise cannot forge a
 * reset. Tokens are single-use (`usedAt`) with a short TTL, and consumption
 * bumps `User.tokenVersion` (revokes every outstanding JWT — the schema doc on
 * `User.tokenVersion` anticipates exactly this).
 *
 * Security posture:
 *   - Only an ACTIVE user is ever issued a token (a suspended/deleted member
 *     must NOT regain access via reset).
 *   - The forgot-flow caller responds identically whether or not an account
 *     exists (anti-enumeration); this module never reveals existence.
 *   - Bounded by construction: issuing a token first `deleteMany`s the user's
 *     prior tokens, so at most one row ever exists per user (no purge cron).
 */

/** Validity window of a reset link — deliberately short (vs the 7-day invite). */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes, SPEC §7.1

/**
 * 64-char URL-safe alphabet (A-Z, a-z, 0-9, -, _). 32 chars ≈ 192 bits — well
 * above the 128-bit floor for a token that can change account credentials.
 */
const generateUrlSafe = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  32,
);

export function generateResetToken(): string {
  return generateUrlSafe();
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface CreatePasswordResetResult {
  plainToken: string;
  expiresAt: Date;
}

/**
 * Issues a single fresh reset token for `userId`, deleting any prior tokens for
 * that user first (so at most one is ever active). Returns the plain token for
 * the email link. The caller MUST only invoke this for a user it has already
 * confirmed exists AND is active — the anti-enumeration neutral response lives
 * in the Server Action, not here.
 */
export async function createPasswordResetToken(
  userId: string,
  ttlMs: number = PASSWORD_RESET_TTL_MS,
): Promise<CreatePasswordResetResult> {
  const plainToken = generateResetToken();
  const tokenHash = hashResetToken(plainToken);
  const expiresAt = new Date(Date.now() + ttlMs);

  await db.$transaction(async (tx) => {
    // Clean slate: invalidate any earlier (used or unused) token for this user
    // so the table stays bounded to ~1 row/user and an old link can't linger.
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
  });

  return { plainToken, expiresAt };
}

export type ResetTokenLookup =
  | { ok: true; token: { id: string; userId: string; expiresAt: Date } }
  | { ok: false; reason: 'unknown' | 'expired' | 'already_used' };

/**
 * Looks up a reset token by its plain value (hashed once, compared to the
 * stored hash). Used by the reset page to decide whether to render the form or
 * an "invalid link" state BEFORE the member types a new password.
 */
export async function findResetTokenByToken(plainToken: string): Promise<ResetTokenLookup> {
  const tokenHash = hashResetToken(plainToken);
  const token = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!token) return { ok: false, reason: 'unknown' };
  if (token.usedAt !== null) return { ok: false, reason: 'already_used' };
  if (token.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };

  return { ok: true, token: { id: token.id, userId: token.userId, expiresAt: token.expiresAt } };
}

export interface CompletePasswordResetInput {
  plainToken: string;
  password: string;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
}

export type CompletePasswordResetResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid_token' | 'expired' | 'already_used' | 'inactive' };

/**
 * Consumes a reset token and rotates the member's password.
 *
 * Idempotency / race protection: the token is consumed via a single atomic
 * `updateMany` predicated on `usedAt = null AND expiresAt > now` (defeats a
 * double-submit). The password rehash + `tokenVersion` bump happen in the same
 * transaction (so every outstanding JWT is revoked the instant the password
 * changes). Only an ACTIVE user is updated — a suspended/deleted member's token
 * is burned without granting access.
 */
export async function completePasswordReset(
  input: CompletePasswordResetInput,
): Promise<CompletePasswordResetResult> {
  // Fail fast on an obviously-bad token without holding a transaction open.
  const lookup = await findResetTokenByToken(input.plainToken);
  if (!lookup.ok) {
    if (lookup.reason === 'unknown') return { ok: false, reason: 'invalid_token' };
    if (lookup.reason === 'expired') return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'already_used' };
  }

  // Hash OUTSIDE the transaction (argon2id ~150ms — never hold a DB tx open for
  // it). The token's single-use consume below still defeats concurrent submits.
  const passwordHash = await hashPassword(input.password);
  const { id: tokenId, userId } = lookup.token;

  const result = await db.$transaction(async (tx) => {
    const now = new Date();
    const consumed = await tx.passwordResetToken.updateMany({
      where: { id: tokenId, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) {
      // Lost the race, or it expired in the gap. Re-read to pick the right copy.
      const stale = await tx.passwordResetToken.findUnique({
        where: { id: tokenId },
        select: { usedAt: true },
      });
      return {
        ok: false as const,
        reason: stale?.usedAt ? ('already_used' as const) : ('expired' as const),
      };
    }

    // Only an ACTIVE member can have their password rotated. The predicate makes
    // this atomic: a member suspended between request and submit is rejected.
    const updated = await tx.user.updateMany({
      where: { id: userId, status: 'active' },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    if (updated.count !== 1) return { ok: false as const, reason: 'inactive' as const };

    return { ok: true as const, userId };
  });

  if (result.ok) {
    // Best-effort audit (PII-free: ids only, never the email/password).
    await logAudit({
      action: 'auth.password_reset.completed',
      userId: result.userId,
      ip: input.ip,
      userAgent: input.userAgent,
    }).catch(() => undefined);
  }

  return result;
}
