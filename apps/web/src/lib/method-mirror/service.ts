import 'server-only';

import { cache } from 'react';

import { db } from '@/lib/db';

import { computeMethodMirror, type MethodMirror } from './compute';

/**
 * S24 — server seam for the « Fidélité à la méthode » mirror. Reads the trailing
 * window of the member's trades (one indexed `findMany` on `enteredAt`) and hands
 * the Prisma rows — `plannedRR` narrowed from Decimal to a plain number — to the
 * pure {@link computeMethodMirror}. No migration: every field already exists.
 */

const LOOKBACK_DAYS = 30;
const PARIS_TZ = 'Europe/Paris';

async function buildMethodMirror(userId: string, now: Date = new Date()): Promise<MethodMirror> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.trade.findMany({
    where: { userId, enteredAt: { gte: since } },
    select: {
      enteredAt: true,
      closedAt: true,
      plannedRR: true,
      // S26 — management-fidelity acts (tri-state, null until answered at close).
      slPerRule: true,
      movedToBe: true,
      partialAtTarget: true,
    },
  });
  return computeMethodMirror(
    rows.map((t) => ({
      enteredAt: t.enteredAt,
      closedAt: t.closedAt,
      // Prisma Decimal → number. plannedRR is required (non-null) on Trade.
      plannedRR: Number(t.plannedRR),
      slPerRule: t.slPerRule,
      movedToBe: t.movedToBe,
      partialAtTarget: t.partialAtTarget,
    })),
    LOOKBACK_DAYS,
    PARIS_TZ,
  );
}

/**
 * Per-request memoised seam (React `cache`): `/progression` reads the mirror BOTH
 * directly AND through `getMember5AxisRecap` — `cache` collapses those duplicate
 * reads into a single trade query per request (house pattern, cf. calendar seam).
 */
export const getMethodMirror = cache(buildMethodMirror);
