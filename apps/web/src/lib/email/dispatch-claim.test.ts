import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryRawMock = vi.fn();
const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const deleteManyMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
    emailDispatchClaim: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      deleteMany: (...args: unknown[]) => deleteManyMock(...args),
    },
  },
}));

const {
  DISPATCH_CLAIM_STALE_AFTER_MS,
  claimEmailDispatch,
  markDispatchDelivered,
  releaseEmailDispatch,
} = await import('./dispatch-claim');

/**
 * J10 correctif n°6 — LES tests qui auraient détecté le défaut.
 *
 * Le défaut : `dispatchMonthlyDebriefToMember` envoyait push → email → marquage.
 * Un échec du marquage laissait `sentToMemberAt` à `null`, et la relance
 * suivante du batch renvoyait un DEUXIÈME email au membre.
 *
 * Ce banc vérifie le MÉCANISME de réservation. L'atomicité réelle de la
 * contrainte unique sous concurrence est prouvée séparément contre un vrai
 * Postgres — voir `ops/scripts/verify-dispatch-idempotency.mjs` : la mocker
 * ici reviendrait à modéliser l'hypothèse qu'on cherche à vérifier.
 */
beforeEach(() => {
  queryRawMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  deleteManyMock.mockReset();
});

const base = { userId: 'usr_1', type: 'monthly_debrief_ready', period: '2026-08-01' };

describe('claimEmailDispatch', () => {
  it('grants the claim when the insert returns a row', async () => {
    queryRawMock.mockResolvedValue([{ id: 'claim_1' }]);
    await expect(claimEmailDispatch(base)).resolves.toEqual({ ok: true, claimId: 'claim_1' });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('refuses with already_delivered once the send is confirmed (regression J10-6)', async () => {
    // L'état nominal en régime permanent : le débrief a déjà été envoyé.
    // Avant ce correctif, c'est ici qu'un second email partait.
    queryRawMock.mockResolvedValue([]);
    findUniqueMock.mockResolvedValue({ deliveredAt: new Date('2026-08-01T09:00:00Z') });
    await expect(claimEmailDispatch(base)).resolves.toEqual({
      ok: false,
      reason: 'already_delivered',
    });
  });

  it('refuses with in_flight when another run holds a fresh claim', async () => {
    queryRawMock.mockResolvedValue([]);
    findUniqueMock.mockResolvedValue({ deliveredAt: null });
    await expect(claimEmailDispatch(base)).resolves.toEqual({ ok: false, reason: 'in_flight' });
  });

  it('treats a missing row as in_flight rather than crashing', async () => {
    // Course rarissime : la réservation concurrente a été libérée entre
    // l'INSERT et la relecture. Ne rien envoyer est le choix sûr — la relance
    // suivante réessaiera.
    queryRawMock.mockResolvedValue([]);
    findUniqueMock.mockResolvedValue(null);
    await expect(claimEmailDispatch(base)).resolves.toEqual({ ok: false, reason: 'in_flight' });
  });

  it('reclaims only claims older than the lease, and never a delivered one', async () => {
    queryRawMock.mockResolvedValue([{ id: 'claim_1' }]);
    const now = new Date('2026-08-01T12:00:00.000Z');
    await claimEmailDispatch({ ...base, now });

    const [strings, ...values] = queryRawMock.mock.calls[0] as [string[], ...unknown[]];
    const sql = strings.join('?');
    // Les deux conditions de reprise sont dans la MÊME instruction : il n'y a
    // pas de fenêtre « lire puis écrire » entre elles.
    expect(sql).toContain('ON CONFLICT (user_id, type, period) DO UPDATE');
    expect(sql).toContain('delivered_at IS NULL');
    expect(sql).toContain('claimed_at <');
    // Le bail est bien remonté dans le passé de la durée annoncée.
    const staleBefore = values.at(-1) as Date;
    expect(now.getTime() - staleBefore.getTime()).toBe(DISPATCH_CLAIM_STALE_AFTER_MS);
  });

  it('keeps the lease long enough to never double a send in progress', () => {
    // Un envoi Resend se compte en secondes ; une réservation qui traîne une
    // demi-heure est un incident, pas un envoi lent.
    expect(DISPATCH_CLAIM_STALE_AFTER_MS).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });
});

describe('confirming and releasing', () => {
  it('stamps delivery so nothing can reclaim it', async () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    await markDispatchDelivered('claim_1', now);
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'claim_1' },
      data: { deliveredAt: now },
    });
  });

  it('releases a failed send so the next run retries immediately', async () => {
    // C'est ce qui permet de fermer le doublon SANS retomber dans la
    // non-délivrance silencieuse qu'un « marquer d'abord » aurait provoquée.
    deleteManyMock.mockResolvedValue({ count: 1 });
    await releaseEmailDispatch('claim_1');
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { id: 'claim_1', deliveredAt: null },
    });
  });

  it('never releases a claim that was already delivered', async () => {
    deleteManyMock.mockResolvedValue({ count: 0 });
    await releaseEmailDispatch('claim_1');
    const arg = deleteManyMock.mock.calls[0]?.[0] as { where: { deliveredAt: null } };
    expect(arg.where.deliveredAt).toBeNull();
  });

  it('swallows a release failure — the lease is the backstop', async () => {
    deleteManyMock.mockRejectedValue(new Error('connection lost'));
    await expect(releaseEmailDispatch('claim_1')).resolves.toBeUndefined();
  });
});
