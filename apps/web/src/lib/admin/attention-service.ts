import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type { UserStatus } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { isConstancyDip } from '@/lib/admin/attention-logic';
import { STALE_OPEN_TRADE_HOURS, STALE_OPEN_TRADE_MS } from '@/lib/trades/stale-open-threshold';

/**
 * S7 §33-#2 — admin "à traiter" triage signals for the global members view.
 *
 * Surfaces, per member, what calls for the admin's attention so nobody is
 * forgotten: recent trades/backtests not yet commented, OPEN truth gaps
 * (S3 discrepancies), and a constancy score that has dipped. The admin sees
 * where to focus at a glance — calm coaching signal, never a punitive verdict
 * (SPEC §2).
 *
 * **Trust boundary** : like `members-service`, every function assumes the caller
 * is an authenticated admin. The page / proxy gate `/admin/*` upstream.
 *
 * Performance: the per-page loader is batched on the current page's member ids
 * (≤ 50) — bounded `findMany`/`groupBy` over indexed columns
 * (`@@index([memberId, status])`, `@@index([userId, enteredAt])`,
 * `@@index([memberId, computedAt])`). The cohort summary uses 3 bounded counts.
 */

const DAY_MS = 86_400_000;

/** Window for "recent" uncommented trades — what just happened and needs eyes. */
export const ATTENTION_RECENT_DAYS = 14;

/** How far back we read constancy snapshots to judge a recent dip. */
const CONSTANCY_DECLINE_LOOKBACK_DAYS = 70;

/**
 * A member is "disengaged" (en décrochage) when they are active but have not
 * been seen for this long. 7 days is the same recency horizon the
 * behavioral-signal section uses — long enough not to flag a member merely
 * taking a weekend off, short enough that a real disengagement surfaces within
 * the week. SINGLE SOURCE OF TRUTH: `daily-brief.ts` imports this constant +
 * `disengagedMembersWhere` (just wrapped in a `count()`) so the morning email
 * counter can never drift from the `/admin/a-traiter` list + its badge.
 */
export const DISENGAGED_AFTER_MS = 7 * DAY_MS;

/**
 * The cohort-wide "disengaged member" predicate, as a reusable Prisma
 * where-fragment. A member is drifting when they are active, never soft-deleted,
 * and either last seen before `floor` OR never seen at all while having joined
 * before `floor` (a brand-new member with no session yet is NOT drifting — they
 * just arrived). The caller computes `floor` from its own clock — the daily
 * brief from `options.now`, the triage list/count from `Date.now()` — which is
 * the only thing that legitimately differs between callers; the PREDICATE itself
 * lives here once (`daily-brief.ts` reuses it verbatim in a `count()`).
 */
export function disengagedMembersWhere(floor: Date): Prisma.UserWhereInput {
  return {
    status: 'active',
    deletedAt: null,
    OR: [{ lastSeenAt: { lt: floor } }, { lastSeenAt: null, joinedAt: { lt: floor } }],
  };
}

/**
 * The single-member mirror of `disengagedMembersWhere`, for surfaces that
 * already hold the member row in memory (the member-fiche synthesis banner) and
 * must not re-query the cohort just to learn one member's status. Same rule,
 * single-sourced: active AND (last seen before the 7-day floor OR never seen
 * while joined before it). `now` is a parameter (default = wall clock) so the
 * clock lives here, in the service, and callers — including React Server
 * Components — stay pure (no `Date.now()` in a render body). A deleted member
 * never reaches this (the members-service throws first), so the `active` check
 * is sufficient without re-testing `deletedAt`.
 */
export function isMemberDisengaged(
  member: { status: UserStatus; lastSeenAt: string | Date | null; joinedAt: string | Date },
  now: number = Date.now(),
): boolean {
  if (member.status !== 'active') return false;
  const floorMs = now - DISENGAGED_AFTER_MS;
  const lastSeenMs = member.lastSeenAt !== null ? new Date(member.lastSeenAt).getTime() : null;
  return lastSeenMs !== null ? lastSeenMs < floorMs : new Date(member.joinedAt).getTime() < floorMs;
}

export interface MemberAttention {
  /** Recent real + training trades with no admin correction yet. */
  tradesToComment: number;
  /** Open truth gaps (S3 discrepancies) awaiting acknowledgement/resolution. */
  openDiscrepancies: number;
  /** Latest constancy snapshot dropped vs the previous one (sustained-dip hint). */
  constancyDeclining: boolean;
}

const EMPTY_ATTENTION: MemberAttention = {
  tradesToComment: 0,
  openDiscrepancies: 0,
  constancyDeclining: false,
};

/**
 * Batched attention flags for a page of members. Returns a Map keyed by member
 * id; ids with nothing pending still get a zeroed entry so the caller can render
 * a calm "à jour" state without a second lookup.
 */
export async function getMembersAttention(ids: string[]): Promise<Map<string, MemberAttention>> {
  const result = new Map<string, MemberAttention>();
  if (ids.length === 0) return result;
  for (const id of ids) result.set(id, { ...EMPTY_ATTENTION });

  const recentFloor = new Date(Date.now() - ATTENTION_RECENT_DAYS * DAY_MS);
  const constancyFloor = new Date(Date.now() - CONSTANCY_DECLINE_LOOKBACK_DAYS * DAY_MS);

  const [uncommentedReal, uncommentedTraining, openByMember, constancyRows] = await Promise.all([
    // RC#7 PERF-2 — count uncommented trades with groupBy/_count (one row per
    // member, count pushed to Postgres) instead of findMany returning one row
    // PER trade just to length-count it in Node. Mirrors the openByMember
    // groupBy below; the @@index([userId, enteredAt]) serves the anti-join
    // identically, so this is strictly cheaper on row transfer.
    db.trade.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, enteredAt: { gte: recentFloor }, annotations: { none: {} } },
      _count: { _all: true },
    }),
    db.trainingTrade.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, enteredAt: { gte: recentFloor }, annotations: { none: {} } },
      _count: { _all: true },
    }),
    db.discrepancy.groupBy({
      by: ['memberId'],
      where: { memberId: { in: ids }, status: 'open' },
      _count: { _all: true },
    }),
    db.constancyScore.findMany({
      where: { memberId: { in: ids }, periodStart: { gte: constancyFloor } },
      orderBy: [{ memberId: 'asc' }, { periodStart: 'desc' }],
      select: { memberId: true, value: true },
    }),
  ]);

  for (const row of uncommentedReal) {
    const acc = result.get(row.userId);
    if (acc) acc.tradesToComment += row._count._all;
  }
  for (const row of uncommentedTraining) {
    const acc = result.get(row.userId);
    if (acc) acc.tradesToComment += row._count._all;
  }
  for (const row of openByMember) {
    const acc = result.get(row.memberId);
    if (acc) acc.openDiscrepancies = row._count._all;
  }

  // constancyRows are memberId-grouped, periodStart DESC → the first two per
  // member are its latest + previous snapshot. The dip is defined vs the
  // IMMEDIATELY-previous snapshot only; any older snapshots in the window are
  // ignored. `comparedPrev` enforces that "compare once" contract — the bare
  // `latestSeen` map alone could not, because a member with ≥ 3 snapshots would
  // otherwise keep comparing its latest value against every older snapshot
  // (false "constance en baisse" whenever the latest sits below an earlier peak).
  const latestSeen = new Map<string, number>();
  const comparedPrev = new Set<string>();
  for (const row of constancyRows) {
    const acc = result.get(row.memberId);
    if (!acc) continue;
    const latest = latestSeen.get(row.memberId);
    if (latest === undefined) {
      latestSeen.set(row.memberId, row.value); // this is the LATEST (DESC order)
    } else if (!comparedPrev.has(row.memberId)) {
      // exactly the PREVIOUS snapshot → compare once, then ignore older rows.
      // `latest` = latest value, `row.value` = previous value → a dip is
      // "previous − latest ≥ MIN" (single source of truth in attention-logic).
      comparedPrev.add(row.memberId);
      acc.constancyDeclining = isConstancyDip(latest, row.value);
    }
  }

  return result;
}

export interface CohortAttention {
  /** Recent real + training trades across the whole live cohort with no correction. */
  tradesToComment: number;
  /** Open truth gaps across the whole live cohort. */
  openDiscrepancies: number;
}

/**
 * Cohort-wide triage totals for the members landing strip — independent of the
 * current search/page (the strip is an overview). Three bounded counts.
 */
export async function getCohortAttention(): Promise<CohortAttention> {
  const recentFloor = new Date(Date.now() - ATTENTION_RECENT_DAYS * DAY_MS);

  const [realToComment, trainingToComment, openDiscrepancies] = await Promise.all([
    db.trade.count({
      where: {
        enteredAt: { gte: recentFloor },
        annotations: { none: {} },
        user: { status: { not: 'deleted' } },
      },
    }),
    db.trainingTrade.count({
      where: {
        enteredAt: { gte: recentFloor },
        annotations: { none: {} },
        user: { status: { not: 'deleted' } },
      },
    }),
    db.discrepancy.count({
      where: { status: 'open', member: { status: { not: 'deleted' } } },
    }),
  ]);

  return { tradesToComment: realToComment + trainingToComment, openDiscrepancies };
}

// =============================================================================
// Tour 13 — « À traiter » : cohort-wide work queue for the coach.
//
// `getMembersAttention` / `getCohortAttention` above give COUNTS per member and
// for the cohort. They answer "who needs a look and how much" but never "which
// exact rows, so I can act on them one after another". The coach was left with a
// number, then had to open each member, find the tab, and page through to reach
// the trade — 4 clicks per item. These loaders return the cohort-wide LISTS
// themselves, oldest-first (the natural work order), each row already carrying
// the direct link target the page needs. Cursor-paginated so the queue can grow
// with the cohort without ever loading it whole.
//
// Performance: every read is a bounded `findMany` (take = limit + 1 look-ahead)
// joined to a thin member `select` (id + name parts) — no N+1, no per-row
// round-trip. Each cohort-wide sort is now served by a dedicated cohort-wide
// index added in this branch: `closedAt asc` by `trades_closed_at_id_idx`,
// the open-trade `enteredAt asc` (filtered `closedAt IS NULL`) by
// `trades_closed_at_entered_at_id_idx`, and `detectedAt asc` (filtered
// `status = 'open'`) by `discrepancies_status_detected_at_id_idx` — so Postgres
// walks the index in sort order instead of scanning then sorting the cohort in
// memory. `id` is the cursor + the sort tiebreaker so a minute-precision
// timestamp collision can never make the cursor skip or repeat a row (same
// contract as `listMemberTradesAsAdmin`).
// =============================================================================

// Threshold shared with the member-side reminder — single source of truth in
// `lib/trades/stale-open-threshold.ts` (same number, same strict comparator).
// Re-exported because the page + tests read it from this module.
export { STALE_OPEN_TRADE_HOURS };

/** Page size for every triage list — one screenful, "voir plus" for the rest. */
export const TRIAGE_PAGE_SIZE = 25;

/** Cuids only — a forged `?cursor=` must degrade to page 1, never to a 500
 *  (mirror of the member-detail page `parseCursor`). */
function isValidCursor(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-z0-9]{20,40}$/i.test(value);
}

/** Clamp the caller-provided limit into a sane bounded range. */
function clampLimit(limit: number | undefined): number {
  return Math.min(TRIAGE_PAGE_SIZE, Math.max(1, limit ?? TRIAGE_PAGE_SIZE));
}

export interface TriageListOptions {
  /** Page size (defaults to `TRIAGE_PAGE_SIZE`, clamped to it). */
  limit?: number | undefined;
  /** Opaque cursor from a previous page's `nextCursor` (a real row id).
   *  `| undefined` explicit for `exactOptionalPropertyTypes` — mirror of
   *  `ListTradesOptions.cursor` so callers can pass a `string | undefined`. */
  cursor?: string | undefined;
}

export interface TriagePage<T> {
  readonly items: readonly T[];
  /** Id of the next page, or null on the last page. */
  readonly nextCursor: string | null;
}

/** Derive the same admin display label as `members-service` (full name, else
 *  email) from the thin name projection we select on each row. */
function memberLabel(user: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return fullName.length > 0 ? fullName : user.email;
}

const MEMBER_LABEL_SELECT = {
  select: { id: true, firstName: true, lastName: true, email: true },
} as const;

export interface UncommentedTradeItem {
  /** Trade id — also the cursor and the deep-link target segment. */
  readonly id: string;
  readonly memberId: string;
  readonly memberLabel: string;
  readonly pair: string;
  readonly direction: 'long' | 'short';
  /** When the member closed it (this list is closed-only, so never null). */
  readonly closedAt: string;
  /** Realized result in R, or null if the member never filled it. */
  readonly realizedR: number | null;
  /** Direct link to the admin trade-review surface where the coach annotates. */
  readonly href: string;
}

/**
 * Cohort-wide closed trades with NO admin annotation yet, oldest close first —
 * the coach's "comment these" queue. A closed trade is a finished story the
 * member is waiting for feedback on; ordering by `closedAt asc` means the coach
 * clears the longest-waiting ones first (SPEC §2 : timely, calm follow-up).
 *
 * Scope note (vs `getCohortAttention.tradesToComment`) : the count above is the
 * RECENT (14 d) uncommented real + training trades — a "what just happened"
 * teaser. This queue is deliberately different : it lists every CLOSED real
 * trade still uncommented with no recency floor, because a to-do list must not
 * hide the oldest item just because two weeks passed. Training backtests are
 * left out — their annotation surface is a separate tab and the mission scopes
 * this section to "trades clôturés".
 */
export async function listUncommentedClosedTrades(
  options: TriageListOptions = {},
): Promise<TriagePage<UncommentedTradeItem>> {
  const limit = clampLimit(options.limit);
  const cursor = isValidCursor(options.cursor) ? options.cursor : undefined;

  const rows = await db.trade.findMany({
    where: {
      closedAt: { not: null },
      annotations: { none: {} },
      user: { status: { not: 'deleted' } },
    },
    // Oldest close first; `id` tiebreaks the non-unique minute-precision stamp.
    orderBy: [{ closedAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      pair: true,
      direction: true,
      closedAt: true,
      realizedR: true,
      user: MEMBER_LABEL_SELECT,
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((t) => ({
      id: t.id,
      memberId: t.user.id,
      memberLabel: memberLabel(t.user),
      pair: t.pair,
      direction: t.direction,
      // `closedAt` is guaranteed non-null by the `{ not: null }` filter.
      closedAt: t.closedAt!.toISOString(),
      realizedR: t.realizedR === null ? null : Number(t.realizedR),
      href: `/admin/members/${t.user.id}/trades/${t.id}`,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export interface StaleOpenTradeItem {
  readonly id: string;
  readonly memberId: string;
  readonly memberLabel: string;
  readonly pair: string;
  readonly direction: 'long' | 'short';
  /** When the member opened it (this list is open-only, so always set). */
  readonly enteredAt: string;
  /** Direct link to the admin trade-review surface. */
  readonly href: string;
}

/**
 * Cohort-wide trades still OPEN more than `STALE_OPEN_TRADE_HOURS` after entry,
 * oldest entry first. Pure safety-net : with no close the member never answered
 * `exitReason` / `planRespected`, so the trade vanishes from the scored views in
 * silence. Surfacing it lets the coach gently prompt a close — never punitive,
 * a forgotten open position is an oversight, not a fault (SPEC §2).
 *
 * Reads only existing timestamps (`enteredAt`, `closedAt`) — zero migration.
 */
export async function listStaleOpenTrades(
  options: TriageListOptions = {},
): Promise<TriagePage<StaleOpenTradeItem>> {
  const limit = clampLimit(options.limit);
  const cursor = isValidCursor(options.cursor) ? options.cursor : undefined;
  const staleFloor = new Date(Date.now() - STALE_OPEN_TRADE_MS);

  const rows = await db.trade.findMany({
    where: {
      closedAt: null,
      enteredAt: { lt: staleFloor },
      user: { status: { not: 'deleted' } },
    },
    orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      pair: true,
      direction: true,
      enteredAt: true,
      user: MEMBER_LABEL_SELECT,
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((t) => ({
      id: t.id,
      memberId: t.user.id,
      memberLabel: memberLabel(t.user),
      pair: t.pair,
      direction: t.direction,
      enteredAt: t.enteredAt.toISOString(),
      href: `/admin/members/${t.user.id}/trades/${t.id}`,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** §2-clean labels for each gap type (mirror of the member-verification panel —
 *  duplicated as plain strings, not imported, to keep this server module free of
 *  a client-component dependency). */
const DISCREPANCY_TYPE_LABEL: Record<
  | 'missing_declared'
  | 'false_declared'
  | 'mismatch'
  | 'unfilled_no_reason'
  | 'meeting_missed_no_reason'
  | 'tracking_skipped_no_reason',
  string
> = {
  missing_declared: 'Position réelle non déclarée',
  false_declared: 'Trade déclaré sans contrepartie',
  mismatch: 'Écart de taille',
  unfilled_no_reason: 'Journée sans suivi',
  meeting_missed_no_reason: 'Réunion manquée',
  tracking_skipped_no_reason: 'Outil de suivi laissé de côté',
};

export interface OpenDiscrepancyItem {
  readonly id: string;
  readonly memberId: string;
  readonly memberLabel: string;
  /** Human §2-clean label for the gap type. */
  readonly label: string;
  /** 1 = minor, 2 = notable, 3 = major (display/sort signal only). */
  readonly severity: number;
  readonly detectedAt: string;
  /** Direct link to the member's « réalité vs déclaré » tab where it's handled. */
  readonly href: string;
}

/**
 * Cohort-wide OPEN discrepancies (S3 truth gaps), oldest detection first — the
 * gaps waiting the longest for the coach's eyes come up first. Reuses the
 * existing `status: 'open'` signal (never recomputed) and joins the thin member
 * label. Each row links to the member's verification tab, the real surface where
 * an écart is acknowledged / resolved.
 */
export async function listOpenDiscrepancies(
  options: TriageListOptions = {},
): Promise<TriagePage<OpenDiscrepancyItem>> {
  const limit = clampLimit(options.limit);
  const cursor = isValidCursor(options.cursor) ? options.cursor : undefined;

  const rows = await db.discrepancy.findMany({
    where: { status: 'open', member: { status: { not: 'deleted' } } },
    orderBy: [{ detectedAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      type: true,
      severity: true,
      detectedAt: true,
      member: MEMBER_LABEL_SELECT,
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((d) => ({
      id: d.id,
      memberId: d.member.id,
      memberLabel: memberLabel(d.member),
      label: DISCREPANCY_TYPE_LABEL[d.type],
      severity: d.severity,
      detectedAt: d.detectedAt.toISOString(),
      href: `/admin/members/${d.member.id}?tab=verification`,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

// =============================================================================
// Tour 15 — « Signaux comportementaux » : the coach reads the behavioral signals
// the AI already detected, grouped per member.
//
// The J7 Mark Douglas engine already stores, for every card pushed to a member,
// the human FR label of the behavioral pattern that triggered it
// (`MarkDouglasDelivery.triggeredBy`, e.g. « 3 trades perdants consécutifs sur
// 24h »). That signal was surfaced to the MEMBER but never to the COACH's work
// queue — so a live emotional/discipline signal (revenge trading, over-sizing,
// a constancy dip already flagged) sat in the DB while the coach had to open
// each member to notice it. This section reads those STORED signals back,
// grouped per member, with ZERO new computation (no scan, no scoring — the
// almost-free path the audit called for). Each row links straight to the member
// fiche where the coach already has « semer un objectif » / « Renforcer ».
//
// Window : the last 7 days (recent enough that the signal is still actionable).
//
// Performance / honest caveat : unlike the three row-paginated sections above,
// this one GROUPS by member, so it reads the deliveries of the last 7 days once
// (a bounded cohort-wide scan: the `@@index([userId, createdAt])` has userId
// first, so a createdAt-only filter cannot use it — acceptable because the
// window is 7 days × a coaching-size cohort) and folds them into one entry per
// member in memory,
// then paginates the MEMBERS by a memberId cursor. Bounded and fine at
// coaching-cohort scale (tens of members). A delivery id could not be the cursor
// here (the unit is a member, not a delivery), so the cursor is the member id;
// members are ordered by their most-recent signal first (the natural attention
// order), memberId tiebreaking a same-instant collision so the cursor can never
// skip or repeat a member.
// =============================================================================

/** Window for "recent" behavioral signals surfaced to the coach. */
export const BEHAVIORAL_SIGNAL_RECENT_DAYS = 7;

export interface BehavioralSignalItem {
  /** Member id — also the cursor and the deep-link target segment. */
  readonly id: string;
  readonly memberLabel: string;
  /** Distinct recent signal labels (`triggeredBy`), most-recent first, deduped. */
  readonly signals: readonly string[];
  /** ISO instant of this member's most recent signal (drives the ordering + meta). */
  readonly latestAt: string;
  /** How many deliveries fed this member's signals over the window (context). */
  readonly signalCount: number;
  /** Direct link to the member fiche where the coach already has the actions. */
  readonly href: string;
}

/**
 * Cohort-wide behavioral signals of the last `BEHAVIORAL_SIGNAL_RECENT_DAYS`
 * days, GROUPED per member, most-recent signal first. Pure read of the already
 * stored `MarkDouglasDelivery.triggeredBy` labels — never a new scan/score.
 * Members are the pagination unit (one row = one member); `cursor` is a member
 * id from a previous page's `nextCursor`.
 */
export async function listRecentBehavioralSignals(
  options: TriageListOptions = {},
): Promise<TriagePage<BehavioralSignalItem>> {
  const limit = clampLimit(options.limit);
  const cursor = isValidCursor(options.cursor) ? options.cursor : undefined;
  const recentFloor = new Date(Date.now() - BEHAVIORAL_SIGNAL_RECENT_DAYS * DAY_MS);

  // Read the window's deliveries once (bounded), newest first. `id` DESC breaks a
  // same-`createdAt` tie deterministically so the in-memory fold is stable.
  const rows = await db.markDouglasDelivery.findMany({
    where: {
      createdAt: { gte: recentFloor },
      user: { status: { not: 'deleted' } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      triggeredBy: true,
      createdAt: true,
      user: MEMBER_LABEL_SELECT,
    },
  });

  // Fold into one accumulator per member. Rows arrive newest-first, so the first
  // time a member is seen is its latest signal, and pushing labels in arrival
  // order keeps `signals` most-recent-first; a Set dedupes repeats of the same
  // pattern (« 3 trades perdants… » fired twice this week shows once).
  interface Acc {
    memberId: string;
    memberLabel: string;
    signals: string[];
    seen: Set<string>;
    latestAt: Date;
    signalCount: number;
  }
  const byMember = new Map<string, Acc>();
  for (const row of rows) {
    const memberId = row.user.id;
    let acc = byMember.get(memberId);
    if (!acc) {
      acc = {
        memberId,
        memberLabel: memberLabel(row.user),
        signals: [],
        seen: new Set(),
        latestAt: row.createdAt, // rows are DESC → first seen = latest
        signalCount: 0,
      };
      byMember.set(memberId, acc);
    }
    acc.signalCount += 1;
    if (!acc.seen.has(row.triggeredBy)) {
      acc.seen.add(row.triggeredBy);
      acc.signals.push(row.triggeredBy);
    }
  }

  // Order members by their most-recent signal first, memberId tiebreaking a
  // same-instant collision (stable cursor). Then apply the memberId cursor +
  // look-ahead the same way the row-paginated sections do.
  const ordered = Array.from(byMember.values()).sort((a, b) => {
    const delta = b.latestAt.getTime() - a.latestAt.getTime();
    return delta !== 0 ? delta : a.memberId.localeCompare(b.memberId);
  });

  // A cursor that fell out of the recalculated 7-day window (its member's last
  // signal aged past `recentFloor`, or the member was deleted between two "voir
  // plus" clicks) is no longer in `ordered`: `findIndex` → -1 would make
  // `startIndex` 0 and SILENTLY re-serve page 1 (duplicates). Return an empty
  // terminal page instead — the same "cursor gone ⇒ empty page" contract the
  // row-paginated sections get from Prisma's native `cursor`/`skip`.
  const cursorIndex = cursor ? ordered.findIndex((m) => m.memberId === cursor) : -1;
  if (cursor && cursorIndex === -1) {
    return { items: [], nextCursor: null };
  }
  const startIndex = cursor ? cursorIndex + 1 : 0;
  const window = ordered.slice(startIndex, startIndex + limit + 1);
  const hasMore = window.length > limit;
  const page = hasMore ? window.slice(0, limit) : window;

  return {
    items: page.map((m) => ({
      id: m.memberId,
      memberLabel: m.memberLabel,
      signals: m.signals,
      latestAt: m.latestAt.toISOString(),
      signalCount: m.signalCount,
      href: `/admin/members/${m.memberId}`,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.memberId ?? null) : null,
  };
}

// =============================================================================
// J6 — « Membres en décrochage » : cohort-wide list of active members drifting
// away — the coach's "who to call this week" queue.
//
// `daily-brief.ts` already COUNTS these members (the morning email badge). This
// loader returns the LIST itself — same members, same predicate
// (`disengagedMembersWhere`, single-sourced), so the counter, the list and the
// `/admin/a-traiter` badge can never disagree. Ordered by `lastSeenAt asc NULLS
// FIRST` then `id asc`: the longest-silent members surface first, and the
// never-seen new joiners (null `lastSeenAt`, joined before the floor) sit at the
// very top — the natural outreach order. Each row links straight to the member
// fiche where the coach reaches out.
//
// Performance: a bounded `findMany` (take = limit + 1 look-ahead) served by the
// `@@index([status, deletedAt, lastSeenAt])` added in this branch — the
// `status = 'active' AND deletedAt IS NULL` equality prefix + `lastSeenAt` sort
// column let Postgres walk the index in order instead of scanning the members
// table.
//
// Pagination: a COMPOSITE keyset cursor `(lastSeenAt, id)`, NOT a bare id.
// `lastSeenAt` is MUTABLE — rewritten on every credential login — so a Prisma
// `cursor: { id }, skip: 1` seek (which re-reads the cursor row's CURRENT
// `lastSeenAt` to build the page-2 boundary) would shift that boundary the
// moment the cursor member logs back in, silently skipping every member between
// the old and new stamp. We instead carry BOTH sort keys in an opaque base64url
// token and build the keyset predicate BY HAND against the captured values, so
// the boundary is frozen at the page-1 render and can never skip or repeat a
// member. `id` stays the tiebreaker for the nullable, non-unique `lastSeenAt`.
// =============================================================================

export interface DisengagedMemberItem {
  /** Member id — also the cursor and the deep-link target segment. */
  readonly id: string;
  readonly memberLabel: string;
  /** When the member was last seen, or null if never seen since joining. */
  readonly lastSeenAt: string | null;
  /** When the member joined (shown when `lastSeenAt` is null). */
  readonly joinedAt: string;
  /** Direct link to the member fiche where the coach reaches out. */
  readonly href: string;
}

/** The decoded composite cursor — both sort keys captured at page-1 render. */
interface DisengagedCursor {
  readonly lastSeenAt: Date | null;
  readonly id: string;
}

/** Encode the composite cursor as an opaque base64url token (`<iso>|<id>`, an
 *  empty `<iso>` meaning a never-seen member). Both sort keys travel WITH the
 *  cursor so the page-2 boundary is frozen — see the section header for why a
 *  bare-id Prisma seek is unsafe on the mutable `lastSeenAt`. */
function encodeDisengagedCursor(lastSeenAt: Date | null, id: string): string {
  const stamp = lastSeenAt === null ? '' : lastSeenAt.toISOString();
  return Buffer.from(`${stamp}|${id}`, 'utf8').toString('base64url');
}

/** Decode + STRICTLY validate a composite cursor token. A forged / malformed
 *  token returns null so the caller degrades to page 1 (never a 500, never a
 *  wrong boundary): the id must be cuid-shaped and a non-empty stamp must be a
 *  canonical ISO date (re-serialization has to round-trip). */
function decodeDisengagedCursor(token: string | undefined): DisengagedCursor | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf('|');
  if (sep === -1) return null;
  const stamp = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!/^[a-z0-9]{20,40}$/i.test(id)) return null;
  if (stamp === '') return { lastSeenAt: null, id };
  const ms = Date.parse(stamp);
  // A legit stamp is always `Date#toISOString()`; reject anything non-canonical
  // so a forged token can't smuggle an ambiguous date into the keyset.
  if (Number.isNaN(ms) || new Date(ms).toISOString() !== stamp) return null;
  return { lastSeenAt: new Date(ms), id };
}

/**
 * The keyset boundary for the NEXT page under `lastSeenAt asc NULLS FIRST, id
 * asc`: every member sorting strictly AFTER the cursor row. Built by hand (not
 * Prisma's `cursor`/`skip`) against the CAPTURED cursor values so a rewrite of
 * the cursor member's mutable `lastSeenAt` can never move the boundary.
 */
function disengagedKeysetWhere(cursor: DisengagedCursor): Prisma.UserWhereInput {
  if (cursor.lastSeenAt === null) {
    // Cursor is in the NULLS-FIRST bucket: advance within the null bucket by id,
    // then let EVERY non-null row through (they all sort after the nulls).
    return {
      OR: [{ lastSeenAt: null, id: { gt: cursor.id } }, { lastSeenAt: { not: null } }],
    };
  }
  // Cursor has a stamp: a strictly greater stamp, or the same stamp with a
  // greater id. Null-bucket rows sort BEFORE it (SQL `NULL > x` is unknown), so
  // Prisma's `gt` correctly excludes them.
  return {
    OR: [
      { lastSeenAt: { gt: cursor.lastSeenAt } },
      { lastSeenAt: cursor.lastSeenAt, id: { gt: cursor.id } },
    ],
  };
}

/**
 * Cohort-wide active members not seen for ≥ `DISENGAGED_AFTER_MS`, longest
 * silence first. Reuses the SAME predicate as the daily-brief counter
 * (`disengagedMembersWhere`) so the list, the `/admin/a-traiter` badge and the
 * morning email can never drift. `lastSeenAt asc NULLS FIRST` puts the
 * never-seen new joiners (null `lastSeenAt`, joined before the floor) at the
 * very top — the most at-risk of silently churning.
 *
 * Paginated with a COMPOSITE `(lastSeenAt, id)` keyset cursor, NOT a bare id:
 * `lastSeenAt` is mutable (rewritten on login), so a Prisma `cursor`/`skip` seek
 * would drift the page-2 boundary when the cursor member logs back in. The token
 * carries both keys and the boundary is a hand-built `where` frozen at page 1,
 * so it can never skip or repeat a member (see the section header).
 */
export async function listDisengagedMembers(
  options: TriageListOptions = {},
): Promise<TriagePage<DisengagedMemberItem>> {
  const limit = clampLimit(options.limit);
  const cursor = decodeDisengagedCursor(options.cursor);
  const floor = new Date(Date.now() - DISENGAGED_AFTER_MS);
  const predicate = disengagedMembersWhere(floor);

  const rows = await db.user.findMany({
    // A valid cursor ANDs a frozen keyset boundary onto the shared predicate; a
    // missing / forged one just serves page 1 (the predicate alone).
    where: cursor ? { AND: [predicate, disengagedKeysetWhere(cursor)] } : predicate,
    // Longest silence first; `lastSeenAt` is nullable so NULLS FIRST surfaces the
    // never-seen new joiners at the top. `id` tiebreaks the non-unique stamp.
    orderBy: [{ lastSeenAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: limit + 1,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      lastSeenAt: true,
      joinedAt: true,
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((u) => ({
      id: u.id,
      memberLabel: memberLabel(u),
      lastSeenAt: u.lastSeenAt === null ? null : u.lastSeenAt.toISOString(),
      joinedAt: u.joinedAt.toISOString(),
      href: `/admin/members/${u.id}`,
    })),
    // The next boundary is the last visible row's COMPOSITE key, so page 2 seeks
    // from exactly here regardless of any later `lastSeenAt` rewrite.
    nextCursor: hasMore && last ? encodeDisengagedCursor(last.lastSeenAt, last.id) : null,
  };
}

export interface TriageQueueCounts {
  /** Cohort closed trades with no admin annotation. */
  readonly uncommentedClosed: number;
  /** Cohort trades open longer than `STALE_OPEN_TRADE_HOURS`. */
  readonly staleOpen: number;
  /** Cohort open discrepancies. */
  readonly openDiscrepancies: number;
  /** Cohort members with ≥1 behavioral signal in the last 7 days. */
  readonly behavioralSignals: number;
  /** Cohort active members not seen for ≥ `DISENGAGED_AFTER_MS` (drifting away). */
  readonly disengagedMembers: number;
  /** Sum — the single number the hub card shows. */
  readonly total: number;
}

/**
 * The section counts for the « À traiter » page + the hub card total. Bounded
 * counts over indexed columns, run in parallel — cheap enough to call on the hub
 * AND the page without a shared cache (30-member scale).
 */
export async function getTriageQueueCounts(): Promise<TriageQueueCounts> {
  const staleFloor = new Date(Date.now() - STALE_OPEN_TRADE_MS);
  const signalFloor = new Date(Date.now() - BEHAVIORAL_SIGNAL_RECENT_DAYS * DAY_MS);
  const disengagedFloor = new Date(Date.now() - DISENGAGED_AFTER_MS);

  const [uncommentedClosed, staleOpen, openDiscrepancies, signalMembers, disengagedMembers] =
    await Promise.all([
      db.trade.count({
        where: {
          closedAt: { not: null },
          annotations: { none: {} },
          user: { status: { not: 'deleted' } },
        },
      }),
      db.trade.count({
        where: {
          closedAt: null,
          enteredAt: { lt: staleFloor },
          user: { status: { not: 'deleted' } },
        },
      }),
      db.discrepancy.count({
        where: { status: 'open', member: { status: { not: 'deleted' } } },
      }),
      // Behavioral-signal count = number of DISTINCT members with ≥1 delivery in the
      // last 7 days (the section lists one row per member, so its badge counts
      // members, not deliveries). `groupBy(['userId'])` over the same window +
      // non-deleted filter as the loader; `.length` of the grouped rows = distinct
      // members (served by @@index([userId, createdAt])).
      db.markDouglasDelivery.groupBy({
        by: ['userId'],
        where: {
          createdAt: { gte: signalFloor },
          user: { status: { not: 'deleted' } },
        },
      }),
      // Disengaged-member count = same predicate as `listDisengagedMembers` +
      // the daily-brief counter (`disengagedMembersWhere`, single-sourced) so the
      // badge, the list and the morning email can never disagree.
      db.user.count({ where: disengagedMembersWhere(disengagedFloor) }),
    ]);

  const behavioralSignals = signalMembers.length;

  return {
    uncommentedClosed,
    staleOpen,
    openDiscrepancies,
    behavioralSignals,
    disengagedMembers,
    total:
      uncommentedClosed + staleOpen + openDiscrepancies + behavioralSignals + disengagedMembers,
  };
}
