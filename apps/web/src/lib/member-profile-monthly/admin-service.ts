import 'server-only';

import { db } from '@/lib/db';

import type { SerializedMonthlyProfileSnapshot } from './types';

/**
 * J-E inc.3 — ADMIN read service for the monthly deep re-profiling trajectory
 * (`/admin/members/[id]?tab=trajectoire`). Carbon of
 * `monthly-debrief/service.ts listMonthlyDebriefsForMember`: a plain
 * user-scoped, newest-first read of the persisted snapshots, serialized for
 * the RSC panel. The admin page already gates `role === 'admin'`.
 *
 * 🚨 §21.5 (BLOCKING). This is a READ of already-persisted admin reference
 * text (evolution narrative + the 4 re-profiled dims). It touches NO scoring /
 * analytics / trades module and reads no P&L — the 4 dims are never a scoring
 * input, in either direction (locked by `test/anti-leak/member-profile-monthly-isolation`).
 */

function toSerializedMonthlyProfileSnapshot(row: {
  id: string;
  userId: string;
  monthStart: Date;
  monthEnd: Date;
  generatedAt: Date;
  evolutionNarrative: string;
  coachingTone: unknown;
  learningStage: unknown;
  axesStructured: unknown;
  weakSignals: unknown;
  claudeModel: string;
}): SerializedMonthlyProfileSnapshot {
  return {
    id: row.id,
    userId: row.userId,
    // `@db.Date` columns store a UTC-midnight date; `.toISOString().slice(0,10)`
    // is the canon read for a DATE (mirror `monthly-debrief/service.ts:78`).
    monthStart: row.monthStart.toISOString().slice(0, 10),
    monthEnd: row.monthEnd.toISOString().slice(0, 10),
    generatedAt: row.generatedAt.toISOString(),
    evolutionNarrative: row.evolutionNarrative,
    coachingTone: row.coachingTone,
    learningStage: row.learningStage,
    axesStructured: row.axesStructured,
    weakSignals: row.weakSignals,
    claudeModel: row.claudeModel,
  };
}

/**
 * List a member's monthly re-profiling snapshots, newest first, for the admin
 * trajectory tab. Bounded (clamp 1..24) so a member with a long history can't
 * unbound the admin render (admin-only, not a hot path, 30-member V1 scale;
 * mirror `listMonthlyDebriefsForMember`).
 */
export async function listMonthlyReprofileSnapshotsForMember(
  memberId: string,
  limit = 12,
): Promise<SerializedMonthlyProfileSnapshot[]> {
  const rows = await db.memberProfileMonthlySnapshot.findMany({
    where: { userId: memberId },
    orderBy: { monthStart: 'desc' },
    take: Math.max(1, Math.min(limit, 24)),
  });
  return rows.map(toSerializedMonthlyProfileSnapshot);
}
