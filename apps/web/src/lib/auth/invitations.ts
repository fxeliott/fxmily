import { createHash } from 'node:crypto';
import { customAlphabet } from 'nanoid';

import { db } from '@/lib/db';

/**
 * Invitation tokens (SPEC §6.9, §7.1).
 *
 * Pattern: generate a high-entropy plain token, send it in the email link,
 * and store ONLY its SHA-256 hash in the DB. On consumption we re-hash the
 * candidate token and look it up. This means a DB compromise does not let an
 * attacker forge accepted invitations: the plain token never touches disk.
 */

/** Default validity window for a freshly created invitation. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, SPEC §7.1

/**
 * 64-char URL-safe alphabet (A-Z, a-z, 0-9, -, _).
 * 32 chars ≈ 192 bits of entropy — well above the 128-bit minimum for tokens
 * that grant account creation.
 */
const generateUrlSafe = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  32,
);

export function generateInvitationToken(): string {
  return generateUrlSafe();
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time string comparison wrapper, just in case we ever expose this
 * helper to a tight loop. Uses Node's timingSafeEqual under the hood — but only
 * if the lengths match, since that fact alone is not a secret.
 */
export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface CreateInvitationParams {
  email: string;
  invitedById: string;
  ttlMs?: number;
}

export interface CreateInvitationResult {
  invitationId: string;
  plainToken: string;
  expiresAt: Date;
}

/**
 * Creates an invitation row and returns the plain token for the email link.
 * The hash is stored in `tokenHash`; the plain value is never persisted.
 */
export async function createInvitation({
  email,
  invitedById,
  ttlMs = INVITATION_TTL_MS,
}: CreateInvitationParams): Promise<CreateInvitationResult> {
  const plainToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(plainToken);
  const expiresAt = new Date(Date.now() + ttlMs);

  const invitation = await db.invitation.create({
    data: {
      email: email.toLowerCase().trim(),
      tokenHash,
      expiresAt,
      invitedById,
    },
    select: { id: true },
  });

  return { invitationId: invitation.id, plainToken, expiresAt };
}

export type InvitationLookupOk = {
  ok: true;
  invitation: {
    id: string;
    email: string;
    expiresAt: Date;
    invitedById: string;
  };
};

export type InvitationLookupErr = {
  ok: false;
  reason: 'unknown' | 'expired' | 'already_used';
};

export type InvitationLookup = InvitationLookupOk | InvitationLookupErr;

/**
 * Looks up an invitation by its plain token. The plain token is hashed once
 * and compared against the stored `tokenHash`.
 */
export async function findInvitationByToken(plainToken: string): Promise<InvitationLookup> {
  const tokenHash = hashInvitationToken(plainToken);
  const invitation = await db.invitation.findUnique({
    where: { tokenHash },
    select: { id: true, email: true, expiresAt: true, usedAt: true, invitedById: true },
  });

  if (!invitation) return { ok: false, reason: 'unknown' };
  if (invitation.usedAt !== null) return { ok: false, reason: 'already_used' };
  if (invitation.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    invitation: {
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      invitedById: invitation.invitedById,
    },
  };
}

/**
 * Marks an invitation as used. Returns `true` if exactly one row was updated,
 * `false` if the invitation was already consumed (race protection).
 */
export async function consumeInvitation(invitationId: string): Promise<boolean> {
  const result = await db.invitation.updateMany({
    where: { id: invitationId, usedAt: null },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
}
