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
import { reportWarning } from '@/lib/observability';
import {
  claimEmailDispatch,
  markDispatchDelivered,
  releaseEmailDispatch,
} from '@/lib/email/dispatch-claim';
import { EmailDeliveryError } from '@/lib/email/client';
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

  /**
   * Le tour suivant, joué contre une base qui SE SOUVIENT.
   *
   * Une première version de ce test remettait `sentToMemberAt: null` dans la
   * fixture entre les deux tours : le second tour était donc dispatchable
   * **par le harnais**, jamais par le code, et il restait vert même en
   * réintroduisant le défaut. Une revue en contexte frais l'a prouvé par
   * mutation. C'est le canon déjà payé au J8 : un harnais qui modélise
   * l'hypothèse à vérifier ne peut jamais dire non.
   *
   * Ici, l'upsert relit un état que `update` a réellement écrit — c'est le
   * comportement de la base qui décide, pas la fixture.
   */
  it('email refusé : le membre reste dispatchable, donc la relance suivante repasse', async () => {
    // État persistant minimal : ce que `update` écrit, l'upsert le relit.
    let stored = persistedRow();
    // `as never` sur l'implémentation : le client Prisma renvoie un
    // `Prisma__MonthlyDebriefClient` (un « thenable » enrichi), pas une simple
    // promesse. Seul le contenu compte ici.
    vi.mocked(db.monthlyDebrief.upsert).mockImplementation((async () => stored) as never);
    vi.mocked(db.monthlyDebrief.update).mockImplementation((async ({
      data,
    }: {
      data: Record<string, unknown>;
    }) => {
      stored = { ...stored, ...data } as ReturnType<typeof persistedRow>;
      return stored;
    }) as never);

    vi.mocked(sendMonthlyDebriefReadyEmail).mockResolvedValue({ delivered: false } as never);
    await runBatch();
    expect(stored.sentToMemberAt, 'un envoi refusé ne doit pas marquer la ligne').toBeNull();

    // Tour suivant : l'email part cette fois. Le dispatch ne doit avoir lieu
    // que parce que la colonne est restée `null`.
    vi.mocked(sendMonthlyDebriefReadyEmail).mockResolvedValue({ delivered: true } as never);
    vi.mocked(sendMonthlyDebriefReadyEmail).mockClear();
    await runBatch();

    expect(sendMonthlyDebriefReadyEmail).toHaveBeenCalledOnce();
    expect(stored.sentToMemberAt).toBeInstanceOf(Date);

    // Troisième tour : maintenant que la ligne est marquée, plus aucun envoi.
    vi.mocked(sendMonthlyDebriefReadyEmail).mockClear();
    await runBatch();
    expect(sendMonthlyDebriefReadyEmail).not.toHaveBeenCalled();
  });

  /**
   * Adresse en liste de suppression (hard bounce / plainte) : réessayer est
   * sans espoir. Le traiter comme un échec ordinaire transformait le correctif
   * précédent en **alerte quotidienne perpétuelle** — `overdue.ts` lit
   * `sentToMemberAt`, donc un membre jamais marqué revient chaque jour dans le
   * rapport, l'admin relance, le même refus tombe. Une revue en contexte frais
   * a nommé ce risque ; ce test le verrouille dans les deux sens.
   */
  it('adresse morte : marque la ligne, confirme la réservation, et le dit', async () => {
    vi.mocked(sendMonthlyDebriefReadyEmail).mockResolvedValue({
      id: null,
      delivered: false,
      permanent: true,
    } as never);

    await runBatch();

    // Pas de relance : elle serait refusée à l'identique, indéfiniment.
    expect(markDispatchDelivered).toHaveBeenCalledWith('claim-1');
    expect(releaseEmailDispatch).not.toHaveBeenCalled();
    expect(stampedFields()?.['sentToMemberAt']).toBeInstanceOf(Date);

    // …mais la ligne ne prétend PAS que le membre a reçu quelque chose, et un
    // avertissement nommé porte le diagnostic.
    expect(stampedFields()).toMatchObject({ sentToMemberEmail: null });
    expect(reportWarning).toHaveBeenCalledWith(
      'monthly_debrief.batch',
      'member_email_undeliverable',
      expect.objectContaining({ userId: 'user-active-1' }),
    );
  });

  it('échec récupérable ≠ adresse morte : le cap quotidien laisse une relance', async () => {
    // `permanent` absent = réessayable. C'est la distinction qui empêche de
    // confondre « Resend est plein aujourd'hui » et « cette adresse est morte ».
    vi.mocked(sendMonthlyDebriefReadyEmail).mockResolvedValue({
      id: null,
      delivered: false,
    } as never);

    await runBatch();

    expect(releaseEmailDispatch).toHaveBeenCalledWith('claim-1');
    expect(markDispatchDelivered).not.toHaveBeenCalled();
    expect(Object.keys(stampedFields() ?? {})).not.toContain('sentToMemberAt');
  });

  /**
   * Une exception d'envoi n'est pas un `delivered: false` : elle saute par
   * dessus toutes les branches de décision. Sans libération explicite, la
   * réservation restait « en vol » jusqu'à l'expiration du bail — sur un batch
   * mensuel, cela repousse le membre d'un mois entier pour une panne réseau.
   */
  it('exception pendant l’envoi : la réservation est libérée, pas laissée en vol', async () => {
    vi.mocked(sendMonthlyDebriefReadyEmail).mockRejectedValue(new Error('Resend 503'));

    await runBatch();

    expect(releaseEmailDispatch).toHaveBeenCalledWith('claim-1');
    expect(markDispatchDelivered).not.toHaveBeenCalled();
    // Rien n'est marqué : le membre reste dispatchable au tour suivant.
    expect(db.monthlyDebrief.update).not.toHaveBeenCalled();
    // Et l'incident reste visible plutôt qu'avalé en silence.
    expect(reportWarning).toHaveBeenCalledWith(
      'monthly_debrief.batch',
      'member_dispatch_failed',
      expect.objectContaining({ userId: 'user-active-1' }),
    );
  });

  /**
   * Le pendant exact du test précédent, et la frontière entre les deux.
   *
   * Le dépassement de délai d'envoi n'annule PAS la requête vers Resend : elle
   * poursuit sa route et peut délivrer l'email. Libérer la réservation dans ce
   * cas retirerait le seul garde-fou contre un DOUBLE envoi — alors que le
   * mécanisme entier existe pour ça, et que la note du fichier promet un
   * résidu « borné ». Une première version libérait sur TOUTE exception, ce
   * qui rendait cette promesse fausse sur ce chemin précis.
   *
   * La réservation reste donc en vol et expire d'elle-même. Le batch tournant
   * une fois par mois, le membre est re-servi bien après l'expiration du bail
   * si l'email n'était finalement pas parti : rien n'est perdu.
   */
  it('délai d’envoi dépassé : la réservation N’EST PAS libérée (l’email a pu partir)', async () => {
    vi.mocked(sendMonthlyDebriefReadyEmail).mockRejectedValue(
      new EmailDeliveryError('Resend send timed out after 10000ms', null, true),
    );

    await runBatch();

    expect(releaseEmailDispatch).not.toHaveBeenCalled();
    expect(markDispatchDelivered).not.toHaveBeenCalled();
    expect(db.monthlyDebrief.update).not.toHaveBeenCalled();
    // L'incident reste visible : ne pas libérer n'est pas ne rien dire.
    expect(reportWarning).toHaveBeenCalledWith(
      'monthly_debrief.batch',
      'member_dispatch_failed',
      expect.objectContaining({ userId: 'user-active-1' }),
    );
  });

  it('refus explicite du fournisseur : la réservation EST libérée (échec certain)', async () => {
    // Même type d'erreur, drapeau à `false` : c'est bien le drapeau qui
    // décide, pas la classe de l'exception ni son message.
    vi.mocked(sendMonthlyDebriefReadyEmail).mockRejectedValue(
      new EmailDeliveryError('Resend rejected the email', { name: 'validation_error' }, false),
    );

    await runBatch();

    expect(releaseEmailDispatch).toHaveBeenCalledWith('claim-1');
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
