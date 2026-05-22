/**
 * Pure-functions math + invariants pour `PublicTrade` (T5).
 *
 * Extrait de `public-trade-service.ts` (qui impose `server-only`) pour
 * permettre des unit-tests sans DB ni serveur Node. Pattern carbone
 * `lib/analytics/wilson.ts` + `lib/checkin/streak.ts`.
 *
 * Aucun import `prisma`, `db`, `auth`, `next/*` ici — c'est la garantie
 * structurelle de testabilité.
 */

import type { PublicTradeStatus } from '@/generated/prisma/enums';

/**
 * Compute `resultPercent` from status/risk/R. Service est la SSOT de ce
 * champ (jamais accepté du form — anti-tamper + cohérence garantie).
 *
 *   - open       → null (pas encore résolu)
 *   - break_even → 0
 *   - closed     → riskPercent × resultR (signed, 3 décimales)
 *
 * Arrondi 3 décimales pour matcher Decimal(6,3) sans drift d'arrondi
 * JS (1.0 × 0.1 = 0.10000000000000001 sinon).
 */
export function computeResultPercent(
  status: PublicTradeStatus,
  riskPercent: number,
  resultR: number | null | undefined,
): number | null {
  if (status === 'open') return null;
  if (status === 'break_even') return 0;
  if (resultR === null || resultR === undefined) return null;
  return Math.round(riskPercent * resultR * 1000) / 1000;
}

/**
 * Levée par `validateLifecycleInvariants` sur état mergé invalide. Le
 * Server Action catch et mappe `field` → `fieldErrors`.
 */
export class PublicTradeInvalidStateError extends Error {
  public readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'PublicTradeInvalidStateError';
    this.field = field;
  }
}

/**
 * Lifecycle invariants — service-level enforcement (post-merge contre l'état
 * DB sur update). Le Zod superRefine du `publicTradeCreateSchema` couvre
 * déjà le create path ; cette fonction est essentielle sur update où le
 * payload est partial (l'admin peut envoyer status='closed' seul, sans
 * exitedAt/resultR — interdit si l'état DB est aussi vide).
 *
 *   - status='closed'     → exitedAt + resultR REQUIRED
 *   - status='break_even' → exitedAt REQUIRED, resultR ∈ {0, null}
 *   - exitedAt présent    → DOIT être > enteredAt
 */
export function validateLifecycleInvariants(merged: {
  status: PublicTradeStatus;
  enteredAt: Date;
  exitedAt: Date | null;
  riskPercent: number;
  resultR: number | null;
}): void {
  if (merged.status === 'closed') {
    if (!merged.exitedAt) {
      throw new PublicTradeInvalidStateError('exitedAt', 'exitedAt requis quand status = closed.');
    }
    if (merged.resultR === null) {
      throw new PublicTradeInvalidStateError('resultR', 'resultR requis quand status = closed.');
    }
  }
  if (merged.status === 'break_even') {
    if (!merged.exitedAt) {
      throw new PublicTradeInvalidStateError(
        'exitedAt',
        'exitedAt requis quand status = break_even.',
      );
    }
    if (merged.resultR !== null && merged.resultR !== 0) {
      throw new PublicTradeInvalidStateError(
        'resultR',
        'resultR doit être 0 (ou vide) quand status = break_even.',
      );
    }
  }
  if (merged.exitedAt && merged.exitedAt < merged.enteredAt) {
    throw new PublicTradeInvalidStateError(
      'exitedAt',
      'exitedAt doit être postérieur à enteredAt.',
    );
  }
}
