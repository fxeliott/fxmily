'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { CardSlugTakenError, deleteCard, setPublished } from '@/lib/admin/cards-service';
import { CardNotFoundError } from '@/lib/cards/service';

/**
 * Admin Server Actions for Mark Douglas card management (J7).
 *
 * V1 ships only `setPublishedAction` and `deleteCardAction` — full CRUD via
 * UI form is deferred to J7.5. The 50 launch cards are seeded via
 * `scripts/seed-mark-douglas-cards.ts`; admin can publish/unpublish/delete
 * them from `/admin/cards`.
 */

export interface AdminCardActionState {
  ok: boolean;
  error?: 'unauthorized' | 'not_found' | 'slug_taken' | 'unknown';
}

type AdminGate = { ok: false; error: 'unauthorized' } | { ok: true; userId: string };

async function adminGate(): Promise<AdminGate> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'admin' || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  return { ok: true, userId: session.user.id };
}

export async function setPublishedAction(
  cardId: string,
  published: boolean,
): Promise<AdminCardActionState> {
  const gate = await adminGate();
  if (!gate.ok) return gate;

  if (typeof cardId !== 'string' || cardId.length === 0 || cardId.length > 64) {
    return { ok: false, error: 'unknown' };
  }
  if (typeof published !== 'boolean') {
    return { ok: false, error: 'unknown' };
  }

  try {
    await setPublished(cardId, published);
    await logAudit({
      action: published ? 'douglas.card.published' : 'douglas.card.unpublished',
      userId: gate.userId,
      metadata: { cardId },
    });
    revalidatePath('/admin/cards');
    revalidatePath('/library');
    return { ok: true };
  } catch (err) {
    if (err instanceof CardNotFoundError) return { ok: false, error: 'not_found' };
    console.error('[admin.cards.setPublished] failed', err);
    return { ok: false, error: 'unknown' };
  }
}

export async function deleteCardAction(cardId: string): Promise<AdminCardActionState> {
  const gate = await adminGate();
  if (!gate.ok) return gate;

  if (typeof cardId !== 'string' || cardId.length === 0 || cardId.length > 64) {
    return { ok: false, error: 'unknown' };
  }

  try {
    await deleteCard(cardId);
    await logAudit({
      action: 'douglas.card.deleted',
      userId: gate.userId,
      metadata: { cardId },
    });
    revalidatePath('/admin/cards');
    revalidatePath('/library');
    return { ok: true };
  } catch (err) {
    if (err instanceof CardNotFoundError) return { ok: false, error: 'not_found' };
    if (err instanceof CardSlugTakenError) return { ok: false, error: 'slug_taken' };
    console.error('[admin.cards.delete] failed', err);
    return { ok: false, error: 'unknown' };
  }
}
