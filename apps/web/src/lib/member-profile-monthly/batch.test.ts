import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks hoisted BEFORE importing the module under test. IO boundaries (db,
// audit, observability, loader) are mocked; the PURE surfaces (safety gate,
// pricing, prompt builders, crisis/AMF detectors) run for REAL so the tests
// prove the actual gate wiring, not a stub.
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: vi.fn() },
    memberProfileMonthlySnapshot: { upsert: vi.fn() },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));

vi.mock('@/lib/observability', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));

vi.mock('./loader', () => ({
  loadReprofileSliceForUser: vi.fn(),
  loadReflectionCorpusForMonth: vi.fn(),
}));

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { reportError, reportWarning } from '@/lib/observability';
import type { MemberProfileMonthlySnapshotOutput } from '@/lib/schemas/member-profile-monthly-snapshot';

import {
  loadAllReprofileSnapshots,
  persistGeneratedSnapshots,
  type MemberProfileMonthlyBatchResultEntry,
} from './batch';
import { loadReflectionCorpusForMonth, loadReprofileSliceForUser } from './loader';
import type { MonthlyReflectionEntry, MonthlyReprofileSnapshot } from './types';

// ---------------------------------------------------------------------------
// Fixtures — the member's own words + an output whose every evidence[] is a
// verbatim substring of that corpus (so the REAL safety gate passes).
// ---------------------------------------------------------------------------

const CORPUS = [
  'Je suis mon plan plus souvent que le mois dernier.',
  'Je sens mieux quand attendre mon setup.',
  "L'incertitude me stresse encore avant chaque entree.",
  'Apres une perte je reduis trop ma taille.',
].join('\n');

function validOutput(): MemberProfileMonthlySnapshotOutput {
  return {
    evolution_narrative:
      "Ce mois, le respect du plan progresse et les sorties anticipees par peur reculent ; l'acceptation de l'incertitude reste le chantier dominant du mois.",
    coaching_tone: {
      register: 'pedagogique',
      rationale:
        'Le membre structure mieux son process ; un registre pedagogique soutient sa progression.',
      evidence: ['Je suis mon plan plus souvent que le mois dernier.'],
    },
    learning_stage: {
      stage: 'subjective',
      rationale:
        'Il applique son plan avec plus de fluidite mais depend encore de sa lecture subjective.',
      evidence: ['Je sens mieux quand attendre mon setup.'],
    },
    axes_structured: [
      {
        axis: "Consolider l'acceptation de l'incertitude avant chaque entree.",
        dimensionId: 'uncertainty_acceptance',
        priority: 1,
        evidence: ["L'incertitude me stresse encore avant chaque entree."],
      },
    ],
    weak_signals: [
      {
        signal: 'Sur-ajustement du risque apres une perte, a observer le mois suivant.',
        dimensionId: 'risk_discipline',
        evidence: ['Apres une perte je reduis trop ma taille.'],
      },
    ],
  };
}

function ok(userId: string): MemberProfileMonthlyBatchResultEntry {
  return { userId, output: validOutput() };
}

function mockSlice(reflections: MonthlyReflectionEntry[]) {
  const snapshot: MonthlyReprofileSnapshot = {
    pseudonymLabel: 'member-ABCDEF12',
    timezone: 'Europe/Paris',
    monthStartLocal: '2026-04-01',
    monthEndLocal: '2026-04-30',
    accountAgeDaysInWindow: 30,
    reflections,
    baseline: {
      coachingRegister: null,
      learningStage: null,
      onboardingSummary: null,
      previousMonth: null,
    },
    processSignals: {
      reflectionCount: reflections.length,
      tradeCount: 0,
      checkinCount: 0,
      tagFrequencies: [],
    },
  };
  return {
    snapshot,
    window: {
      monthStartLocal: '2026-04-01',
      monthEndLocal: '2026-04-30',
      monthStartUtc: new Date('2026-03-31T22:00:00.000Z'),
      monthEndUtc: new Date('2026-04-30T21:59:59.999Z'),
    },
    userMeta: { email: 'x@y.z', firstName: null, lastName: null },
  };
}

function auditActions(): string[] {
  return vi.mocked(logAudit).mock.calls.map(([arg]) => arg.action);
}

// ===========================================================================
// Persist side
// ===========================================================================

describe('persistGeneratedSnapshots (J-E monthly re-profiling)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: 'user-active-1' } as never,
      { id: 'user-active-2' } as never,
    ]);
    vi.mocked(db.memberProfileMonthlySnapshot.upsert).mockResolvedValue({} as never);
    vi.mocked(logAudit).mockResolvedValue(undefined);
    vi.mocked(loadReflectionCorpusForMonth).mockResolvedValue(CORPUS);
  });

  it('happy path: persists 1 grounded entry + emits analyzed + batch.persisted audits', async () => {
    const result = await persistGeneratedSnapshots({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [ok('user-active-1')],
    });

    expect(result).toEqual({ persisted: 1, skipped: 0, errors: 0 });
    expect(db.memberProfileMonthlySnapshot.upsert).toHaveBeenCalledOnce();
    expect(auditActions()).toContain('member_profile_monthly.analyzed');
    const summary = vi
      .mocked(logAudit)
      .mock.calls.find(([arg]) => arg.action === 'member_profile_monthly.batch.persisted');
    expect(summary?.[0].metadata).toMatchObject({ persisted: 1, skipped: 0, errors: 0, total: 1 });
  });

  it('recomputes monthEnd from monthStart (ignores a forged request.monthEnd)', async () => {
    await persistGeneratedSnapshots({
      monthStart: '2026-04-01',
      monthEnd: '2026-12-31', // incoherent — must be ignored
      results: [ok('user-active-1')],
    });
    const call = vi.mocked(db.memberProfileMonthlySnapshot.upsert).mock.calls[0]?.[0];
    // 2026-04 → last civil day is the 30th (service-recomputed, anti-tamper).
    expect((call?.create.monthEnd as Date).toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('rejects malformed output via Zod (evolution_narrative too short) → errors', async () => {
    const bad = { userId: 'user-active-1', output: { evolution_narrative: 'trop court' } };
    const result = await persistGeneratedSnapshots({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [bad as unknown as MemberProfileMonthlyBatchResultEntry],
    });
    expect(result.errors).toBe(1);
    expect(result.persisted).toBe(0);
    expect(db.memberProfileMonthlySnapshot.upsert).not.toHaveBeenCalled();
    expect(auditActions()).toContain('member_profile_monthly.batch.invalid_output');
  });

  it('returns errors=N when the month window is invalid (parseLocalDate throws)', async () => {
    const result = await persistGeneratedSnapshots({
      monthStart: '2026-02-30', // not a real date
      monthEnd: '2026-03-31',
      results: [ok('user-active-1'), ok('user-active-2')],
    });
    expect(result).toEqual({ persisted: 0, skipped: 0, errors: 2 });
    expect(db.memberProfileMonthlySnapshot.upsert).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([arg]) =>
            arg.action === 'member_profile_monthly.batch.invalid_output' &&
            (arg.metadata as { reason?: string })?.reason === 'invalid_month_window',
        ),
    ).toBe(true);
  });

  it('skips an entry targeting an unknown/inactive user (forged-id defense)', async () => {
    const result = await persistGeneratedSnapshots({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [ok('user-GHOST')],
    });
    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(db.memberProfileMonthlySnapshot.upsert).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([arg]) =>
            arg.action === 'member_profile_monthly.batch.skipped' &&
            (arg.metadata as { reason?: string })?.reason === 'unknown_or_inactive_user',
        ),
    ).toBe(true);
  });

  it('skips an error entry from the local script', async () => {
    const result = await persistGeneratedSnapshots({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [{ userId: 'user-active-1', error: 'claude exited 1' }],
    });
    expect(result).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(db.memberProfileMonthlySnapshot.upsert).not.toHaveBeenCalled();
  });

  it('skips persist on a HIGH crisis signal in the AI output (+ reportError)', async () => {
    const crisisOut = validOutput();
    crisisOut.evolution_narrative =
      "Le membre traverse un mois tres sombre et parle de suicide de facon explicite, il faut relayer les ressources d'urgence sans attendre le mois prochain.";
    const result = await persistGeneratedSnapshots({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [{ userId: 'user-active-1', output: crisisOut }],
    });
    expect(result.skipped).toBe(1);
    expect(result.persisted).toBe(0);
    expect(db.memberProfileMonthlySnapshot.upsert).not.toHaveBeenCalled();
    expect(auditActions()).toContain('member_profile_monthly.batch.crisis_detected');
    expect(reportError).toHaveBeenCalled();
  });

  it('skips persist on an AMF directional violation in the AI output', async () => {
    const amfOut = validOutput();
    amfOut.evolution_narrative =
      'Le membre progresse bien ce mois-ci sur son process, et pour la suite achetez maintenant serait la meilleure decision de trading.';
    const result = await persistGeneratedSnapshots({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [{ userId: 'user-active-1', output: amfOut }],
    });
    expect(result.skipped).toBe(1);
    expect(result.persisted).toBe(0);
    expect(db.memberProfileMonthlySnapshot.upsert).not.toHaveBeenCalled();
    expect(auditActions()).toContain('member_profile_monthly.batch.amf_violation');
  });

  it('skips persist when a dimension citation is fabricated (evidence_invalid)', async () => {
    // The re-derived corpus does NOT contain the output's evidence strings.
    vi.mocked(loadReflectionCorpusForMonth).mockResolvedValue('Un corpus sans aucune citation.');
    const result = await persistGeneratedSnapshots({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [ok('user-active-1')],
    });
    expect(result.skipped).toBe(1);
    expect(result.persisted).toBe(0);
    expect(db.memberProfileMonthlySnapshot.upsert).not.toHaveBeenCalled();
    expect(auditActions()).toContain('member_profile_monthly.batch.evidence_invalid');
  });

  it('skips persist when the corpus cannot be re-derived (unknown user at gate time)', async () => {
    vi.mocked(loadReflectionCorpusForMonth).mockResolvedValue(null);
    const result = await persistGeneratedSnapshots({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
      results: [ok('user-active-1')],
    });
    expect(result.skipped).toBe(1);
    expect(result.persisted).toBe(0);
    expect(db.memberProfileMonthlySnapshot.upsert).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(logAudit)
        .mock.calls.some(
          ([arg]) =>
            arg.action === 'member_profile_monthly.batch.skipped' &&
            (arg.metadata as { reason?: string })?.reason === 'corpus_rederive_failed',
        ),
    ).toBe(true);
  });
});

// ===========================================================================
// Pull side
// ===========================================================================

describe('loadAllReprofileSnapshots (J-E monthly re-profiling)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(logAudit).mockResolvedValue(undefined);
  });

  it('emits an entry for a member with reflections, SKIPS a silent month (counted)', async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: 'user-writes' } as never,
      { id: 'user-silent' } as never,
    ]);
    vi.mocked(loadReprofileSliceForUser)
      .mockResolvedValueOnce(
        mockSlice([{ source: 'journal', localDate: '2026-04-05', text: 'Coupe un gagnant tot.' }]),
      )
      .mockResolvedValueOnce(mockSlice([]));

    const envelope = await loadAllReprofileSnapshots({ now: new Date('2026-05-01T00:05:00.000Z') });

    expect(envelope.entries).toHaveLength(1);
    expect(envelope.entries[0]?.userId).toBe('user-writes');
    // The system prompt carries the few-shot block (J-B: examples must travel).
    expect(envelope.systemPrompt).toContain('member-9F3A2C71');
    expect(envelope.outputJsonSchema).toBeDefined();
    const pulled = vi
      .mocked(logAudit)
      .mock.calls.find(([arg]) => arg.action === 'member_profile_monthly.batch.pulled');
    expect(pulled?.[0].metadata).toMatchObject({ entriesCount: 1, silentSkipped: 1 });
  });

  it('surfaces a rejected per-member load without failing the batch', async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: 'user-boom' } as never]);
    vi.mocked(loadReprofileSliceForUser).mockRejectedValueOnce(new Error('corrupt tz'));

    const envelope = await loadAllReprofileSnapshots({ now: new Date('2026-05-01T00:05:00.000Z') });

    expect(envelope.entries).toHaveLength(0);
    expect(reportWarning).toHaveBeenCalledWith(
      'member_profile_monthly.batch',
      'member_snapshot_load_failed',
      expect.objectContaining({ userId: 'user-boom' }),
    );
    expect(auditActions()).toContain('member_profile_monthly.batch.skipped');
  });
});
