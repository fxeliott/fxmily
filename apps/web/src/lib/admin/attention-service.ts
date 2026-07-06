import 'server-only';

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
// round-trip. Honest caveat: the cohort-wide sorts (`closedAt asc`,
// `enteredAt asc`, `detectedAt asc`) have NO supporting index — every Trade /
// Discrepancy index is userId/memberId-prefixed — so Postgres scans then sorts
// in memory. Bounded and fine at coaching-cohort scale (tens of members); add
// a cohort-wide index before the cohort outgrows that. `id` is the cursor +
// the sort tiebreaker so a minute-precision timestamp collision can never make
// the cursor skip or repeat a row (same contract as `listMemberTradesAsAdmin`).
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

  const startIndex = cursor ? ordered.findIndex((m) => m.memberId === cursor) + 1 : 0;
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

export interface TriageQueueCounts {
  /** Cohort closed trades with no admin annotation. */
  readonly uncommentedClosed: number;
  /** Cohort trades open longer than `STALE_OPEN_TRADE_HOURS`. */
  readonly staleOpen: number;
  /** Cohort open discrepancies. */
  readonly openDiscrepancies: number;
  /** Cohort members with ≥1 behavioral signal in the last 7 days. */
  readonly behavioralSignals: number;
  /** Sum — the single number the hub card shows. */
  readonly total: number;
}

/**
 * The three section counts for the « À traiter » page + the hub card total.
 * Three bounded counts over indexed columns, run in parallel — cheap enough to
 * call on the hub AND the page without a shared cache (30-member scale).
 */
export async function getTriageQueueCounts(): Promise<TriageQueueCounts> {
  const staleFloor = new Date(Date.now() - STALE_OPEN_TRADE_MS);
  const signalFloor = new Date(Date.now() - BEHAVIORAL_SIGNAL_RECENT_DAYS * DAY_MS);

  const [uncommentedClosed, staleOpen, openDiscrepancies, signalMembers] = await Promise.all([
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
  ]);

  const behavioralSignals = signalMembers.length;

  return {
    uncommentedClosed,
    staleOpen,
    openDiscrepancies,
    behavioralSignals,
    total: uncommentedClosed + staleOpen + openDiscrepancies + behavioralSignals,
  };
}
