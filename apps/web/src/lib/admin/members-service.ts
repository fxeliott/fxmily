import 'server-only';

import { db } from '@/lib/db';
import type { UserRole, UserStatus } from '@/generated/prisma/enums';

/**
 * Admin members service (J3, SPEC §7.7).
 *
 * **Trust boundary** : every function here assumes the caller is an authenticated
 * admin. We do NOT recheck the role inside the service — that's the route /
 * Server Action's job (defense in depth at the edge, single source of truth).
 *
 * Mirroring the J2 split: user-scoped CRUD lives in `lib/trades/service.ts`
 * for the member-facing surface; the bypass-ownership variant lives here so
 * the two scopes stay distinct on purpose.
 */

export interface MemberSummary {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  status: UserStatus;
  joinedAt: string;
  lastSeenAt: string | null;
  tradesCount: number;
  tradesOpenCount: number;
  tradesClosedCount: number;
}

export interface MemberDetail extends MemberSummary {
  /** Full name reconstructed for display ("Eliott Pena" or fallback to email). */
  displayName: string;
  /** ISO timestamps for the last trade activity (any state). */
  lastTradeAt: string | null;
  /**
   * IANA timezone of the member (default `'Europe/Paris'` per User schema).
   * Surfaced here so the admin overview page can fetch dashboard analytics
   * in the member's local-day frame without a second `findUnique` round-trip.
   */
  timezone: string;
}

/**
 * List every member visible from the admin dashboard. Includes admins so the
 * admin can see their own row (handy for sanity checks during onboarding).
 *
 * Sort order : `joinedAt DESC` — newest first because that's typically what the
 * admin looks at after sending an invitation.
 */
export async function listMembersForAdmin(): Promise<MemberSummary[]> {
  const rows = await db.user.findMany({
    where: {
      // Soft-deleted users are hidden by default. Reactivating one is a manual
      // DB op for now (no admin UI for it in J3).
      status: { not: 'deleted' },
    },
    orderBy: { joinedAt: 'desc' },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      joinedAt: true,
      lastSeenAt: true,
    },
  });

  if (rows.length === 0) return [];

  // Two bounded `groupBy(['userId'])` (open / closed) — O(members) rows each.
  // A single `groupBy(['userId', 'closedAt'])` would emit ONE row per distinct
  // closedAt timestamp (DateTime, high cardinality), so a member with N closed
  // trades transferred ~N rows. Both queries are covered by the composite
  // @@index([userId, closedAt]).
  const ids = rows.map((r) => r.id);
  const [openCounts, closedCounts] = await Promise.all([
    db.trade.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, closedAt: null },
      _count: { _all: true },
    }),
    db.trade.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, closedAt: { not: null } },
      _count: { _all: true },
    }),
  ]);

  type CountAcc = { open: number; closed: number };
  const byUser = new Map<string, CountAcc>();
  for (const row of openCounts) {
    const acc = byUser.get(row.userId) ?? { open: 0, closed: 0 };
    acc.open += row._count._all;
    byUser.set(row.userId, acc);
  }
  for (const row of closedCounts) {
    const acc = byUser.get(row.userId) ?? { open: 0, closed: 0 };
    acc.closed += row._count._all;
    byUser.set(row.userId, acc);
  }

  return rows.map((row) => {
    const c = byUser.get(row.id) ?? { open: 0, closed: 0 };
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      status: row.status,
      joinedAt: row.joinedAt.toISOString(),
      lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
      tradesCount: c.open + c.closed,
      tradesOpenCount: c.open,
      tradesClosedCount: c.closed,
    };
  });
}

export class MemberNotFoundError extends Error {
  constructor() {
    super('member not found');
    this.name = 'MemberNotFoundError';
  }
}

/**
 * Detail view for a single member (admin tab "Vue d'ensemble").
 *
 * Throws `MemberNotFoundError` for unknown id or soft-deleted users. The page
 * component translates that to a `notFound()` so the route renders the 404.
 */
export async function getMemberDetail(memberId: string): Promise<MemberDetail> {
  const row = await db.user.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      joinedAt: true,
      lastSeenAt: true,
      timezone: true,
    },
  });
  if (!row || row.status === 'deleted') throw new MemberNotFoundError();

  // Aggregate counts + last activity in parallel. Two bounded `count`s (open /
  // closed) rather than a `groupBy(['closedAt'])` — the latter emits one row
  // per distinct closure timestamp (DateTime). Same pattern as
  // `countTradesByStatus`; covered by @@index([userId, closedAt]).
  const [open, closed, lastTrade] = await Promise.all([
    db.trade.count({ where: { userId: memberId, closedAt: null } }),
    db.trade.count({ where: { userId: memberId, closedAt: { not: null } } }),
    db.trade.findFirst({
      where: { userId: memberId },
      orderBy: { enteredAt: 'desc' },
      select: { enteredAt: true },
    }),
  ]);

  const fullName = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();

  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role,
    status: row.status,
    joinedAt: row.joinedAt.toISOString(),
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    tradesCount: open + closed,
    tradesOpenCount: open,
    tradesClosedCount: closed,
    displayName: fullName.length > 0 ? fullName : row.email,
    lastTradeAt: lastTrade?.enteredAt.toISOString() ?? null,
    timezone: row.timezone,
  };
}
