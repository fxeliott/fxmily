'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import {
  addPartial,
  createPublicTrade,
  deletePartial,
  deletePublicTrade,
  PublicTradeInvalidStateError,
  PublicTradeNotFoundError,
  PublicTradeOrdinalTakenError,
  PublicTradePartialNotFoundError,
  setPublished,
  updatePublicTrade,
} from '@/lib/admin/public-trade-service';
import { logAudit } from '@/lib/auth/audit';
import { reportError } from '@/lib/observability';
import {
  publicTradeCreateSchema,
  publicTradePartialSchema,
  publicTradeUpdateSchema,
} from '@/lib/schemas/public-trade';

import { shapeFormData, shapeFormDataForUpdate, strField } from './form-shapers';

/**
 * Admin Server Actions for the Public Track Record (T5).
 *
 * Pattern carbone J1+ (`app/admin/invite/actions.ts` + J7 `app/admin/cards/
 * actions.ts`) :
 *   - `adminGate()` discriminated union → unauthorized short-circuit.
 *   - Lecture FormData field-par-field (progressive enhancement — marche
 *     SANS JS via `<form action>` natif).
 *   - Zod `safeParse` à l'entrée (build l'input object, parse).
 *   - `logAudit` PII-free metadata (jamais notes free-text, jamais URL
 *     screenshot brute — storage key OK).
 *   - `revalidatePath('/admin/track-record')` post-mutation.
 *   - `NEXT_REDIRECT` re-throw obligatoire sur create (form → list).
 *
 * Differs from J7 cards :
 *   - Lifecycle invariants service-side (`PublicTradeInvalidStateError`) →
 *     `fieldErrors` retourné pour binding à l'input visuel.
 *   - Pas de `markBE` action dédiée V1 : le form principal envoie status =
 *     'break_even' + exitedAt=now + resultR=0 (KISS).
 */

export interface AdminTrackRecordActionState {
  ok: boolean;
  error?:
    | 'unauthorized'
    | 'not_found'
    | 'ordinal_taken'
    | 'invalid_state'
    | 'validation'
    | 'unknown';
  /** Map fieldPath → first error message. */
  fieldErrors?: Record<string, string>;
  /** Resource id retourné aux create/add. */
  id?: string;
  /** Free-form message (success/info). */
  message?: string;
}

type AdminGate = { ok: false; error: 'unauthorized' } | { ok: true; userId: string };

async function adminGate(): Promise<AdminGate> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'admin' || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  return { ok: true, userId: session.user.id };
}

/** Convertit `ZodError.issues` en map `fieldPath → first message`. */
function zodIssuesToFieldErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_root';
    if (!(key in map)) map[key] = issue.message;
  }
  return map;
}

// =============================================================================
// FormData → Zod input shapers — extracted to `./form-shapers.ts` for unit
// testability (this file is `'use server'` + drags `@/auth` graph; the
// extracted module is pure and importable from Vitest without `next-auth`).
// =============================================================================

// =============================================================================
// CRUD trade
// =============================================================================

export async function createPublicTradeAction(
  _prev: AdminTrackRecordActionState | null,
  formData: FormData,
): Promise<AdminTrackRecordActionState> {
  const gate = await adminGate();
  if (!gate.ok) return gate;

  const shaped = shapeFormData(formData);
  const parsed = publicTradeCreateSchema.safeParse(shaped);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation',
      fieldErrors: zodIssuesToFieldErrors(parsed.error.issues),
    };
  }

  try {
    const created = await createPublicTrade(parsed.data);
    await logAudit({
      action: 'admin.public_trade.created',
      userId: gate.userId,
      metadata: {
        publicTradeId: created.id,
        ordinal: created.ordinal,
        segment: created.segment,
        instrument: created.instrument,
        status: created.status,
      },
    });
    revalidatePath('/admin/track-record');
  } catch (err) {
    if (err instanceof PublicTradeOrdinalTakenError) {
      return { ok: false, error: 'ordinal_taken', fieldErrors: { ordinal: err.message } };
    }
    if (err instanceof PublicTradeInvalidStateError) {
      return { ok: false, error: 'invalid_state', fieldErrors: { [err.field]: err.message } };
    }
    reportError('admin.public_trade.create', err);
    return { ok: false, error: 'unknown' };
  }
  // Redirect post-create vers la list — enchaîne plusieurs ajouts.
  // OBLIGATOIRE hors du try/catch (NEXT_REDIRECT throw doit remonter).
  redirect('/admin/track-record');
}

export async function updatePublicTradeAction(
  _prev: AdminTrackRecordActionState | null,
  formData: FormData,
): Promise<AdminTrackRecordActionState> {
  const gate = await adminGate();
  if (!gate.ok) return gate;

  const id = formData.get('id');
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
    return { ok: false, error: 'validation', fieldErrors: { _root: 'ID invalide.' } };
  }

  const shaped = shapeFormDataForUpdate(formData);
  const parsed = publicTradeUpdateSchema.safeParse(shaped);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation',
      fieldErrors: zodIssuesToFieldErrors(parsed.error.issues),
    };
  }

  try {
    const updated = await updatePublicTrade(id, parsed.data);
    await logAudit({
      action: 'admin.public_trade.updated',
      userId: gate.userId,
      metadata: {
        publicTradeId: updated.id,
        ordinal: updated.ordinal,
        status: updated.status,
        fieldsChanged: Object.keys(parsed.data),
      },
    });
    revalidatePath('/admin/track-record');
    revalidatePath(`/admin/track-record/${id}/edit`);
    return {
      ok: true,
      id: updated.id,
      message: `Trade #${updated.ordinal} (${updated.instrument}) mis à jour.`,
    };
  } catch (err) {
    if (err instanceof PublicTradeNotFoundError) return { ok: false, error: 'not_found' };
    if (err instanceof PublicTradeOrdinalTakenError) {
      return { ok: false, error: 'ordinal_taken', fieldErrors: { ordinal: err.message } };
    }
    if (err instanceof PublicTradeInvalidStateError) {
      return { ok: false, error: 'invalid_state', fieldErrors: { [err.field]: err.message } };
    }
    reportError('admin.public_trade.update', err);
    return { ok: false, error: 'unknown' };
  }
}

/** Bound action carbone J7 `deleteCardAction`. */
export async function deletePublicTradeAction(
  publicTradeId: string,
): Promise<AdminTrackRecordActionState> {
  const gate = await adminGate();
  if (!gate.ok) return gate;

  if (
    typeof publicTradeId !== 'string' ||
    publicTradeId.length === 0 ||
    publicTradeId.length > 64
  ) {
    return { ok: false, error: 'validation' };
  }

  try {
    await deletePublicTrade(publicTradeId);
    await logAudit({
      action: 'admin.public_trade.deleted',
      userId: gate.userId,
      metadata: { publicTradeId },
    });
    revalidatePath('/admin/track-record');
    return { ok: true };
  } catch (err) {
    if (err instanceof PublicTradeNotFoundError) return { ok: false, error: 'not_found' };
    reportError('admin.public_trade.delete', err);
    return { ok: false, error: 'unknown' };
  }
}

/** Toggle publish — optimistic UI carbone J7 `setPublishedAction`. */
export async function setPublishedAction(
  publicTradeId: string,
  published: boolean,
): Promise<AdminTrackRecordActionState> {
  const gate = await adminGate();
  if (!gate.ok) return gate;

  if (
    typeof publicTradeId !== 'string' ||
    publicTradeId.length === 0 ||
    publicTradeId.length > 64
  ) {
    return { ok: false, error: 'validation' };
  }
  if (typeof published !== 'boolean') {
    return { ok: false, error: 'validation' };
  }

  try {
    // Phase H+7 — `setPublished` retourne `{ row, wasChanged }`. Si l'état
    // target == état actuel (toggle redondant), skip `logAudit` pour ne pas
    // spammer la timeline d'audit rows identiques. api-designer YELLOW #6
    // closure. Pattern : revalidatePath reste appelé (idempotent Next.js)
    // pour garantir que le client voit l'état canonique post-mutation.
    const { row: updated, wasChanged } = await setPublished(publicTradeId, published);
    if (wasChanged) {
      await logAudit({
        action: published ? 'admin.public_trade.published' : 'admin.public_trade.unpublished',
        userId: gate.userId,
        metadata: { publicTradeId: updated.id, ordinal: updated.ordinal },
      });
    }
    revalidatePath('/admin/track-record');
    return { ok: true };
  } catch (err) {
    if (err instanceof PublicTradeNotFoundError) return { ok: false, error: 'not_found' };
    reportError('admin.public_trade.set_published', err);
    return { ok: false, error: 'unknown' };
  }
}

// =============================================================================
// Partials — sub-form add/delete legs
// =============================================================================

interface PartialInput {
  closedAtR?: number | undefined;
  closedPercent?: number | undefined;
  closedAt?: string | undefined;
  notes?: string | null | undefined;
}

function shapePartialFormData(fd: FormData): PartialInput {
  const rRaw = strField(fd, 'closedAtR', 16);
  const pctRaw = strField(fd, 'closedPercent', 16);
  return {
    closedAtR: rRaw !== undefined ? Number(rRaw) : undefined,
    closedPercent: pctRaw !== undefined ? Number(pctRaw) : undefined,
    closedAt: strField(fd, 'closedAt', 64),
    notes: strField(fd, 'notes', 4000),
  };
}

export async function createPartialAction(
  _prev: AdminTrackRecordActionState | null,
  formData: FormData,
): Promise<AdminTrackRecordActionState> {
  const gate = await adminGate();
  if (!gate.ok) return gate;

  const publicTradeId = formData.get('publicTradeId');
  if (
    typeof publicTradeId !== 'string' ||
    publicTradeId.length === 0 ||
    publicTradeId.length > 64
  ) {
    return { ok: false, error: 'validation', fieldErrors: { _root: 'ID parent invalide.' } };
  }

  const shaped = shapePartialFormData(formData);
  const parsed = publicTradePartialSchema.safeParse(shaped);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation',
      fieldErrors: zodIssuesToFieldErrors(parsed.error.issues),
    };
  }

  try {
    const partial = await addPartial(publicTradeId, parsed.data);
    await logAudit({
      action: 'admin.public_trade.partial.created',
      userId: gate.userId,
      metadata: {
        publicTradeId,
        partialId: partial.id,
        closedAtR: partial.closedAtR,
        closedPercent: partial.closedPercent,
      },
    });
    // T5 audit Phase H — code-reviewer BLOQUANT-2 : la list `/admin/track-record`
    // affiche `partialsCount` via `<Pill>{n} leg(s)</Pill>`. Sans revalidate
    // ici, le badge reste stale jusqu'au prochain full reload.
    revalidatePath('/admin/track-record');
    revalidatePath(`/admin/track-record/${publicTradeId}/edit`);
    return {
      ok: true,
      id: partial.id,
      message: `Leg ${partial.closedAtR}R ajoutée.`,
    };
  } catch (err) {
    if (err instanceof PublicTradeNotFoundError) return { ok: false, error: 'not_found' };
    reportError('admin.public_trade.partial.create', err);
    return { ok: false, error: 'unknown' };
  }
}

export async function deletePartialAction(
  publicTradeId: string,
  partialId: string,
): Promise<AdminTrackRecordActionState> {
  const gate = await adminGate();
  if (!gate.ok) return gate;

  if (
    typeof publicTradeId !== 'string' ||
    publicTradeId.length === 0 ||
    publicTradeId.length > 64 ||
    typeof partialId !== 'string' ||
    partialId.length === 0 ||
    partialId.length > 64
  ) {
    return { ok: false, error: 'validation' };
  }

  try {
    await deletePartial(partialId);
    await logAudit({
      action: 'admin.public_trade.partial.deleted',
      userId: gate.userId,
      metadata: { publicTradeId, partialId },
    });
    // T5 audit Phase H — code-reviewer BLOQUANT-2 : symétrique à create —
    // refresh aussi la list pour le badge `partialsCount`.
    revalidatePath('/admin/track-record');
    revalidatePath(`/admin/track-record/${publicTradeId}/edit`);
    return { ok: true };
  } catch (err) {
    if (err instanceof PublicTradePartialNotFoundError) return { ok: false, error: 'not_found' };
    reportError('admin.public_trade.partial.delete', err);
    return { ok: false, error: 'unknown' };
  }
}
