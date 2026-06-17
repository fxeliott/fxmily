/**
 * S3 DoD §32-a — « l'IA extrait les positions et détecte le NOMBRE EXACT de
 * comptes » prouvé EN RÉEL contre Postgres, en exerçant la VRAIE déduplication
 * par login MT5 (et non un mock qui ré-écho une valeur, cf. audit 2026-06-17).
 *
 * The vision OCR itself stays human-in-the-loop (claude --print, runtime-proven
 * separately) — what was never asserted in CI is the deterministic half that
 * turns extracted output into the exact account count. This drives the REAL
 * persist endpoint (`POST /api/admin/verification-batch/persist`, the same path
 * the local script hits) against real `broker_accounts` rows — going through
 * the HTTP route, never importing the server-only batch module:
 *
 *   - 3 pending proofs for ONE member, NO declared account (the AI-detected
 *     path), carrying 3 vision outputs with logins A, B, A (A duplicated);
 *   - persist must materialise EXACTLY 2 accounts (login dedup, the
 *     `@@unique([memberId, accountLogin])` reuse), NOT 3 (one per proof);
 *   - `User.detectedAccountCount` must equal 2 = DISTINCT proven logins
 *     (batch.ts count where accountLogin not null), the honest §30 count;
 *   - the duplicate-login proof must REUSE the first account, never create a
 *     third — proving the "combien de comptes" axis is evidence-based.
 *
 * Pre-requisites (same as the other DB-backed e2e): real Postgres at
 * DATABASE_URL with migrations applied + `VERIFICATION_ADMIN_BATCH_TOKEN`
 * configured (the persist route 503s without it) — skipped automatically
 * otherwise, exactly like the cron-driven session10 chain test.
 */

import { expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import type { VerificationVisionOutput } from '@/lib/schemas/verification';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';

const H = 3_600_000;

/** A minimal valid vision output for ONE proof: one closed position, one login. */
function visionOutput(login: string, symbol: string, openTimeMs: number): VerificationVisionOutput {
  return {
    account: {
      login,
      broker: 'FTMO S.R.O.',
      currency: 'USD',
      label: `FTMO ${login}`,
      accountTypeGuess: 'prop_firm',
    },
    positions: [
      {
        ticket: `tk-${login}-${symbol}`,
        symbol,
        side: 'buy',
        openTime: new Date(openTimeMs).toISOString(),
        closeTime: new Date(openTimeMs + H).toISOString(),
        volume: 0.5,
        entryPrice: 1.09,
        exitPrice: 1.1,
        pnl: 50,
      },
    ],
    confidence: 0.9,
  };
}

test.describe
  .serial('S3 — détection du NOMBRE EXACT de comptes (vraie dedup login, real DB)', () => {
  let member: SeededUser | null = null;
  const adminToken = process.env.VERIFICATION_ADMIN_BATCH_TOKEN;

  test.beforeAll(async () => {
    test.skip(!adminToken, 'VERIFICATION_ADMIN_BATCH_TOKEN not configured — cannot hit persist');
    await cleanupTestUsers();
    member = await seedMemberUser({ firstName: 'CountVerif' });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
    member = null;
  });

  test('3 preuves / 2 logins distincts → 2 comptes détectés + count honnête (pas 3)', async ({
    request,
  }) => {
    if (!member || !adminToken) throw new Error('precondition missing');
    const now = Date.now();
    const LOGIN_A = '5200111';
    const LOGIN_B = '8800222';

    // 3 pending proofs, AI-detected path (no declared account attached).
    const proofs = await Promise.all(
      [1, 2, 3].map((i) =>
        db.mt5AccountProof.create({
          data: {
            memberId: member!.id,
            fileKey: `proofs/${member!.id}/count-${i}.png`,
            fileHash: `hash-count-${member!.id}-${i}`.padEnd(64, '0').slice(0, 64),
            ocrStatus: 'pending',
          },
          select: { id: true },
        }),
      ),
    );

    // Drive the REAL persist endpoint (the path the local batch script POSTs to).
    const res = await request.post('/api/admin/verification-batch/persist', {
      headers: { 'x-admin-token': adminToken },
      data: {
        results: [
          {
            proofId: proofs[0]!.id,
            userId: member.id,
            output: visionOutput(LOGIN_A, 'EURUSD', now - 3 * H),
          },
          {
            proofId: proofs[1]!.id,
            userId: member.id,
            output: visionOutput(LOGIN_B, 'GBPUSD', now - 2 * H),
          },
          // Same login as proof #1 → must REUSE account A, never create a 3rd row.
          {
            proofId: proofs[2]!.id,
            userId: member.id,
            output: visionOutput(LOGIN_A, 'XAUUSD', now - 1 * H),
          },
        ],
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { ok: boolean; persisted: number; errors: number };
    expect(body.ok).toBe(true);
    expect(body.errors, 'no persist error').toBe(0);
    expect(body.persisted, 'all three proofs analysed').toBe(3);

    // --- EXACT account count: 2 distinct logins → 2 rows, NOT 3 proofs.
    const accounts = await db.brokerAccount.findMany({
      where: { memberId: member.id },
      select: { id: true, accountLogin: true, detectedByAI: true },
    });
    expect(accounts.length, 'login dedup yields 2 accounts, not 3').toBe(2);
    const logins = accounts.map((a) => a.accountLogin).sort();
    expect(logins).toEqual([LOGIN_A, LOGIN_B].sort());
    expect(
      accounts.every((a) => a.detectedByAI),
      'all AI-detected (no declared account)',
    ).toBe(true);

    // --- The honest §30 count = DISTINCT proven logins, written on the User.
    const user = await db.user.findUnique({
      where: { id: member.id },
      select: { detectedAccountCount: true },
    });
    expect(user?.detectedAccountCount, 'detectedAccountCount = distinct proven logins').toBe(2);

    // --- The duplicate-login proof reused account A (no third account created).
    const accountA = accounts.find((a) => a.accountLogin === LOGIN_A)!;
    const reusedProof = await db.mt5AccountProof.findUnique({
      where: { id: proofs[2]!.id },
      select: { brokerAccountId: true, ocrStatus: true },
    });
    expect(reusedProof?.brokerAccountId, 'duplicate-login proof points at account A').toBe(
      accountA.id,
    );
    expect(reusedProof?.ocrStatus).toBe('done');

    // --- Account A carries the positions from BOTH of its proofs (1 + 1).
    const positionsOnA = await db.extractedPosition.count({
      where: { brokerAccountId: accountA.id },
    });
    expect(positionsOnA, 'both A-proofs contributed their position').toBe(2);
  });
});
