import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Journal Server Actions — F2 timezone coverage for the trade WRITERS.
 *
 * The training writer (`createTrainingTradeAction`) already pins the
 * member-wall-clock → UTC conversion (actions.test.ts §F2 + e2e). The journal
 * writers — `createTradeAction` (entry) and `closeTradeAction` (exit) — carry
 * the SAME `memberWallClock` helper but had ZERO conversion coverage (audit
 * 2026-07-01 P1). A future regression on either writer, or on `closeTrade`'s
 * exit-before-entry guard which compares two CONVERTED instants, would have
 * slipped through. These tests close that gap with the symmetric NY/Paris/
 * fallback/ISO-Z matrix.
 *
 * Mocking strategy mirrors `training/actions.test.ts`: `@/auth`,
 * `next/navigation`, `next/cache`, the trade service, audit, observability,
 * pre-trade link + schedulers are mocked so we exercise the action's branching.
 * `@/lib/schemas/trade` (Zod) and `@/lib/checkin/timezone` (the conversion
 * under test) are kept REAL. `@/lib/storage/local` is mocked only to dodge its
 * `import 'server-only'` (the BOLA gate it provides is covered by its own
 * suite — not the F2 concern here).
 */

const authMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const redirectMock = vi.fn<(url: string) => never>((url: string) => {
  const err = Object.assign(new Error('NEXT_REDIRECT'), {
    digest: `NEXT_REDIRECT;replace;${url}`,
  });
  throw err;
});
const revalidatePathMock = vi.fn<(path: string) => void>();
const createTradeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const closeTradeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const deleteTradeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const reportErrorMock = vi.fn<(...args: unknown[]) => void>();
const linkRecentCheckToTradeMock = vi.fn<(...args: unknown[]) => Promise<string | null>>(
  async () => null,
);
const scheduleScoreRecomputeMock = vi.fn<(...args: unknown[]) => void>();
const scheduleDouglasDispatchMock = vi.fn<(...args: unknown[]) => void>();

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/trades/service', () => ({
  createTrade: createTradeMock,
  closeTrade: closeTradeMock,
  deleteTrade: deleteTradeMock,
  // Real-shaped error classes so the action's `instanceof` checks stay sound
  // even though the happy-path conversion tests never enter the catch block.
  TradeNotFoundError: class TradeNotFoundError extends Error {},
  TradeAlreadyClosedError: class TradeAlreadyClosedError extends Error {},
  TradeExitBeforeEntryError: class TradeExitBeforeEntryError extends Error {},
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('@/lib/observability', () => ({ reportError: reportErrorMock }));
vi.mock('@/lib/pre-trade/service', () => ({
  linkRecentCheckToTrade: linkRecentCheckToTradeMock,
}));
vi.mock('@/lib/scoring/scheduler', () => ({ scheduleScoreRecompute: scheduleScoreRecomputeMock }));
vi.mock('@/lib/cards/scheduler', () => ({ scheduleDouglasDispatch: scheduleDouglasDispatchMock }));
// Dodge `import 'server-only'` in storage/local; BOLA is tested in its own suite.
vi.mock('@/lib/storage/local', () => ({ keyBelongsTo: () => true }));

const { createTradeAction, closeTradeAction } = await import('./actions');

const MEMBER_ID = 'clx0member01';
const OWN_ENTRY_KEY = `trades/${MEMBER_ID}/abcdef0123456789abcdef0123456789.png`;
const OWN_EXIT_KEY = `trades/${MEMBER_ID}/fedcba9876543210fedcba9876543210.png`;
const TRADE_ID = 'clx0trade00000001';

// Fixed past instants so the schema's "no future date" refine always passes for
// the non-conversion fields.
const ENTERED_AT = '2026-05-05T08:00:00.000Z';
const EXITED_AT = '2026-05-05T11:00:00.000Z';

function openForm(overrides: Record<string, string> = {}, emotions: string[] = ['calm']): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    pair: 'EURUSD',
    direction: 'long',
    session: 'london',
    enteredAt: ENTERED_AT,
    entryPrice: '1.1',
    lotSize: '0.5',
    plannedRR: '2',
    planRespected: 'true',
    hedgeRespected: 'na',
    notes: 'Setup propre.',
    screenshotEntryKey: OWN_ENTRY_KEY,
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  for (const e of emotions) fd.append('emotionBefore', e);
  return fd;
}

function closeForm(
  overrides: Record<string, string> = {},
  during: string[] = ['calm'],
  after: string[] = ['confident'],
): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    exitedAt: EXITED_AT,
    exitPrice: '1.105',
    outcome: 'win',
    notes: 'TP atteint, discipline OK.',
    screenshotExitKey: OWN_EXIT_KEY,
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  for (const e of during) fd.append('emotionDuring', e);
  for (const e of after) fd.append('emotionAfter', e);
  return fd;
}

beforeEach(() => {
  authMock.mockReset();
  redirectMock.mockClear();
  revalidatePathMock.mockReset();
  createTradeMock.mockReset();
  closeTradeMock.mockReset();
  deleteTradeMock.mockReset();
  logAuditMock.mockClear();
  reportErrorMock.mockClear();
  linkRecentCheckToTradeMock.mockClear();
  scheduleScoreRecomputeMock.mockClear();
  scheduleDouglasDispatchMock.mockClear();

  // Default session has NO timezone → exercises the Europe/Paris fallback.
  authMock.mockResolvedValue({ user: { id: MEMBER_ID, status: 'active' } });
  createTradeMock.mockResolvedValue({ id: TRADE_ID });
  closeTradeMock.mockResolvedValue(undefined);
  linkRecentCheckToTradeMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createTradeAction — F2 enteredAt interpreted in the member SET timezone', () => {
  it('converts a bare NY wall-clock (EDT = UTC-4) to the right UTC instant', async () => {
    authMock.mockResolvedValue({
      user: { id: MEMBER_ID, status: 'active', timezone: 'America/New_York' },
    });
    // 14:30 wall-clock on 2026-05-06 in New York (DST, UTC-4) → 18:30Z.
    await expect(
      createTradeAction(null, openForm({ enteredAt: '2026-05-06T14:30' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    const arg = createTradeMock.mock.calls[0]?.[1] as { enteredAt: Date };
    expect(arg.enteredAt.toISOString()).toBe('2026-05-06T18:30:00.000Z');
  });

  it('interprets the SAME wall-clock for a Paris member (CEST = UTC+2 → 12:30Z)', async () => {
    authMock.mockResolvedValue({
      user: { id: MEMBER_ID, status: 'active', timezone: 'Europe/Paris' },
    });
    await expect(
      createTradeAction(null, openForm({ enteredAt: '2026-05-06T14:30' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    const arg = createTradeMock.mock.calls[0]?.[1] as { enteredAt: Date };
    expect(arg.enteredAt.toISOString()).toBe('2026-05-06T12:30:00.000Z');
  });

  it('falls back to Europe/Paris when the session carries no timezone', async () => {
    await expect(
      createTradeAction(null, openForm({ enteredAt: '2026-05-06T14:30' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    const arg = createTradeMock.mock.calls[0]?.[1] as { enteredAt: Date };
    expect(arg.enteredAt.toISOString()).toBe('2026-05-06T12:30:00.000Z');
  });

  it('still accepts an already-absolute ISO instant (Z suffix) unchanged', async () => {
    authMock.mockResolvedValue({
      user: { id: MEMBER_ID, status: 'active', timezone: 'America/New_York' },
    });
    await expect(
      createTradeAction(null, openForm({ enteredAt: '2026-05-06T18:30:00.000Z' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    const arg = createTradeMock.mock.calls[0]?.[1] as { enteredAt: Date };
    expect(arg.enteredAt.toISOString()).toBe('2026-05-06T18:30:00.000Z');
  });
});

describe('closeTradeAction — F2 exitedAt interpreted in the member SET timezone', () => {
  it('converts a bare NY wall-clock (EDT = UTC-4) to the right UTC instant', async () => {
    authMock.mockResolvedValue({
      user: { id: MEMBER_ID, status: 'active', timezone: 'America/New_York' },
    });
    await expect(
      closeTradeAction(TRADE_ID, null, closeForm({ exitedAt: '2026-05-06T14:30' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    // closeTrade(userId, tradeId, { exitedAt, … }) → the data object is arg #2.
    const arg = closeTradeMock.mock.calls[0]?.[2] as { exitedAt: Date };
    expect(arg.exitedAt.toISOString()).toBe('2026-05-06T18:30:00.000Z');
  });

  it('falls back to Europe/Paris when the session carries no timezone (→ 12:30Z)', async () => {
    await expect(
      closeTradeAction(TRADE_ID, null, closeForm({ exitedAt: '2026-05-06T14:30' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    const arg = closeTradeMock.mock.calls[0]?.[2] as { exitedAt: Date };
    expect(arg.exitedAt.toISOString()).toBe('2026-05-06T12:30:00.000Z');
  });

  it('still accepts an already-absolute ISO instant (Z suffix) unchanged', async () => {
    authMock.mockResolvedValue({
      user: { id: MEMBER_ID, status: 'active', timezone: 'America/New_York' },
    });
    await expect(
      closeTradeAction(TRADE_ID, null, closeForm({ exitedAt: '2026-05-06T18:30:00.000Z' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    const arg = closeTradeMock.mock.calls[0]?.[2] as { exitedAt: Date };
    expect(arg.exitedAt.toISOString()).toBe('2026-05-06T18:30:00.000Z');
  });

  it('surfaces an exit-before-entry rejection on the exitedAt field (cross-tz guard)', async () => {
    authMock.mockResolvedValue({
      user: { id: MEMBER_ID, status: 'active', timezone: 'America/New_York' },
    });
    // The service compares the CONVERTED exit instant against the stored entry;
    // when it rejects, the action maps it to a field error (not a 500). We drive
    // the service mock to throw the domain error to assert that mapping holds for
    // a timezone-converted exit.
    const { TradeExitBeforeEntryError } = await import('@/lib/trades/service');
    closeTradeMock.mockRejectedValueOnce(new TradeExitBeforeEntryError());

    const result = await closeTradeAction(
      TRADE_ID,
      null,
      closeForm({ exitedAt: '2026-05-06T14:30' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors?.exitedAt).toBeDefined();
    }
    // The converted instant still reached the service before it rejected.
    const arg = closeTradeMock.mock.calls[0]?.[2] as { exitedAt: Date };
    expect(arg.exitedAt.toISOString()).toBe('2026-05-06T18:30:00.000Z');
  });
});
