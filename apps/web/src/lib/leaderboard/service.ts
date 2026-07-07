import 'server-only';

import { cache } from 'react';

import {
  localDateOf,
  parseLocalDate,
  shiftLocalDate,
  type LocalDateString,
} from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';
import { getLatestBehavioralScore } from '@/lib/scoring/service';
import { selectStorage } from '@/lib/storage';
import { getTrackingCoverage } from '@/lib/tracking/service';
import { getLatestConstancyScore } from '@/lib/verification/constancy';

import { computeLeaderboardScore, LEADERBOARD_WINDOW_DAYS, preciseScoreFromParts } from './builder';
import {
  computeRankMovement,
  countActivePillars,
  podiumThresholdScore,
  rankEntries,
  type RankableEntry,
  type RankDirection,
  type RankMovement,
} from './ranking';
import {
  asLeaderboardInputJson,
  type LeaderboardComponentsJson,
  type LeaderboardSampleSizeJson,
  type LeaderboardScore,
  type LeaderboardScoreInput,
} from './types';

/**
 * Leaderboard service layer (SPEC §2 posture — rank the ACT, never the P&L).
 *
 * The board is a NIGHTLY snapshot, computed by the `recompute-leaderboard` cron
 * right AFTER `recompute-scores` (so every member's `BehavioralScore` is fresh).
 * It reuses the already-computed act surfaces — behavioral engagement/discipline
 * dimensions, the ConstancyScore regularity axis, the tracking-coverage gauge —
 * so it re-queries NOTHING that scoring already derived (activeDays + streak are
 * read straight off the fresh behavioral snapshot).
 *
 * 🔒 Firewall §21.5: the `consistency` (P&L-proxy) dimension is NEVER read here.
 * Enforced by `test/anti-leak/leaderboard-isolation.test.ts`.
 */

/** Canonical board timezone — the rank is a cross-member comparison for ONE
 * civil day, so it is anchored in a single TZ (V1: every member is Europe/Paris). */
const LEADERBOARD_TZ = 'Europe/Paris';

/** Bounded concurrency for the nightly gather — mirrors the scoring cron (25). */
const BATCH_SIZE = 25;

// =============================================================================
// Per-member gather (I/O) — reuses already-computed act surfaces
// =============================================================================

interface GatheredMember {
  input: LeaderboardScoreInput;
  /** Raw streak (tie-break) read off the fresh behavioral snapshot. */
  streak: number;
}

/**
 * Assemble one member's four pillar inputs from surfaces already computed by the
 * scoring / constancy / tracking layers. Zero re-derivation: activeDays + streak
 * are read from the latest `BehavioralScore` (`sampleSize.checkins.days` and
 * `components.engagement.parts.streakNormalized.numerator`). A member with no
 * behavioral snapshot yet (brand-new) yields activeDays 0 → insufficient_data.
 */
async function gatherMember(
  userId: string,
  now: Date,
  windowStartUtc: Date,
  windowEndUtc: Date,
): Promise<GatheredMember> {
  const [behavioral, constancy, coverage, justifiedOffDays] = await Promise.all([
    getLatestBehavioralScore(userId),
    getLatestConstancyScore(userId),
    // Coverage must never sink a member — a failure degrades to "no work pillar".
    getTrackingCoverage(userId, now, LEADERBOARD_WINDOW_DAYS).catch(() => null),
    // Decision A — member-DECLARED off-days in the window (the auditable
    // justification that relaxes the fairness gate). A failure degrades to 0
    // (gate NOT relaxed = conservative), so it can never crash the nightly run.
    db.memberOffDay
      .count({ where: { userId, date: { gte: windowStartUtc, lte: windowEndUtc } } })
      .catch(() => 0),
  ]);

  const engagementScore = behavioral?.engagementScore ?? null;
  const disciplineScore = behavioral?.disciplineScore ?? null;
  const activeDays = behavioral?.sampleSize.checkins.days ?? 0;
  const streak = behavioral?.components.engagement.parts.streakNormalized.numerator ?? 0;
  const regularityScore = constancy?.breakdown.regularity ?? null;
  const trackingCoverage = coverage ? coverage.pct : null;

  return {
    input: {
      engagementScore,
      disciplineScore,
      regularityScore,
      trackingCoverage,
      activeDays,
      windowDays: LEADERBOARD_WINDOW_DAYS,
      justifiedOffDays,
    },
    streak,
  };
}

// =============================================================================
// Nightly recompute (cron)
// =============================================================================

export interface LeaderboardRecomputeResult {
  /** Snapshots written (every active member gets one row, ranked or not). */
  computed: number;
  /** Members that received an actual numeric rank. */
  ranked: number;
  /** Per-member gather failures (logged, non-fatal). */
  errors: number;
  /** ISO timestamp of the run. */
  ranAt: string;
  /** The civil day the board is anchored on (yesterday-local). */
  date: LocalDateString;
}

interface ComputedEntry extends RankableEntry {
  result: LeaderboardScore;
  activeDays: number;
  activePillars: number;
}

/**
 * Recompute + persist the leaderboard for every active member. Anchored on
 * yesterday-local (matching the behavioral snapshot the cron just refreshed).
 * Opted-out members ARE computed (so they can see their own rank privately);
 * the READ layer hides them from other members. Idempotent: upsert on
 * (userId, date) — a re-run overwrites rather than stacks.
 */
export async function recomputeLeaderboard(now?: Date): Promise<LeaderboardRecomputeResult> {
  const instant = now ?? new Date();
  const ranAt = instant.toISOString();
  const anchor = shiftLocalDate(localDateOf(instant, LEADERBOARD_TZ), -1);
  // Decision A — the 30-day window [anchor−29, anchor] used to count each
  // member's DECLARED off-days, aligned with the behavioral snapshot's window +
  // anchor so `justifiedOffDays` and `activeDays` describe the same period.
  const anchorUtc = parseLocalDate(anchor);
  const windowStartUtc = parseLocalDate(shiftLocalDate(anchor, -(LEADERBOARD_WINDOW_DAYS - 1)));

  const users = await db.user.findMany({
    where: { status: 'active' },
    select: { id: true, joinedAt: true },
  });

  const entries: ComputedEntry[] = [];
  let errors = 0;

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const slice = users.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      slice.map(async (u) => {
        const { input, streak } = await gatherMember(u.id, instant, windowStartUtc, anchorUtc);
        const result = computeLeaderboardScore(input);
        return {
          userId: u.id,
          score: result.score,
          // Full-precision composite → the primary rank sort key, so members
          // whose rounded scores collide are still ordered "au détail près".
          // Recomputed from `parts` (never persisted): `result` stays a clean
          // `ScoreResult`, so the `components` JSON keeps only the rounded score.
          precise: result.score !== null ? preciseScoreFromParts(result.parts) : null,
          streak,
          joinedAt: u.joinedAt,
          result,
          activeDays: input.activeDays,
          activePillars: countActivePillars(result),
        } satisfies ComputedEntry;
      }),
    );
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (!r) continue;
      if (r.status === 'fulfilled') {
        entries.push(r.value);
      } else {
        errors++;
        reportWarning('leaderboard.recompute', 'gather_failed', {
          userId: slice[j]?.id,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }

  const rankedEntries = rankEntries(entries);
  const dateUtc = anchorUtc;
  let computed = 0;
  let ranked = 0;

  for (const e of rankedEntries) {
    const components: LeaderboardComponentsJson = { score: e.result };
    const sampleSize: LeaderboardSampleSizeJson = {
      activeDays: e.activeDays,
      windowDays: LEADERBOARD_WINDOW_DAYS,
      activePillars: e.activePillars,
    };
    await db.leaderboardSnapshot.upsert({
      where: { userId_date: { userId: e.userId, date: dateUtc } },
      create: {
        userId: e.userId,
        date: dateUtc,
        score: e.score,
        rank: e.rank,
        components: asLeaderboardInputJson(components),
        sampleSize: asLeaderboardInputJson(sampleSize),
        windowDays: LEADERBOARD_WINDOW_DAYS,
        status: e.result.status,
      },
      update: {
        score: e.score,
        rank: e.rank,
        components: asLeaderboardInputJson(components),
        sampleSize: asLeaderboardInputJson(sampleSize),
        windowDays: LEADERBOARD_WINDOW_DAYS,
        status: e.result.status,
        computedAt: new Date(),
      },
    });
    computed++;
    if (e.rank !== null) ranked++;
  }

  return { computed, ranked, errors, ranAt, date: anchor };
}

// =============================================================================
// Read layer (page + featuring)
// =============================================================================

export interface LeaderboardRowView {
  userId: string;
  rank: number | null;
  score: number | null;
  firstName: string;
  /** Read URL for the member's avatar, or null → render initials. */
  avatarUrl: string | null;
  /** Uppercase initials fallback (first + last). */
  initials: string;
  /** True for the signed-in viewer's own row (self-highlight). */
  isViewer: boolean;
  status: 'ok' | 'insufficient_data';
  /** Full ScoreResult for the "Pourquoi ce rang ?" breakdown. */
  breakdown: LeaderboardScore;
}

export interface LeaderboardBoardView {
  /** The civil day the board covers, or null when no snapshot exists yet. */
  date: LocalDateString | null;
  /** Ranked, VISIBLE rows (opted-out members hidden — except the viewer). */
  rows: LeaderboardRowView[];
  /** The viewer's own row (always present if they have a snapshot). */
  me: LeaderboardRowView | null;
  /** Total members with a real rank on this date (the "sur N" denominator). */
  totalRanked: number;
  /** Score of the TRUE `rank === 3` member — read from the pre-filter set (which
   * keeps opted-out members) so it stays honest even when the real rank-3 member
   * is opted-out (hidden). A bare score is a non-identifying threshold (like
   * `totalRanked`), and it powers the exact "il te manque N points pour entrer
   * dans le top 3" gap line. null when no member currently holds rank 3 — fewer
   * than three ranked members, or the rank-3 holder suspended/deleted since the
   * nightly recompute (see `podiumThresholdScore`). */
  thirdScore: number | null;
}

interface SnapshotUserRow {
  userId: string;
  score: number | null;
  rank: number | null;
  status: string;
  components: unknown;
  user: {
    firstName: string | null;
    lastName: string | null;
    avatarKey: string | null;
    image: string | null;
    leaderboardOptOut: boolean;
  };
}

function initialsOf(firstName: string | null, lastName: string | null): string {
  const a = firstName?.trim().charAt(0) ?? '';
  const b = lastName?.trim().charAt(0) ?? '';
  const s = `${a}${b}`.toUpperCase();
  return s.length > 0 ? s : '?';
}

function avatarUrlOf(avatarKey: string | null, image: string | null): string | null {
  if (avatarKey) {
    try {
      return selectStorage().getReadUrl(avatarKey);
    } catch {
      // Malformed key never breaks the board — fall through to initials.
    }
  }
  return image ?? null;
}

function toRowView(row: SnapshotUserRow, viewerId: string): LeaderboardRowView {
  const components = row.components as LeaderboardComponentsJson;
  return {
    userId: row.userId,
    rank: row.rank,
    score: row.score,
    firstName: row.user.firstName?.trim() || 'Membre',
    avatarUrl: avatarUrlOf(row.user.avatarKey, row.user.image),
    initials: initialsOf(row.user.firstName, row.user.lastName),
    isViewer: row.userId === viewerId,
    status: row.status === 'insufficient_data' ? 'insufficient_data' : 'ok',
    breakdown: components.score,
  };
}

async function latestBoardDate(): Promise<Date | null> {
  const latest = await db.leaderboardSnapshot.findFirst({
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  return latest?.date ?? null;
}

/**
 * Full board for the `/classement` page. Ranked rows in rank order; opted-out
 * members are hidden from OTHER members (but a viewer always sees their own row
 * via `me`). `totalRanked` is the honest "sur N" denominator (all ranked
 * members, including hidden ones — the field count is not a privacy leak).
 */
export const getLeaderboardBoard = cache(
  async (viewerId: string): Promise<LeaderboardBoardView> => {
    const date = await latestBoardDate();
    if (!date) return { date: null, rows: [], me: null, totalRanked: 0, thirdScore: null };

    const raw = await db.leaderboardSnapshot.findMany({
      // Firewall/state hardening: a snapshot row survives a member being
      // suspended or deleted, so re-filter to active members at read time. A
      // stale row must never resurface on the public board (nor inflate the
      // "sur N" denominator derived from `raw` below).
      where: { date, user: { status: 'active' } },
      orderBy: [{ rank: { sort: 'asc', nulls: 'last' } }],
      select: {
        userId: true,
        score: true,
        rank: true,
        status: true,
        components: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            avatarKey: true,
            image: true,
            leaderboardOptOut: true,
          },
        },
      },
    });

    const mapped = raw.map((r) => ({ row: toRowView(r as SnapshotUserRow, viewerId), raw: r }));
    const me = mapped.find((m) => m.row.isViewer)?.row ?? null;
    // Visible rows: ranked members, hiding opted-out members (except the viewer).
    const rows = mapped
      .filter((m) => m.row.rank !== null && (!m.raw.user.leaderboardOptOut || m.row.isViewer))
      .map((m) => m.row);
    const totalRanked = raw.filter((r) => r.rank !== null).length;
    // Podium threshold = the score of the member holding TRUE `rank === 3`, keyed
    // on the real rank (never a positional index) so it stays COHERENT with the
    // podium split (`splitBoardByRank`, also rank<=3). `mapped` keeps opted-out
    // members (only hidden from `rows`), so the line stays honest when the rank-3
    // holder is merely hidden; it goes null only in the transient suspend/delete
    // gap (ranks e.g. [1, 2, 4…]), where the threshold is genuinely undefined and
    // the card suppresses the gap line rather than pointing it at an off-podium
    // member's score. See `podiumThresholdScore` for the full gap analysis.
    const thirdScore = podiumThresholdScore(mapped.map((m) => m.row));

    return {
      date: date.toISOString().slice(0, 10) as LocalDateString,
      rows,
      me,
      totalRanked,
      thirdScore,
    };
  },
);

// =============================================================================
// Rank movement (migration-free — derived from the (userId, date) snapshot log)
// =============================================================================

// The pure derivation + its types live in `./ranking` (no I/O, unit-tested in
// isolation); re-export the local bindings so read-layer consumers (the movement
// chip, MyRankCard) keep importing them from the service surface.
export { computeRankMovement };
export type { RankDirection, RankMovement };

/**
 * The viewer's rank on the most recent EARLIER snapshot where they held a rank.
 * Uses the previous EXISTING ranked snapshot (gap-robust across missed cron
 * nights), not a literal calendar D-1, so the movement chip reads honestly as
 * "depuis le dernier classement".
 */
async function previousRankOf(userId: string, currentDate: Date): Promise<number | null> {
  const prev = await db.leaderboardSnapshot.findFirst({
    where: { userId, date: { lt: currentDate }, rank: { not: null } },
    orderBy: { date: 'desc' },
    select: { rank: true },
  });
  return prev?.rank ?? null;
}

export interface MyLeaderboardRank {
  rank: number | null;
  score: number | null;
  totalRanked: number;
  status: 'ok' | 'insufficient_data';
  date: LocalDateString | null;
  breakdown: LeaderboardScore | null;
  /** Rank delta since the viewer's previous ranked snapshot (movement chip). */
  movement: RankMovement;
  /** True when this board is a fresh entry into the top 3 (in-app celebration). */
  enteredTop3: boolean;
  /** Viewer identity for the omnipresent AppShell rank slot (avatar + name). */
  firstName: string;
  avatarUrl: string | null;
  initials: string;
}

/**
 * Lightweight "ton rang" read shared by the dashboard widget AND the omnipresent
 * AppShell rank slot ({@link getMyLeaderboardRank} consumers). `React.cache`-ed,
 * so both consumers in one request pay a single query. Also carries the viewer's
 * identity (avatar + first name + initials) for the shell slot and the rank
 * movement / top-3 entry flag for the in-app celebration. Returns null only when
 * the member has no snapshot at all yet.
 */
export const getMyLeaderboardRank = cache(
  async (userId: string): Promise<MyLeaderboardRank | null> => {
    const date = await latestBoardDate();
    if (!date) return null;

    const [mine, totalRanked, previousRank, identity] = await Promise.all([
      db.leaderboardSnapshot.findUnique({
        where: { userId_date: { userId, date } },
        select: { rank: true, score: true, status: true, components: true },
      }),
      // Same `active` re-filter as the board (getLeaderboardBoard), so this
      // denominator matches the "sur N" shown on /classement exactly.
      db.leaderboardSnapshot.count({
        where: { date, rank: { not: null }, user: { status: 'active' } },
      }),
      previousRankOf(userId, date),
      db.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, avatarKey: true, image: true },
      }),
    ]);

    const firstName = identity?.firstName?.trim() || 'Membre';
    const avatarUrl = avatarUrlOf(identity?.avatarKey ?? null, identity?.image ?? null);
    const initials = initialsOf(identity?.firstName ?? null, identity?.lastName ?? null);
    const isoDate = date.toISOString().slice(0, 10) as LocalDateString;

    if (!mine) {
      return {
        rank: null,
        score: null,
        totalRanked,
        status: 'insufficient_data',
        date: isoDate,
        breakdown: null,
        movement: computeRankMovement(null, previousRank),
        enteredTop3: false,
        firstName,
        avatarUrl,
        initials,
      };
    }

    const components = mine.components as unknown as LeaderboardComponentsJson;
    const movement = computeRankMovement(mine.rank, previousRank);
    // Fresh top-3 entry: newly at/above rank 3 having been outside it (or never
    // ranked before). Steady-state top-3 members do NOT re-fire the celebration.
    const enteredTop3 =
      mine.rank !== null && mine.rank <= 3 && (previousRank === null || previousRank > 3);
    return {
      rank: mine.rank,
      score: mine.score,
      totalRanked,
      status: mine.status === 'insufficient_data' ? 'insufficient_data' : 'ok',
      date: isoDate,
      breakdown: components.score,
      movement,
      enteredTop3,
      firstName,
      avatarUrl,
      initials,
    };
  },
);
