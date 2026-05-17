import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    adminNote: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';

import {
  AdminNoteNotFoundError,
  createAdminNote,
  deleteAdminNote,
  getAdminNoteById,
  listAdminNotesForMember,
} from './admin-notes-service';

function makeRow(
  overrides: Partial<{
    id: string;
    memberId: string;
    authorId: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: 'note-1',
    memberId: 'member-1',
    authorId: 'admin-1',
    body: 'Respecte son plan, discipline en hausse.',
    createdAt: new Date('2026-05-17T10:00:00Z'),
    updatedAt: new Date('2026-05-17T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// createAdminNote
// ---------------------------------------------------------------------------

describe('createAdminNote', () => {
  it('inserts member + author + body and serializes dates to ISO', async () => {
    vi.mocked(db.adminNote.create).mockResolvedValue(makeRow() as never);

    const result = await createAdminNote({
      memberId: 'member-1',
      authorId: 'admin-1',
      body: 'Respecte son plan, discipline en hausse.',
    });

    const call = vi.mocked(db.adminNote.create).mock.calls[0];
    if (!call) throw new Error('expected create to be called');
    const arg = call[0] as { data: { memberId: string; authorId: string; body: string } };
    expect(arg.data).toEqual({
      memberId: 'member-1',
      authorId: 'admin-1',
      body: 'Respecte son plan, discipline en hausse.',
    });
    expect(result.id).toBe('note-1');
    expect(result.createdAt).toBe('2026-05-17T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// listAdminNotesForMember
// ---------------------------------------------------------------------------

describe('listAdminNotesForMember', () => {
  it('queries member-scoped, newest-first', async () => {
    vi.mocked(db.adminNote.findMany).mockResolvedValue([makeRow()] as never);

    const result = await listAdminNotesForMember('member-1');

    const call = vi.mocked(db.adminNote.findMany).mock.calls[0];
    if (!call) throw new Error('expected findMany to be called');
    const arg = call[0] as { where: { memberId: string }; orderBy: { createdAt: string } };
    expect(arg.where).toEqual({ memberId: 'member-1' });
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(result).toHaveLength(1);
    expect(result[0]?.memberId).toBe('member-1');
  });

  it('returns an empty array when the member has no notes', async () => {
    vi.mocked(db.adminNote.findMany).mockResolvedValue([] as never);
    expect(await listAdminNotesForMember('member-1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deleteAdminNote (scoped by id AND authorId — anti stray-delete)
// ---------------------------------------------------------------------------

describe('deleteAdminNote', () => {
  it('deletes scoped by id AND authorId', async () => {
    vi.mocked(db.adminNote.deleteMany).mockResolvedValue({ count: 1 } as never);

    await deleteAdminNote('note-1', 'admin-1');

    const call = vi.mocked(db.adminNote.deleteMany).mock.calls[0];
    if (!call) throw new Error('expected deleteMany to be called');
    const arg = call[0] as { where: { id: string; authorId: string } };
    expect(arg.where).toEqual({ id: 'note-1', authorId: 'admin-1' });
  });

  it('throws AdminNoteNotFoundError when nothing matched', async () => {
    vi.mocked(db.adminNote.deleteMany).mockResolvedValue({ count: 0 } as never);
    await expect(deleteAdminNote('nope', 'admin-1')).rejects.toBeInstanceOf(AdminNoteNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// getAdminNoteById
// ---------------------------------------------------------------------------

describe('getAdminNoteById', () => {
  it('returns the serialized note when found', async () => {
    vi.mocked(db.adminNote.findUnique).mockResolvedValue(makeRow() as never);
    const result = await getAdminNoteById('note-1');
    expect(result?.id).toBe('note-1');
    expect(result?.memberId).toBe('member-1');
  });

  it('returns null when absent', async () => {
    vi.mocked(db.adminNote.findUnique).mockResolvedValue(null as never);
    expect(await getAdminNoteById('nope')).toBeNull();
  });
});
