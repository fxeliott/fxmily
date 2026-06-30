import 'server-only';

import { db } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import {
  INVITATION_TTL_MS,
  generateInvitationToken,
  hashInvitationToken,
} from '@/lib/auth/invitations';
import type { AccessRequestStatus } from '@/generated/prisma/enums';
import type { AccessRequestModel } from '@/generated/prisma/models/AccessRequest';

/**
 * Self-service access-request service (V2.5 — public "Rejoindre" front door).
 *
 * **Trust boundary** : the admin-facing functions here (`list*`, `approve*`,
 * `reject*`) ASSUME the caller is an authenticated admin. The role is NOT
 * re-checked inside the service — that's the Server Action / route's job
 * (`app/admin/access-requests/actions.ts` re-calls `auth()` + asserts
 * `role==='admin'`, and `proxy.ts` gates `/admin/*` upstream). Mirrors the
 * J3/J4/V2.1 admin-service split (`lib/admin/*-service.ts`).
 *
 * `createAccessRequest` is the ONLY public-callable function and is written to
 * be ANTI-ENUMERATION: it returns the same neutral success regardless of
 * whether a row was actually created, so a public caller can never tell from
 * the response whether an email is already a member / already pending.
 *
 * On approval we REUSE the existing invitation/onboarding pipeline (a fresh
 * `Invitation` is minted inline, exactly like `createInvitationAction`); this
 * service NEVER creates an account itself.
 */

// ----- Public API types -------------------------------------------------------

export interface CreateAccessRequestInput {
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Neutral result of a public access request. `created` is for internal
 * telemetry / tests ONLY — the public Server Action MUST NOT leak it to the
 * client (anti-enumeration). The caller always shows the same "demande en
 * attente" message.
 */
export interface CreateAccessRequestResult {
  /** Always `true` from the caller's perspective (no enumeration). */
  ok: true;
  /** Internal: did this call actually insert a new row? (not surfaced to UI). */
  created: boolean;
}

/** JSON-safe view of an `AccessRequest` for the admin list. */
export interface SerializedAccessRequest {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: AccessRequestStatus;
  reviewedAt: string | null;
  reviewedById: string | null;
  invitationId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Result of approving a request — fed to the caller to send the email. */
export interface ApproveAccessRequestResult {
  /** The newly minted invitation's id (for delete-on-email-failure rollback). */
  invitationId: string;
  /** The plain invitation token for the email link (never persisted). */
  plainToken: string;
  /** The invitation expiry (carried into the email copy). */
  expiresAt: Date;
  /** The requester's email (the email recipient). */
  email: string;
  /** The requester's first name (for the email greeting). */
  firstName: string;
}

// ----- Typed errors -----------------------------------------------------------

export class AccessRequestNotFoundError extends Error {
  override readonly name = 'AccessRequestNotFoundError';
  constructor() {
    super('access request not found');
  }
}

export class AccessRequestNotPendingError extends Error {
  override readonly name = 'AccessRequestNotPendingError';
  constructor() {
    super('access request is not pending');
  }
}

export class AccessRequestUserExistsError extends Error {
  override readonly name = 'AccessRequestUserExistsError';
  constructor() {
    super('an active user already exists for this email');
  }
}

// ----- Helpers ----------------------------------------------------------------

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function serializeAccessRequest(row: AccessRequestModel): SerializedAccessRequest {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    status: row.status,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewedById: row.reviewedById,
    invitationId: row.invitationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ----- Service ----------------------------------------------------------------

/**
 * Create a public access request. Anti-enumeration by construction:
 *
 *   - Dedup: if a `pending` request OR an active (non-deleted) `User` already
 *     exists for the (normalized) email, we DO NOT create a duplicate row.
 *   - But we ALWAYS return success (`ok: true`) regardless — the caller can't
 *     tell whether a row was created, so it can't probe membership.
 *
 * The name fields are already `safeFreeText`-sanitized + bidi-refused at the
 * Zod boundary (`accessRequestSchema` via `nameSchema`) before reaching here.
 */
export async function createAccessRequest(
  input: CreateAccessRequestInput,
): Promise<CreateAccessRequestResult> {
  const email = normalizeEmail(input.email);

  // Dedup, two layers:
  //  1. Fast-path existence check (already an active/suspended member, or an
  //     already-pending request) → skip the insert.
  //  2. The DB partial UNIQUE index `(email) WHERE status='pending'` (created in
  //     the migration SQL — Prisma 7 can't model partial predicates, same
  //     pattern as the notification_queue partial indexes) is the real
  //     race guard: under Read Committed two concurrent submits for the same new
  //     email both pass the check above, but only ONE insert wins — the loser
  //     raises P2002 and is treated as an existing pending request.
  // Either branch returns the SAME neutral result (anti-enumeration).
  const [existingUser, existingPending] = await Promise.all([
    db.user.findFirst({
      where: { email, status: { not: 'deleted' } },
      select: { id: true },
    }),
    db.accessRequest.findFirst({
      where: { email, status: 'pending' },
      select: { id: true },
    }),
  ]);

  if (existingUser || existingPending) return { ok: true, created: false };

  try {
    await db.accessRequest.create({
      data: { firstName: input.firstName, lastName: input.lastName, email },
      select: { id: true },
    });
    return { ok: true, created: true };
  } catch (err) {
    // A concurrent submit raced us to the single pending slot → neutral dedup.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: true, created: false };
    }
    throw err;
  }
  // Note: `created` is internal only (tests/telemetry), never surfaced to the UI.
}

// DOS-1 (RC#8) — hard render cap. The AccessRequest table is fed by the
// UNAUTHENTICATED public Server Action (rejoindre/actions.ts), throttled only
// per-IP, so a distributed flood (one fresh email per row, bounded by the
// `(email) WHERE status='pending'` partial unique index + the 30-day purge
// cron) could accumulate enough pending rows that an unbounded findMany would
// materialise + serialise + ship them all in one admin RSC payload. The admin
// queue is FIFO (oldest first) so a cap degrades gracefully — the true backlog
// is shown by `countPendingAccessRequests` (the badge), and operators work the
// oldest rows down. Mirrors the `take` discipline of members-/trades-service.
const ADMIN_LIST_RENDER_CAP = 500;

/** List pending requests for the admin queue, oldest first (FIFO review). */
export async function listPendingAccessRequests(): Promise<SerializedAccessRequest[]> {
  const rows = await db.accessRequest.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: ADMIN_LIST_RENDER_CAP,
  });
  return rows.map(serializeAccessRequest);
}

/**
 * List requests, optionally filtered by status, newest first. Admin-only —
 * useful for an "all requests" audit view (history of approvals/rejections).
 */
export async function listAccessRequests(
  status?: AccessRequestStatus,
): Promise<SerializedAccessRequest[]> {
  const rows = await db.accessRequest.findMany({
    ...(status ? { where: { status } } : {}),
    orderBy: { createdAt: 'desc' },
    take: ADMIN_LIST_RENDER_CAP,
  });
  return rows.map(serializeAccessRequest);
}

/** Count pending requests — for the dashboard admin card badge. */
export async function countPendingAccessRequests(): Promise<number> {
  return db.accessRequest.count({ where: { status: 'pending' } });
}

/**
 * Approve a pending access request. Mirrors `createInvitationAction`'s
 * transaction (`admin/invite/actions.ts:48-101`):
 *
 *   - reject if the request is not `pending` (`AccessRequestNotPendingError`)
 *     or unknown (`AccessRequestNotFoundError`);
 *   - reject if a User already exists for the email
 *     (`AccessRequestUserExistsError`) — never resurrect a member;
 *   - invalidate any prior unused invitation for the email (one active token
 *     per email at a time, same anti-race as the invite flow);
 *   - mint a fresh `Invitation` (inline token, `invitedById=adminId`) carrying
 *     the request's email — REUSING the onboarding pipeline;
 *   - flip the request to `approved` + set `reviewedAt`/`reviewedById`/
 *     `invitationId`.
 *
 * Returns `{invitationId, plainToken, expiresAt, email, firstName}` so the
 * CALLER (Server Action) sends the premium email and, on email failure,
 * rolls back (delete the invitation + revert the request to pending). The
 * plain token is NEVER persisted (only its SHA-256 hash is stored).
 */
export async function approveAccessRequest(
  requestId: string,
  adminId: string,
): Promise<ApproveAccessRequestResult> {
  const plainToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(plainToken);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  return db.$transaction(async (tx) => {
    const request = await tx.accessRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, email: true, firstName: true },
    });
    if (!request) throw new AccessRequestNotFoundError();
    if (request.status !== 'pending') throw new AccessRequestNotPendingError();

    const existingUser = await tx.user.findUnique({
      where: { email: request.email },
      select: { id: true },
    });
    if (existingUser) throw new AccessRequestUserExistsError();

    // One active invitation token per email at a time (mirror invite flow).
    await tx.invitation.updateMany({
      where: { email: request.email, usedAt: null },
      data: { usedAt: new Date() },
    });

    const invitation = await tx.invitation.create({
      data: {
        email: request.email,
        tokenHash,
        expiresAt,
        invitedById: adminId,
      },
      select: { id: true },
    });

    // Optimistic guard — re-assert `status: 'pending'` in the WHERE so two
    // concurrent approvals can't both mint an invitation: the loser's
    // updateMany matches 0 rows (the row is already 'approved') and we abort,
    // rolling the whole transaction back (its just-created invitation included).
    const flipped = await tx.accessRequest.updateMany({
      where: { id: request.id, status: 'pending' },
      data: {
        status: 'approved',
        reviewedAt: new Date(),
        reviewedById: adminId,
        invitationId: invitation.id,
      },
    });
    if (flipped.count === 0) throw new AccessRequestNotPendingError();

    return {
      invitationId: invitation.id,
      plainToken,
      expiresAt,
      email: request.email,
      firstName: request.firstName,
    };
  });
}

/**
 * Roll back a failed approval (delete-on-email-failure, mirror
 * `invite/actions.ts:92-100`): hard-delete the minted invitation and revert
 * the request to `pending` so the admin's next click mints a fresh token.
 * Best-effort — never throws (the caller is already in an error path).
 */
export async function rollbackApproval(requestId: string, invitationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.invitation.deleteMany({ where: { id: invitationId } });
    await tx.accessRequest.updateMany({
      where: { id: requestId, status: 'approved' },
      data: {
        status: 'pending',
        reviewedAt: null,
        reviewedById: null,
        invitationId: null,
      },
    });
  });
}

/** Result of rejecting a request — fed to the caller to send the refusal email
 *  (§26.4). Mirrors `ApproveAccessRequestResult`'s email-carrying shape. */
export interface RejectAccessRequestResult {
  /** The requester's email (the refusal email recipient). */
  email: string;
  /** The requester's first name (for the email greeting). */
  firstName: string;
}

/**
 * Reject a pending access request. Terminal — no account is ever created. Since
 * §26.4 (« le membre reçoit alors un e-mail d'acceptation OU de refus ») a
 * refusal email IS now sent, this returns the requester's `{email, firstName}`
 * so the CALLER (Server Action) can send it BEST-EFFORT (a rejection stands
 * even if the email fails — unlike approval which rolls back). Throws
 * `AccessRequestNotFoundError` / `AccessRequestNotPendingError` so the Server
 * Action can surface the right banner. Transaction mirror of
 * `approveAccessRequest` (find → assert pending → update, atomic).
 */
export async function rejectAccessRequest(
  requestId: string,
  adminId: string,
): Promise<RejectAccessRequestResult> {
  return db.$transaction(async (tx) => {
    const request = await tx.accessRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, email: true, firstName: true },
    });
    if (!request) throw new AccessRequestNotFoundError();
    if (request.status !== 'pending') throw new AccessRequestNotPendingError();

    await tx.accessRequest.update({
      where: { id: request.id },
      data: {
        status: 'rejected',
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
    });

    return { email: request.email, firstName: request.firstName };
  });
}
