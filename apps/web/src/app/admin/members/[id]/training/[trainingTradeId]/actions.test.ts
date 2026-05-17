import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J-T3 Mode Entraînement (SPEC §21) — Server Action tests for the admin
 * backtest-correction workflow (`createTrainingAnnotationAction` /
 * `deleteTrainingAnnotationAction`).
 *
 * Critical logic surface (CLAUDE.md "tests pour la logique critique"):
 * admin auth+role gate + Zod re-parse + media-key BOLA + parent ownership
 * + PII-free audit + revalidate ISOLATION. Mirror of the J-T2
 * `app/training/actions.test.ts` mocking strategy: collaborators mocked
 * (`@/auth`, `next/cache`, services, audit, enqueue, db, storage), but
 * `trainingAnnotationCreateSchema` + `parseTrainingAnnotationKey` kept REAL
 * (pure, no IO) so the fieldErrors + BOLA gates are genuinely exercised.
 *
 * 🚨 STATISTICAL ISOLATION (§21.5) asserted explicitly: audit metadata
 * carries ONLY ids/flags (never the correction `comment` nor any backtest
 * P&L), and `revalidatePath` is NEVER called with `/journal` or
 * `/dashboard` — a backtest correction stays on the training surface.
 */

const authMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const revalidatePathMock = vi.fn<(path: string) => void>();
const createTrainingAnnotationMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const deleteTrainingAnnotationMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const getTrainingAnnotationByIdMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const enqueueMock = vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => 'notif_1');
const findUniqueMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const storageDeleteMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);

class TrainingAnnotationNotFoundError extends Error {}

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/admin/training-annotation-service', () => ({
  createTrainingAnnotation: createTrainingAnnotationMock,
  deleteTrainingAnnotation: deleteTrainingAnnotationMock,
  getTrainingAnnotationById: getTrainingAnnotationByIdMock,
  TrainingAnnotationNotFoundError,
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('@/lib/notifications/enqueue', () => ({
  enqueueTrainingAnnotationNotification: enqueueMock,
}));
vi.mock('@/lib/db', () => ({ db: { trainingTrade: { findUnique: findUniqueMock } } }));
vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return { ...actual, selectStorage: () => ({ delete: storageDeleteMock }) };
});

const { createTrainingAnnotationAction, deleteTrainingAnnotationAction } =
  await import('./actions');

const ADMIN_ID = 'clx0admin001';
const MEMBER_ID = 'clx0member01';
const TT_ID = 'clx0tt000001';
const OWN_MEDIA = `training_annotations/${TT_ID}/dddddddddddddddddddddddddddddddd.png`;
const FOREIGN_MEDIA = 'training_annotations/clx0ttother9/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  authMock.mockReset();
  revalidatePathMock.mockReset();
  createTrainingAnnotationMock.mockReset();
  deleteTrainingAnnotationMock.mockReset();
  getTrainingAnnotationByIdMock.mockReset();
  logAuditMock.mockClear();
  enqueueMock.mockClear();
  findUniqueMock.mockReset();
  storageDeleteMock.mockClear();

  authMock.mockResolvedValue({
    user: { id: ADMIN_ID, status: 'active', role: 'admin' },
  });
  findUniqueMock.mockResolvedValue({ userId: MEMBER_ID });
  createTrainingAnnotationMock.mockResolvedValue({ id: 'ta_1' });
});

describe('createTrainingAnnotationAction — auth/role gate', () => {
  it('unauthorized when no session', async () => {
    authMock.mockResolvedValueOnce(null);
    const r = await createTrainingAnnotationAction(MEMBER_ID, TT_ID, null, form({ comment: 'x' }));
    expect(r).toEqual({ ok: false, error: 'unauthorized' });
    expect(createTrainingAnnotationMock).not.toHaveBeenCalled();
  });

  it('forbidden when the session is not an admin', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u', status: 'active', role: 'member' } });
    const r = await createTrainingAnnotationAction(MEMBER_ID, TT_ID, null, form({ comment: 'x' }));
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(createTrainingAnnotationMock).not.toHaveBeenCalled();
  });
});

describe('createTrainingAnnotationAction — validation + BOLA (real Zod + parseTrainingAnnotationKey)', () => {
  it('invalid_input + fieldErrors when comment is empty', async () => {
    const r = await createTrainingAnnotationAction(MEMBER_ID, TT_ID, null, form({ comment: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid_input');
      expect(r.fieldErrors?.comment).toBeDefined();
    }
    expect(createTrainingAnnotationMock).not.toHaveBeenCalled();
  });

  it('rejects a media key whose trainingTradeId does not match the route param (BOLA)', async () => {
    const r = await createTrainingAnnotationAction(
      MEMBER_ID,
      TT_ID,
      null,
      form({ comment: 'Bonne analyse.', mediaKey: FOREIGN_MEDIA, mediaType: 'image' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid_input');
      expect(r.fieldErrors?.mediaKey).toBeDefined();
    }
    expect(createTrainingAnnotationMock).not.toHaveBeenCalled();
  });

  it('training_trade_not_found when the backtest is absent or not owned by the member', async () => {
    findUniqueMock.mockResolvedValueOnce({ userId: 'someone_else' });
    const r = await createTrainingAnnotationAction(
      MEMBER_ID,
      TT_ID,
      null,
      form({ comment: 'Analyse.' }),
    );
    expect(r).toEqual({ ok: false, error: 'training_trade_not_found' });
    expect(createTrainingAnnotationMock).not.toHaveBeenCalled();
  });
});

describe('createTrainingAnnotationAction — happy path + statistical isolation', () => {
  it('creates, enqueues, audits PII-free, revalidates ONLY training surfaces', async () => {
    const r = await createTrainingAnnotationAction(
      MEMBER_ID,
      TT_ID,
      null,
      form({
        comment: 'Entrée anticipée — attends la confirmation.',
        mediaKey: OWN_MEDIA,
        mediaType: 'image',
      }),
    );
    expect(r.ok).toBe(true);

    expect(createTrainingAnnotationMock).toHaveBeenCalledWith({
      trainingTradeId: TT_ID,
      adminId: ADMIN_ID,
      comment: 'Entrée anticipée — attends la confirmation.',
      mediaKey: OWN_MEDIA,
      mediaType: 'image',
    });
    expect(enqueueMock).toHaveBeenCalledWith(MEMBER_ID, {
      trainingAnnotationId: 'ta_1',
      trainingTradeId: TT_ID,
      adminId: ADMIN_ID,
      hasMedia: true,
    });

    // 🚨 §21.5 — audit metadata is ids/flags ONLY, never the comment text.
    const auditArg = logAuditMock.mock.calls[0]?.[0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(auditArg.action).toBe('admin.training_annotation.created');
    expect(Object.keys(auditArg.metadata).sort()).toEqual(
      ['hasMedia', 'mediaType', 'memberId', 'trainingAnnotationId', 'trainingTradeId'].sort(),
    );
    expect(auditArg.metadata).not.toHaveProperty('comment');

    // 🚨 §21.5 — never revalidate a real-edge surface.
    const paths = revalidatePathMock.mock.calls.map((c) => c[0]);
    expect(paths).toContain(`/admin/members/${MEMBER_ID}/training/${TT_ID}`);
    expect(paths).toContain(`/training/${TT_ID}`);
    expect(paths).not.toContain('/journal');
    expect(paths).not.toContain(`/journal/${TT_ID}`);
    expect(paths).not.toContain('/dashboard');
  });

  it('no-media path: hasMedia false, no mediaType', async () => {
    const r = await createTrainingAnnotationAction(
      MEMBER_ID,
      TT_ID,
      null,
      form({ comment: 'Analyse propre, rien à corriger.' }),
    );
    expect(r.ok).toBe(true);
    expect(createTrainingAnnotationMock).toHaveBeenCalledWith(
      expect.objectContaining({ mediaKey: null, mediaType: null }),
    );
    expect(enqueueMock).toHaveBeenCalledWith(
      MEMBER_ID,
      expect.objectContaining({ hasMedia: false }),
    );
  });
});

describe('deleteTrainingAnnotationAction', () => {
  it('forbidden for a non-admin', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u', status: 'active', role: 'member' } });
    const r = await deleteTrainingAnnotationAction('ta_1');
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(deleteTrainingAnnotationMock).not.toHaveBeenCalled();
  });

  it('not_found when the annotation does not exist', async () => {
    getTrainingAnnotationByIdMock.mockResolvedValueOnce(null);
    const r = await deleteTrainingAnnotationAction('ta_missing');
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(deleteTrainingAnnotationMock).not.toHaveBeenCalled();
  });

  it('deletes, audits, revalidates only training surfaces', async () => {
    getTrainingAnnotationByIdMock.mockResolvedValueOnce({
      id: 'ta_1',
      trainingTradeId: TT_ID,
      mediaKey: OWN_MEDIA,
    });
    findUniqueMock.mockResolvedValueOnce({ userId: MEMBER_ID });
    deleteTrainingAnnotationMock.mockResolvedValueOnce(undefined);

    const r = await deleteTrainingAnnotationAction('ta_1');
    expect(r).toEqual({ ok: true });
    expect(deleteTrainingAnnotationMock).toHaveBeenCalledWith('ta_1', ADMIN_ID);
    expect(storageDeleteMock).toHaveBeenCalledWith(OWN_MEDIA);

    const auditArg = logAuditMock.mock.calls[0]?.[0] as { action: string };
    expect(auditArg.action).toBe('admin.training_annotation.deleted');

    const paths = revalidatePathMock.mock.calls.map((c) => c[0]);
    expect(paths).not.toContain('/journal');
    expect(paths).not.toContain('/dashboard');
  });
});
