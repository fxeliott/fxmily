import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J10 correctif n°6 — bataille de l'APPELANT, pas de la fonction isolée.
 *
 * `dispatch-claim.test.ts` exerce `releaseEmailDispatch` toute seule et reste
 * vert quel que soit ce que le batch en fait ensuite. Une revue en contexte
 * frais l'a démontré : le premier jet libérait bien la réservation, puis
 * écrivait `sentToMemberAt` **quoi qu'il arrive** — et l'unique appelant ne
 * redispatche que sur `sentToMemberAt === null`. La relance promise par trois
 * commentaires était donc inatteignable, et un membre refusé par Resend (cap
 * quotidien atteint, ou destinataire supprimé : les deux rendent
 * `delivered: false` SANS lever) était marqué « notifié » sans rien recevoir.
 * `overdue.ts` lisant la même colonne, l'alerte d'exploitation ne partait pas
 * non plus.
 *
 * Ce fichier teste donc la jointure entre les deux : ce que le batch écrit en
 * base selon le sort réel de l'email. Il rougit si l'un des deux bouts se
 * remet à mentir à l'autre.
 */

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    monthlyDebrief: { upsert: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('@/lib/email/dispatch-claim', () => ({
  claimEmailDispatch: vi.fn(),
  markDispatchDelivered: vi.fn(),
  releaseEmailDispatch: vi.fn(),
}));
vi.mock('@/lib/email/send', () => ({ sendMonthlyDebriefReadyEmail: vi.fn() }));
vi.mock('@/lib/notifications/enqueue', () => ({ enqueueMonthlyDebriefNotification: vi.fn() }));

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import {
  claimEmailDispatch,
  markDispatchDelivered,
  releaseEmailDispatch,
} from '@/lib/email/dispatch-claim';
import { sendMonthlyDebriefReadyEmail } from '@/lib/email/send';
import { enqueueMonthlyDebriefNotification } from '@/lib/notifications/enqueue';

import { persistGeneratedReports } from './batch';

const MONTH_START = '2026-04-01';

function validOutput() {
  return {
    progressionNarrative:
      "Sur le mois, la discipline a progressé : le respect du plan est passé de soixante-cinq à quatre-vingts pour cent, signe d'une exécution plus posée et régulière.",
    summaryReal:
      'Douze trades réels ce mois, huit alignés au plan, deux pertes maîtrisées sous la zone de risque définie.',
    summaryTraining:
      "Pratique d'entraînement régulière ce mois : le volume de backtests reste constant, un bon rythme d'effort.",
    risks: ['Surveille la fatigue accumulée en fin de mois sur les sessions du soir.'],
    recommendations: [
      'Maintiens ta routine du matin (check-in puis revue du plan) chaque jour de trading.',
    ],
    patterns: {},
  };
}

/** Ligne telle que l'upsert la rend : jamais notifiée, donc dispatchable. */
function persistedRow() {
  return {
    id: 'debrief-1',
    userId: 'user-active-1',
    monthStart: new Date('2026-04-01T00:00:00Z'),
    monthEnd: new Date('2026-04-30T00:00:00Z'),
    generatedAt: new Date('2026-05-01T06:00:00Z'),
    ...validOutput(),
    claudeModel: 'claude-code-local',
    inputTokens: 100,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    costEur: { toString: () => '0' },
    sentToMemberAt: null,
    sentToMemberEmail: null,
    pushEnqueuedAt: null,
    seenAt: null,
  };
}

async function runBatch(): Promise<void> {
  await persistGeneratedReports({
    monthStart: MONTH_START,
    monthEnd: '2026-04-30',
    results: [{ userId: 'user-active-1', output: validOutput() }],
  });
}

/** Champs réellement écrits par le marquage de fin de dispatch. */
function stampedFields(): Record<string, unknown> | undefined {
  const call = vi.mocked(db.monthlyDebrief.update).mock.calls[0];
  return call?.[0]?.data as Record<string, unknown> | undefined;
}

describe('monthly debrief dispatch — ce que le batch écrit selon le sort de l’email', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: 'user-active-1' }] as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      email: 'membre@example.invalid',
      firstName: 'Membre',
    } as never);
    vi.mocked(db.monthlyDebrief.upsert).mockResolvedValue(persistedRow() as never);
    vi.mocked(db.monthlyDebrief.update).mockResolvedValue({} as never);
    vi.mocked(logAudit).mockResolvedValue(undefined);
    vi.mocked(claimEmailDispatch).mockResolvedValue({ ok: true, claimId: 'claim-1' });
    vi.mocked(enqueueMonthlyDebriefNotification).mockResolvedValue('notif-1');
  });

  it('email parti : confirme la réservation ET estampille sentToMemberAt', async () => {
    vi.mocked(sendMonthlyDebriefReadyEmail).mockResolvedValue({ delivered: true } as never);

    await runBatch();

    expect(markDispatchDelivered).toHaveBeenCalledWith('claim-1');
    expect(releaseEmailDispatch).not.toHaveBeenCalled();
    expect(stampedFields()).toMatchObject({ sentToMemberEmail: 'membre@example.invalid' });
    expect(stampedFields()?.['sentToMemberAt']).toBeInstanceOf(Date);
  });

  /**
   * LE test que le premier jet aurait échoué. Il ne suffit pas de vérifier que
   * la réservation est libérée : tant que `sentToMemberAt` est écrit, la porte
   * d'entrée du dispatch reste fermée et la libération ne sert à rien.
   */
  it("email refusé sans exception : libère la réservation ET n'estampille PAS sentToMemberAt", async () => {
    vi.mocked(sendMonthlyDebriefReadyEmail).mockResolvedValue({ delivered: false } as never);

    await runBatch();

    expect(releaseEmailDispatch).toHaveBeenCalledWith('claim-1');
    expect(markDispatchDelivered).not.toHaveBeenCalled();

    const data = stampedFields();
    expect(data).toBeDefined();
    // `undefined` ne suffit pas : sous `exactOptionalPropertyTypes`, la clé ne
    // doit tout simplement pas être transmise à Prisma.
    expect(Object.keys(data ?? {})).not.toContain('sentToMemberAt');
    expect(data).toMatchObject({ sentToMemberEmail: null });
  });

  it('email refusé : le membre reste dispatchable, donc la relance suivante repasse', async () => {
    vi.mocked(sendMonthlyDebriefReadyEmail).mockResolvedValue({ delivered: false } as never);
    await runBatch();

    // La colonne n'ayant pas bougé, la ligne relue au tour suivant porte
    // toujours `sentToMemberAt: null` — la condition d'entrée du dispatch.
    // On rejoue ce tour-là pour de vrai plutôt que de le raisonner.
    vi.mocked(sendMonthlyDebriefReadyEmail).mockResolvedValue({ delivered: true } as never);
    vi.mocked(db.monthlyDebrief.update).mockClear();
    vi.mocked(sendMonthlyDebriefReadyEmail).mockClear();

    await runBatch();

    expect(sendMonthlyDebriefReadyEmail).toHaveBeenCalledOnce();
    expect(stampedFields()?.['sentToMemberAt']).toBeInstanceOf(Date);
  });

  it('réservation refusée : aucun envoi, aucune écriture de marquage', async () => {
    vi.mocked(claimEmailDispatch).mockResolvedValue({ ok: false, reason: 'already_delivered' });

    await runBatch();

    expect(sendMonthlyDebriefReadyEmail).not.toHaveBeenCalled();
    expect(enqueueMonthlyDebriefNotification).not.toHaveBeenCalled();
    expect(db.monthlyDebrief.update).not.toHaveBeenCalled();
  });

  it('la réservation est prise AVANT tout envoi (l’ordre est le mécanisme)', async () => {
    const order: string[] = [];
    vi.mocked(claimEmailDispatch).mockImplementation(async () => {
      order.push('claim');
      return { ok: true, claimId: 'claim-1' };
    });
    vi.mocked(enqueueMonthlyDebriefNotification).mockImplementation(async () => {
      order.push('push');
      return 'notif-1';
    });
    vi.mocked(sendMonthlyDebriefReadyEmail).mockImplementation(async () => {
      order.push('email');
      return { delivered: true } as never;
    });

    await runBatch();

    expect(order).toEqual(['claim', 'push', 'email']);
  });
});
