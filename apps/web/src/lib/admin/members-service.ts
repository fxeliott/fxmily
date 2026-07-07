import 'server-only';

import { db } from '@/lib/db';
import type { Prisma } from '@/generated/prisma/client';
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
  /** True when the member has a profile photo — drives the admin photo-takedown
   *  control in the moderation tab (only shown when there is a photo to remove). */
  hasAvatar: boolean;
}

export interface ListMembersForAdminOptions {
  /** Case-insensitive search across firstName / lastName / email. */
  query?: string | undefined;
  limit?: number;
  cursor?: string | undefined;
  /**
   * Tour 13 — restrict the list to members who currently need the admin's
   * attention: a recent uncommented trade/backtest OR an open truth gap. This
   * mirrors the two cohort-wide signals already surfaced by `getCohortAttention`
   * / the per-member badges (`attention-service`), so `/admin/members?attention=1`
   * (a shareable URL, no client state) lands on exactly the rows that call for
   * work. When set, the page's `[joinedAt desc]` order is kept WITHIN the
   * flagged subset (attention rows first, then chronological — the whole list is
   * already "attention", so no cross-bucket reshuffle is needed).
   */
  attentionOnly?: boolean;
}

export interface ListMembersForAdminResult {
  items: MemberSummary[];
  nextCursor: string | null;
}

export interface MemberDirectoryStats {
  total: number;
  active: number;
  suspended: number;
  totalTrades: number;
}

/**
 * Cohort-wide directory stats for the members landing strip. Deliberately
 * INDEPENDENT of the active search / pagination so the totals always reflect
 * the whole non-deleted cohort (the strip is an overview, not a page summary).
 * Two bounded aggregates — never a full member scan.
 */
export async function getMemberDirectoryStats(): Promise<MemberDirectoryStats> {
  const [byStatus, totalTrades] = await Promise.all([
    db.user.groupBy({
      by: ['status'],
      where: { status: { not: 'deleted' } },
      _count: { _all: true },
    }),
    db.trade.count({ where: { user: { status: { not: 'deleted' } } } }),
  ]);

  let total = 0;
  let active = 0;
  let suspended = 0;
  for (const r of byStatus) {
    total += r._count._all;
    if (r.status === 'active') active = r._count._all;
    else if (r.status === 'suspended') suspended = r._count._all;
  }
  return { total, active, suspended, totalTrades };
}

/** Window for "recent" uncommented trades — mirror of `ATTENTION_RECENT_DAYS`
 *  in `attention-service` (kept local so this module stays independent of the
 *  attention loader while sharing the same 14-day meaning). */
const ATTENTION_RECENT_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * Tour 13 — the set of member ids that currently need the admin's attention:
 * a recent (≤14d) uncommented real OR training trade, OR an open truth gap.
 * Cohort-wide, computed with three bounded `groupBy` over indexed columns
 * (`@@index([userId, enteredAt])`, `@@index([memberId, status])`) — the same
 * anti-joins `attention-service` already runs per page, rolled up to a flat id
 * set so the members list can filter on it. Never a full member scan.
 *
 * The `constancyDeclining` signal is deliberately EXCLUDED here: it is a soft
 * per-member snapshot comparison (last two rows) that has no cheap set-level
 * SQL form, and the two hard signals below are the ones the /admin/health links
 * point at. The per-member badges still show the dip on the row itself.
 */
export async function getAttentionMemberIds(): Promise<Set<string>> {
  const recentFloor = new Date(Date.now() - ATTENTION_RECENT_DAYS * DAY_MS);

  const [uncommentedReal, uncommentedTraining, openGaps] = await Promise.all([
    db.trade.groupBy({
      by: ['userId'],
      where: {
        enteredAt: { gte: recentFloor },
        annotations: { none: {} },
        user: { status: { not: 'deleted' } },
      },
      _count: { _all: true },
    }),
    db.trainingTrade.groupBy({
      by: ['userId'],
      where: {
        enteredAt: { gte: recentFloor },
        annotations: { none: {} },
        user: { status: { not: 'deleted' } },
      },
      _count: { _all: true },
    }),
    db.discrepancy.groupBy({
      by: ['memberId'],
      where: { status: 'open', member: { status: { not: 'deleted' } } },
      _count: { _all: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const r of uncommentedReal) ids.add(r.userId);
  for (const r of uncommentedTraining) ids.add(r.userId);
  for (const r of openGaps) ids.add(r.memberId);
  return ids;
}

/**
 * List members for the admin dashboard — cursor-paginated + searchable (S7
 * optimization). Includes admins so the admin sees their own row. Sort order
 * `[joinedAt desc, id desc]` (newest first; the `id` tiebreaker keeps the
 * cursor stable when two members share a `joinedAt`). An optional `query`
 * filters case-insensitively across first name / last name / email so the admin
 * can find a member instantly at cohort scale (30 -> 1000, SPEC §13/§30).
 *
 * Tour 13 — an optional `attentionOnly` restricts the list to the members
 * flagged by `getAttentionMemberIds` (uncommented trades / open gaps), so
 * `?attention=1` is a shareable, back-button-friendly triage view. An empty
 * flagged set short-circuits to an empty page (nobody needs attention).
 *
 * The open/closed trade counts are scoped to the CURRENT page's member ids, so
 * the per-page work stays O(page size) regardless of cohort size.
 */
export async function listMembersForAdmin(
  options: ListMembersForAdminOptions = {},
): Promise<ListMembersForAdminResult> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 50));
  const query = options.query?.trim();

  // Tour 13 — resolve the attention subset BEFORE the page query so it feeds the
  // WHERE as an `id: { in }` filter (kept in the same [joinedAt desc] order +
  // cursor as the unfiltered list). An empty set means "nobody to triage" →
  // return an empty page without touching the users table.
  let attentionIds: string[] | undefined;
  if (options.attentionOnly) {
    const set = await getAttentionMemberIds();
    if (set.size === 0) return { items: [], nextCursor: null };
    attentionIds = [...set];
  }

  // Soft-deleted users are hidden by default. Reactivating one is a manual DB
  // op for now (no admin UI for it).
  const where: Prisma.UserWhereInput = {
    status: { not: 'deleted' },
    ...(attentionIds ? { id: { in: attentionIds } } : {}),
    ...(query
      ? {
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const rows = await db.user.findMany({
    where,
    orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
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

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  if (pageRows.length === 0) return { items: [], nextCursor: null };

  // Two bounded `groupBy(['userId'])` (open / closed) for THIS page's members —
  // O(page size) rows. A `groupBy(['userId', 'closedAt'])` would emit one row
  // per distinct closedAt timestamp (DateTime). Covered by
  // @@index([userId, closedAt]).
  const ids = pageRows.map((r) => r.id);
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

  const items: MemberSummary[] = pageRows.map((row) => {
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

  return {
    items,
    nextCursor: hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
  };
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
      avatarKey: true,
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
    hasAvatar: row.avatarKey !== null,
  };
}
