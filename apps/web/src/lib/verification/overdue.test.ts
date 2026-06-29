import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AUTONOMY-1 — MT5 proof vision permanence safety-net (5th twin of the §26
 * calendar / §25 monthly / S2 onboarding / J8 weekly nets).
 *
 * `scanOverdueVerifications` (per-proof 24h grace + oldest tracking) and
 * `runVerificationOverdueAlert` (alert vs quiet, all email outcomes) run REAL.
 * db / audit / observability / email / env are mocked. The pending-only /
 * active-member candidate logic lives in the Prisma where-clause → pinned by a
 * shape assertion (mirror of the onboarding net's where-clause pin).
 */

const { envMock, sendMock } = vi.hoisted(() => ({
  envMock: { WEEKLY_REPORT_RECIPIENT: 'admin@fxmily.test' as string | undefined },
  sendMock: vi.fn<(...args: unknown[]) => Promise<{ id: string | null; delivered: boolean }>>(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    mt5AccountProof: { count: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportWarning: vi.fn() }));
vi.mock('@/lib/email/send', () => ({ sendVerificationOverdueAlertEmail: sendMock }));
vi.mock('@/lib/env', () => ({ env: envMock }));

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';

import { runVerificationOverdueAlert, scanOverdueVerifications } from './overdue';

const NOW = new Date('2026-06-11T10:00:00.000Z');
// Uploaded 49h before NOW → well past the 24h grace.
const OVERDUE_OLD = '2026-06-09T09:00:00.000Z';
// Uploaded 30h before NOW → past the 24h grace.
const OVERDUE_RECENT = '2026-06-10T04:00:00.000Z';
// Uploaded 14h before NOW → still inside the 24h grace window.
const WITHIN_GRACE = '2026-06-10T20:00:00.000Z';
// Uploaded EXACTLY 24h before NOW → the grace just elapsed → overdue (≤).
const EXACT_BOUNDARY = '2026-06-10T10:00:00.000Z';

/**
 * The scan now delegates BOTH the candidate logic AND the per-proof grace split
 * to the DB : two index-backed `count`s (overdue past grace + every pending row)
 * + one `findFirst` for the oldest overdue, replacing the prior findMany+JS. The
 * mock simulates Prisma from the same timestamp list : the overdue
 * `count`/`findFirst` carry an `uploadedAt: { lte }` filter (rows past grace /
 * the oldest of them), the bare `count` (pendingActive, no `uploadedAt`) counts
 * every pending row. Same scenarios in, same asserted scan output.
 */
function mockDb(uploadedAts: string[]) {
  const rows = uploadedAts.map((iso) => ({ uploadedAt: new Date(iso) }));
  const graceThreshold = NOW.getTime() - 24 * 60 * 60 * 1000;
  const overdue = rows
    .filter((r) => r.uploadedAt.getTime() <= graceThreshold)
    .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime());

  vi.mocked(db.mt5AccountProof.count).mockImplementation(((args: {
    where: Record<string, unknown>;
  }) => Promise.resolve('uploadedAt' in args.where ? overdue.length : rows.length)) as never);
  vi.mocked(db.mt5AccountProof.findFirst).mockImplementation((() =>
    Promise.resolve(overdue[0] ?? null)) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.WEEKLY_REPORT_RECIPIENT = 'admin@fxmily.test';
  sendMock.mockResolvedValue({ id: 'msg_1', delivered: true });
});

describe('scanOverdueVerifications — candidate logic', () => {
  it('counts pending proofs uploaded more than 24h ago', async () => {
    mockDb([OVERDUE_OLD, OVERDUE_RECENT]);

    const scan = await scanOverdueVerifications({ now: NOW });

    expect(scan.overdueCount).toBe(2);
    expect(scan.withinGrace).toBe(false);
    expect(scan.oldestUploadedAt).toBe(OVERDUE_OLD);
  });

  it('returns 0 + withinGrace while every pending proof is under 24h', async () => {
    mockDb([WITHIN_GRACE]);

    const scan = await scanOverdueVerifications({ now: NOW });

    expect(scan.overdueCount).toBe(0);
    expect(scan.withinGrace).toBe(true);
    expect(scan.oldestUploadedAt).toBeNull();
  });

  it('grace boundary: a proof uploaded EXACTLY 24h ago is overdue (grace elapsed)', async () => {
    mockDb([EXACT_BOUNDARY]);

    const scan = await scanOverdueVerifications({ now: NOW });

    expect(scan.overdueCount).toBe(1);
    expect(scan.withinGrace).toBe(false);
  });

  it('mixes per-proof windows: only the past-24h ones are counted', async () => {
    mockDb([OVERDUE_OLD, WITHIN_GRACE]);

    const scan = await scanOverdueVerifications({ now: NOW });

    expect(scan.overdueCount).toBe(1); // only the 49h-old one
    expect(scan.withinGrace).toBe(false); // an overdue exists → not calm
    expect(scan.oldestUploadedAt).toBe(OVERDUE_OLD);
  });

  it('returns 0 overdue + withinGrace=false when nothing is pending at all', async () => {
    mockDb([]);

    const scan = await scanOverdueVerifications({ now: NOW });

    expect(scan.overdueCount).toBe(0);
    expect(scan.withinGrace).toBe(false);
    expect(scan.oldestUploadedAt).toBeNull();
  });

  it('delegates pending/active-member filtering to the where-clause (PII-free select)', async () => {
    // « non-pending (done/failed) → non compté » and « membre inactif → non
    // compté » are enforced DB-side by the status + relation filters — pin their
    // exact shape so a silent where-clause regression (e.g. dropping
    // `member: { status: 'active' }`) fails here instead of nudging on stale rows.
    mockDb([]);
    await scanOverdueVerifications({ now: NOW });

    // The oldest-overdue `findFirst` carries the FULL predicate (pending + active
    // member + the grace `lte`) AND the PII-free select, so it pins both at once.
    const arg = vi.mocked(db.mt5AccountProof.findFirst).mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(arg.where.ocrStatus).toBe('pending');
    expect(arg.where.member).toEqual({ status: 'active' });
    // PII-free by construction : the scan only ever reads the timestamp.
    expect(arg.select).toEqual({ uploadedAt: true });
  });
});

describe('runVerificationOverdueAlert — notification', () => {
  it('overdue=0 → quiet heartbeat audit, no email, no warning', async () => {
    mockDb([WITHIN_GRACE]);

    const result = await runVerificationOverdueAlert({ now: NOW });

    expect(result.overdueCount).toBe(0);
    expect(result.emailOutcome).toBe('not_attempted');
    expect(sendMock).not.toHaveBeenCalled();
    expect(reportWarning).not.toHaveBeenCalled();
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cron.verification_overdue.scan' }),
    );
  });

  it('overdue>0 + recipient + delivered → warning + email sent + alerted heartbeat', async () => {
    mockDb([OVERDUE_OLD, OVERDUE_RECENT]);

    const result = await runVerificationOverdueAlert({ now: NOW });

    expect(result.overdueCount).toBe(2);
    expect(result.emailOutcome).toBe('sent');
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.verification-overdue',
      'verifications_overdue',
      expect.objectContaining({ overdueCount: 2 }),
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@fxmily.test',
        overdueCount: 2,
        oldestUploadedAt: OVERDUE_OLD,
      }),
    );
    const scanRow = (
      vi.mocked(logAudit).mock.calls.map((c) => c[0]) as Array<{
        action: string;
        metadata: Record<string, unknown>;
      }>
    ).find((a) => a.action === 'cron.verification_overdue.scan');
    expect(scanRow?.metadata.emailOutcome).toBe('sent');
    expect(scanRow?.metadata.alerted).toBe(true);
    expect(scanRow?.metadata.oldestUploadedAt).toBe(OVERDUE_OLD);
    expect(JSON.stringify(scanRow?.metadata)).not.toMatch(/@/); // PII-free
  });

  it('overdue>0 + no recipient → warning + heartbeat, email not attempted', async () => {
    envMock.WEEKLY_REPORT_RECIPIENT = undefined;
    mockDb([OVERDUE_OLD]);

    const result = await runVerificationOverdueAlert({ now: NOW });

    expect(result.emailOutcome).toBe('not_attempted');
    expect(sendMock).not.toHaveBeenCalled();
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.verification-overdue',
      'verifications_overdue',
      expect.anything(),
    );
  });

  it('overdue>0 + email throws → emailOutcome failed, alert still heartbeat-audited', async () => {
    sendMock.mockRejectedValue(new Error('Resend 500'));
    mockDb([OVERDUE_OLD]);

    const result = await runVerificationOverdueAlert({ now: NOW });

    expect(result.emailOutcome).toBe('failed');
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.verification-overdue',
      'admin_email_failed',
      expect.anything(),
    );
    const scanRow = (
      vi.mocked(logAudit).mock.calls.map((c) => c[0]) as Array<{
        action: string;
        metadata: Record<string, unknown>;
      }>
    ).find((a) => a.action === 'cron.verification_overdue.scan');
    expect(scanRow?.metadata.emailOutcome).toBe('failed');
  });
});
