import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J6 (admin-scale, scope 7) — bulk admin note action gate.
 *
 * Member-access negative tests: a non-admin (or unauthenticated) caller must be
 * refused BEFORE any note is written, and forged/foreign ids are whitelisted out
 * (`role: member` only). The DB + notes service are mocked — this suite asserts
 * the authorization + validation branches, not persistence.
 */

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { user: { findMany: vi.fn() } } }));
vi.mock('@/lib/admin/admin-notes-service', () => ({ createAdminNote: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { createAdminNote } from '@/lib/admin/admin-notes-service';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { bulkAddMemberNoteAction } from '@/app/admin/members/bulk-actions';

const ID1 = 'clmember0000000000000001';
const ID2 = 'clmember0000000000000002';

function asSession(value: unknown): void {
  vi.mocked(auth).mockResolvedValue(value as never);
}

describe('bulkAddMemberNoteAction — access + validation gate', () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(db.user.findMany).mockReset();
    vi.mocked(createAdminNote).mockClear();
    vi.mocked(logAudit).mockClear();
  });

  it('refuses an unauthenticated caller (no note written)', async () => {
    asSession(null);
    const res = await bulkAddMemberNoteAction([ID1], 'Relance hedge.');
    expect(res).toEqual({ ok: false, error: 'unauthorized' });
    expect(createAdminNote).not.toHaveBeenCalled();
  });

  it('refuses a MEMBER caller — forbidden (no note written)', async () => {
    asSession({ user: { id: ID1, role: 'member', status: 'active' } });
    const res = await bulkAddMemberNoteAction([ID2], 'Relance hedge.');
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(createAdminNote).not.toHaveBeenCalled();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('refuses a suspended admin', async () => {
    asSession({ user: { id: 'admin1', role: 'admin', status: 'suspended' } });
    const res = await bulkAddMemberNoteAction([ID1], 'Relance hedge.');
    expect(res).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('rejects an empty selection', async () => {
    asSession({ user: { id: 'admin1', role: 'admin', status: 'active' } });
    expect(await bulkAddMemberNoteAction([], 'Relance.')).toEqual({
      ok: false,
      error: 'invalid_input',
    });
  });

  it('rejects an empty note body', async () => {
    asSession({ user: { id: 'admin1', role: 'admin', status: 'active' } });
    expect(await bulkAddMemberNoteAction([ID1], '   ')).toEqual({
      ok: false,
      error: 'invalid_input',
    });
  });

  it('rejects when every id is malformed (never hits the DB)', async () => {
    asSession({ user: { id: 'admin1', role: 'admin', status: 'active' } });
    const res = await bulkAddMemberNoteAction(['../etc', 'DROP TABLE'], 'Relance.');
    expect(res).toEqual({ ok: false, error: 'invalid_input' });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('drops ids that are not real members (whitelist) → invalid_input if none remain', async () => {
    asSession({ user: { id: 'admin1', role: 'admin', status: 'active' } });
    vi.mocked(db.user.findMany).mockResolvedValue([] as never);
    const res = await bulkAddMemberNoteAction([ID1, ID2], 'Relance.');
    expect(res).toEqual({ ok: false, error: 'invalid_input' });
    expect(createAdminNote).not.toHaveBeenCalled();
  });

  it('notes exactly the whitelisted members and audits the batch', async () => {
    asSession({ user: { id: 'admin1', role: 'admin', status: 'active' } });
    // Duplicate + one foreign id requested; DB returns only the two real members.
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: ID1 }, { id: ID2 }] as never);

    const res = await bulkAddMemberNoteAction([ID1, ID1, ID2], 'Relance sur le hedge NY.');

    expect(res).toEqual({ ok: true, created: 2 });
    expect(createAdminNote).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(createAdminNote)
        .mock.calls.map((c) => c[0].memberId)
        .sort(),
    ).toEqual([ID1, ID2].sort());
    // Every note carries the same admin author + sanitized body.
    for (const call of vi.mocked(createAdminNote).mock.calls) {
      expect(call[0].authorId).toBe('admin1');
      expect(call[0].body).toContain('Relance sur le hedge NY.');
    }
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.members.bulk_noted',
        userId: 'admin1',
        metadata: expect.objectContaining({ created: 2 }),
      }),
    );
  });
});
