'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import {
  CardNotFoundError,
  markDeliveryDismissed,
  markDeliverySeen,
  setDeliveryHelpful,
  toggleFavorite,
} from '@/lib/cards/service';

/**
 * Member-side Server Actions for the `/library` flow (J7).
 *
 * Pattern recap:
 *   - `auth()` re-check (defence in depth on top of `proxy.ts` gate).
 *   - Service call.
 *   - Audit (best-effort, never blocking).
 *   - `revalidatePath` for both /library and /dashboard (badge counter).
 */

export interface LibraryActionState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'not_found' | 'unknown';
}

function badAuth(): LibraryActionState {
  return { ok: false, error: 'unauthorized' };
}

export async function markDeliverySeenAction(deliveryId: string): Promise<LibraryActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') return badAuth();

  if (typeof deliveryId !== 'string' || deliveryId.length === 0) {
    return { ok: false, error: 'invalid_input' };
  }

  try {
    const changed = await markDeliverySeen(session.user.id, deliveryId);
    if (changed) {
      await logAudit({
        action: 'douglas.delivery.seen',
        userId: session.user.id,
        metadata: { deliveryId },
      });
    }
    revalidatePath('/library');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (err) {
    console.error('[library.markSeen] failed', err);
    return { ok: false, error: 'unknown' };
  }
}

export async function dismissDeliveryAction(deliveryId: string): Promise<LibraryActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') return badAuth();

  if (typeof deliveryId !== 'string' || deliveryId.length === 0) {
    return { ok: false, error: 'invalid_input' };
  }

  try {
    const changed = await markDeliveryDismissed(session.user.id, deliveryId);
    if (changed) {
      await logAudit({
        action: 'douglas.delivery.dismissed',
        userId: session.user.id,
        metadata: { deliveryId },
      });
    }
    revalidatePath('/library');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (err) {
    console.error('[library.dismiss] failed', err);
    return { ok: false, error: 'unknown' };
  }
}

export async function setDeliveryHelpfulAction(
  deliveryId: string,
  helpful: boolean,
): Promise<LibraryActionState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') return badAuth();

  if (typeof deliveryId !== 'string' || deliveryId.length === 0) {
    return { ok: false, error: 'invalid_input' };
  }
  if (typeof helpful !== 'boolean') {
    return { ok: false, error: 'invalid_input' };
  }

  try {
    const changed = await setDeliveryHelpful(session.user.id, deliveryId, helpful);
    if (changed) {
      await logAudit({
        action: 'douglas.delivery.helpful',
        userId: session.user.id,
        metadata: { deliveryId, helpful },
      });
    }
    revalidatePath('/library');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (err) {
    console.error('[library.helpful] failed', err);
    return { ok: false, error: 'unknown' };
  }
}

export interface ToggleFavoriteState {
  ok: boolean;
  error?: 'unauthorized' | 'invalid_input' | 'not_found' | 'unknown';
  /** New state after toggle. */
  favorited?: boolean;
}

export async function toggleFavoriteAction(cardId: string): Promise<ToggleFavoriteState> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') return badAuth();

  if (typeof cardId !== 'string' || cardId.length === 0) {
    return { ok: false, error: 'invalid_input' };
  }

  try {
    const result = await toggleFavorite(session.user.id, cardId);
    await logAudit({
      action: result.favorited ? 'douglas.favorite.added' : 'douglas.favorite.removed',
      userId: session.user.id,
      metadata: { cardId },
    });
    revalidatePath('/library');
    revalidatePath(`/library/${cardId}`);
    return { ok: true, favorited: result.favorited };
  } catch (err) {
    if (err instanceof CardNotFoundError) {
      return { ok: false, error: 'not_found' };
    }
    console.error('[library.toggleFavorite] failed', err);
    return { ok: false, error: 'unknown' };
  }
}
