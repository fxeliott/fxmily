import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J4 (SPEC §7.8) — Server Action tests for the admin real-trade annotation
 * workflow (`createAnnotationAction` / `deleteAnnotationAction`).
 *
 * Critical logic surface (CLAUDE.md "tests pour la logique critique"): admin
 * auth+role gate + Zod re-parse + parent ownership + audit + revalidate. The
 * collaborators are mocked (`@/auth`, `next/cache`, service, audit, enqueue,
 * email, micro-objective, db, storage) but `annotationCreateSchema` is kept
 * REAL (pure, no IO) so the fieldErrors + TradingView-link gate are genuinely
 * exercised.
 *
 * Tour 13 — the optional artefact is a TradingView link (validated + hardened
 * at the Zod edge) in place of the former upload; there is no media-key BOLA
 * gate anymore. Legacy uploaded captures stay READABLE but are never created.
 */

const authMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const revalidatePathMock = vi.fn<(path: string) => void>();
const createAnnotationMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const deleteAnnotationMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const getAnnotationByIdMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const enqueueMock = vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => 'notif_1');
const ensureMicroObjectiveMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => undefined,
);
const findUniqueMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const storageDeleteMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const sendEmailMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ id: 'em_1' }));

class AnnotationNotFoundError extends Error {}

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/admin/annotations-service', () => ({
  createAnnotation: createAnnotationMock,
  deleteAnnotation: deleteAnnotationMock,
  getAnnotationById: getAnnotationByIdMock,
  AnnotationNotFoundError,
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('@/lib/notifications/enqueue', () => ({ enqueueAnnotationNotification: enqueueMock }));
vi.mock('@/lib/coaching/micro-objective', () => ({
  ensureMicroObjectiveFromAnnotation: ensureMicroObjectiveMock,
}));
vi.mock('@/lib/db', () => ({ db: { trade: { findUnique: findUniqueMock } } }));
vi.mock('@/lib/email/send', () => ({ sendAnnotationReceivedEmail: sendEmailMock }));
vi.mock('@/lib/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage');
  return { ...actual, selectStorage: () => ({ delete: storageDeleteMock }) };
});

const { createAnnotationAction, deleteAnnotationAction } = await import('./actions');

const ADMIN_ID = 'clx0admin001';
const MEMBER_ID = 'clx0member01';
const MEMBER_EMAIL = 'member@e2e.test';
const TRADE_ID = 'clx0trade001';
const TV_URL = `https://fr.tradingview.com/x/${'a'.repeat(12)}/`;
// Legacy media key — still used by deleteAnnotationAction (purges a
// pre-Tour-13 uploaded file), never accepted on create anymore.
const LEGACY_MEDIA = `annotations/${TRADE_ID}/dddddddddddddddddddddddddddddddd.png`;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  authMock.mockReset();
  revalidatePathMock.mockReset();
  createAnnotationMock.mockReset();
  deleteAnnotationMock.mockReset();
  getAnnotationByIdMock.mockReset();
  logAuditMock.mockClear();
  enqueueMock.mockClear();
  ensureMicroObjectiveMock.mockClear();
  findUniqueMock.mockReset();
  storageDeleteMock.mockClear();
  sendEmailMock.mockClear();

  authMock.mockResolvedValue({
    user: { id: ADMIN_ID, status: 'active', role: 'admin', name: 'Eliott' },
  });
  findUniqueMock.mockResolvedValue({
    pair: 'EURUSD',
    userId: MEMBER_ID,
    user: { email: MEMBER_EMAIL, firstName: 'Alice' },
  });
  createAnnotationMock.mockResolvedValue({ id: 'an_1' });
});

describe('createAnnotationAction — auth/role gate', () => {
  it('unauthorized when no session', async () => {
    authMock.mockResolvedValueOnce(null);
    const r = await createAnnotationAction(MEMBER_ID, TRADE_ID, null, form({ comment: 'x' }));
    expect(r).toEqual({ ok: false, error: 'unauthorized' });
    expect(createAnnotationMock).not.toHaveBeenCalled();
  });

  it('forbidden when the session is not an admin', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u', status: 'active', role: 'member' } });
    const r = await createAnnotationAction(MEMBER_ID, TRADE_ID, null, form({ comment: 'x' }));
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(createAnnotationMock).not.toHaveBeenCalled();
  });
});

describe('createAnnotationAction — validation + TradingView link gate (real Zod)', () => {
  it('invalid_input + fieldErrors when comment is empty', async () => {
    const r = await createAnnotationAction(MEMBER_ID, TRADE_ID, null, form({ comment: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid_input');
      expect(r.fieldErrors?.comment).toBeDefined();
    }
    expect(createAnnotationMock).not.toHaveBeenCalled();
  });

  it('rejects an off-host TradingView link (fieldErrors.tradingViewUrl)', async () => {
    const r = await createAnnotationAction(
      MEMBER_ID,
      TRADE_ID,
      null,
      form({ comment: 'Bon plan.', tradingViewUrl: 'https://evil.example.com/x/abc/' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid_input');
      expect(r.fieldErrors?.tradingViewUrl).toBeDefined();
    }
    expect(createAnnotationMock).not.toHaveBeenCalled();
  });

  it('trade_not_found when the trade is absent or not owned by the member', async () => {
    findUniqueMock.mockResolvedValueOnce({ pair: 'EURUSD', userId: 'someone_else', user: {} });
    const r = await createAnnotationAction(
      MEMBER_ID,
      TRADE_ID,
      null,
      form({ comment: 'Bon plan.' }),
    );
    expect(r).toEqual({ ok: false, error: 'trade_not_found' });
    expect(createAnnotationMock).not.toHaveBeenCalled();
  });
});

describe('createAnnotationAction — happy path', () => {
  it('creates with the TradingView link, enqueues, emails, audits (hasTradingViewUrl), revalidates', async () => {
    const r = await createAnnotationAction(
      MEMBER_ID,
      TRADE_ID,
      null,
      form({ comment: 'Sizing doublé après 2 wins, attention.', tradingViewUrl: TV_URL }),
    );
    expect(r.ok).toBe(true);

    expect(createAnnotationMock).toHaveBeenCalledWith({
      tradeId: TRADE_ID,
      adminId: ADMIN_ID,
      comment: 'Sizing doublé après 2 wins, attention.',
      tradingViewUrl: TV_URL,
      axis: null,
    });
    expect(enqueueMock).toHaveBeenCalledWith(MEMBER_ID, {
      annotationId: 'an_1',
      tradeId: TRADE_ID,
      adminId: ADMIN_ID,
      hasMedia: true,
    });
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: MEMBER_EMAIL, tradePair: 'EURUSD', hasMedia: true }),
    );

    const auditArg = logAuditMock.mock.calls[0]?.[0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(auditArg.action).toBe('admin.annotation.created');
    expect(auditArg.metadata.hasTradingViewUrl).toBe(true);
    expect(auditArg.metadata).not.toHaveProperty('mediaType');

    const paths = revalidatePathMock.mock.calls.map((c) => c[0]);
    expect(paths).toContain(`/admin/members/${MEMBER_ID}/trades/${TRADE_ID}`);
    expect(paths).toContain(`/journal/${TRADE_ID}`);
  });

  it('no-link path: hasMedia false, tradingViewUrl null', async () => {
    const r = await createAnnotationAction(
      MEMBER_ID,
      TRADE_ID,
      null,
      form({ comment: 'Bon respect du plan.' }),
    );
    expect(r.ok).toBe(true);
    expect(createAnnotationMock).toHaveBeenCalledWith(
      expect.objectContaining({ tradingViewUrl: null }),
    );
    expect(enqueueMock).toHaveBeenCalledWith(
      MEMBER_ID,
      expect.objectContaining({ hasMedia: false }),
    );
    const auditArg = logAuditMock.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(auditArg.metadata.hasTradingViewUrl).toBe(false);
  });
});

describe('deleteAnnotationAction', () => {
  it('forbidden for a non-admin', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'u', status: 'active', role: 'member' } });
    const r = await deleteAnnotationAction('an_1');
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(deleteAnnotationMock).not.toHaveBeenCalled();
  });

  it('not_found when the annotation does not exist', async () => {
    getAnnotationByIdMock.mockResolvedValueOnce(null);
    const r = await deleteAnnotationAction('an_missing');
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(deleteAnnotationMock).not.toHaveBeenCalled();
  });

  it('deletes, purges a legacy media file, audits, revalidates', async () => {
    getAnnotationByIdMock.mockResolvedValueOnce({
      id: 'an_1',
      tradeId: TRADE_ID,
      mediaKey: LEGACY_MEDIA,
    });
    findUniqueMock.mockResolvedValueOnce({ userId: MEMBER_ID });
    deleteAnnotationMock.mockResolvedValueOnce(undefined);

    const r = await deleteAnnotationAction('an_1');
    expect(r).toEqual({ ok: true });
    expect(deleteAnnotationMock).toHaveBeenCalledWith('an_1', ADMIN_ID);
    expect(storageDeleteMock).toHaveBeenCalledWith(LEGACY_MEDIA);

    const auditArg = logAuditMock.mock.calls[0]?.[0] as { action: string };
    expect(auditArg.action).toBe('admin.annotation.deleted');
  });
});
