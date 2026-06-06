/**
 * Daily check-in service tests (Prisma-mocked).
 *
 * SPEC §28/§22 — `formationFollowed` (evening "bilan" course-adherence
 * self-report) end-to-end through the service layer: it is PERSISTED (lands in
 * the upsert create + update payloads) and PROJECTED (surfaces on the returned
 * `SerializedCheckin`). Tri-state passthrough: true / false / null. SPEC §2 —
 * a binary ACT only; the service never carries any course content.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    dailyCheckin: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';

import { submitEveningCheckin } from './service';
import type { EveningCheckinInput } from '@/lib/schemas/checkin';

/** A realistic post-Zod evening input (the schema already collapsed the form). */
function eveningInput(formationFollowed: boolean | null): EveningCheckinInput {
  return {
    date: '2026-06-05',
    planRespectedToday: true,
    hedgeRespectedToday: null,
    formationFollowed,
    caffeineMl: null,
    waterLiters: null,
    stressScore: 4,
    moodScore: 6,
    emotionTags: [],
    journalNote: null,
    gratitudeItems: [],
  } as EveningCheckinInput;
}

/** Build the row the mocked upsert resolves to (mirror DB read-back). */
function eveningRow(formationFollowed: boolean | null) {
  const now = new Date('2026-06-05T20:00:00.000Z');
  return {
    id: 'checkin-1',
    userId: 'user-1',
    date: new Date('2026-06-05T00:00:00.000Z'),
    slot: 'evening' as const,
    sleepHours: null,
    sleepQuality: null,
    morningRoutineCompleted: null,
    marketAnalysisDone: null,
    meditationMin: null,
    sportType: null,
    sportDurationMin: null,
    intention: null,
    planRespectedToday: true,
    hedgeRespectedToday: null,
    formationFollowed,
    caffeineMl: null,
    waterLiters: null,
    stressScore: 4,
    gratitudeItems: [] as string[],
    moodScore: 6,
    emotionTags: [] as string[],
    journalNote: null,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('submitEveningCheckin — formationFollowed (SPEC §28/§22)', () => {
  it('PERSISTS formationFollowed=true in both the create and update payloads', async () => {
    vi.mocked(db.dailyCheckin.upsert).mockResolvedValue(eveningRow(true) as never);

    await submitEveningCheckin('user-1', eveningInput(true), { timezone: 'Europe/Paris' });

    const call = vi.mocked(db.dailyCheckin.upsert).mock.calls[0];
    if (!call) throw new Error('expected dailyCheckin.upsert to be called');
    const arg = call[0] as {
      create: { formationFollowed: boolean | null };
      update: { formationFollowed: boolean | null };
    };
    expect(arg.create.formationFollowed).toBe(true);
    expect(arg.update.formationFollowed).toBe(true);
  });

  it('PROJECTS formationFollowed onto the SerializedCheckin (true / false / null)', async () => {
    for (const value of [true, false, null] as const) {
      vi.mocked(db.dailyCheckin.upsert).mockResolvedValue(eveningRow(value) as never);
      const serialized = await submitEveningCheckin('user-1', eveningInput(value), {
        timezone: 'Europe/Paris',
      });
      expect(serialized.formationFollowed).toBe(value);
    }
  });

  it('passes null through unchanged (unanswered evening — no penalty, no default)', async () => {
    vi.mocked(db.dailyCheckin.upsert).mockResolvedValue(eveningRow(null) as never);

    await submitEveningCheckin('user-1', eveningInput(null), { timezone: 'Europe/Paris' });

    const call = vi.mocked(db.dailyCheckin.upsert).mock.calls[0];
    if (!call) throw new Error('expected dailyCheckin.upsert to be called');
    const arg = call[0] as { update: { formationFollowed: boolean | null } };
    // Explicit null — never coerced to false (which would fabricate a "skipped"
    // signal the member never gave). Mirrors hedgeRespectedToday's N/A handling.
    expect(arg.update.formationFollowed).toBeNull();
  });
});
