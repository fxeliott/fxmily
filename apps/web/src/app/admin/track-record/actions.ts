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
import {
  publicTradeCreateSchema,
  publicTradePartialSchema,
  publicTradeUpdateSchema,
} from '@/lib/schemas/public-trade';

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
// FormData → Zod input shapers
// =============================================================================

/**
 * Extrait + cast un champ FormData en string trimmé, ou `undefined` si vide.
 * Cap defensif à 2048 chars (anti-DoS — chaque field individuel borné, le
 * service en plus borne via Zod).
 */
function strField(fd: FormData, key: string, maxLen = 2048): string | undefined {
  const v = fd.get(key);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t.length === 0) return undefined;
  if (t.length > maxLen) return t.slice(0, maxLen);
  return t;
}

/**
 * Lit un boolean depuis FormData. HTML checkbox absente = false ; valeur
 * 'on'/'true'/'1' = true ; 'off'/'false'/'0' = false. Default = fallback.
 */
function boolField(fd: FormData, key: string, fallback = false): boolean {
  const v = fd.get(key);
  if (typeof v !== 'string') return fallback;
  const t = v.trim().toLowerCase();
  if (['on', 'true', '1', 'yes'].includes(t)) return true;
  if (['off', 'false', '0', 'no'].includes(t)) return false;
  return fallback;
}

/**
 * Parse un input `tags` en CSV (`news, FOMC, partagé`). Le service Zod tag
 * schema fait le trim + safeFreeText par tag. Cap 200 chars total brut
 * (anti-DoS — au-delà, Zod max 10 × 50 chars couvre).
 */
function tagsField(fd: FormData): string[] {
  const v = fd.get('tags');
  if (typeof v !== 'string') return [];
  const raw = v.trim();
  if (raw.length === 0) return [];
  return raw
    .slice(0, 200)
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

interface CommonInput {
  segment?: string | undefined;
  ordinal?: number | undefined;
  instrument?: string | undefined;
  direction?: string | null | undefined;
  enteredAt?: string | undefined;
  exitedAt?: string | null | undefined;
  riskPercent?: number | undefined;
  resultR?: number | null | undefined;
  status?: string | undefined;
  session?: string | null | undefined;
  setup?: string | null | undefined;
  tags?: string[] | undefined;
  notes?: string | null | undefined;
  screenshotUrl?: string | null | undefined;
  isPublished?: boolean | undefined;
}

/**
 * Construit un input object à partir de FormData. Les champs vides
 * deviennent `undefined` (Zod treats undefined as "not provided" → permet
 * d'avoir des optional schemas qui ne tombent pas sur `null` quand le user
 * laisse blank).
 *
 * Pour `nullable` fields (direction, exitedAt, etc.), le caller décide après
 * (sur create ils sont laissés undefined, sur update on les passe explicitement
 * en null si le user a coché "clear").
 */
function shapeFormData(fd: FormData): CommonInput {
  const ordinalRaw = strField(fd, 'ordinal', 16);
  const riskRaw = strField(fd, 'riskPercent', 16);
  const resultRRaw = strField(fd, 'resultR', 16);

  return {
    segment: strField(fd, 'segment', 32),
    ordinal: ordinalRaw !== undefined ? Number(ordinalRaw) : undefined,
    instrument: strField(fd, 'instrument', 32),
    direction: strField(fd, 'direction', 32),
    enteredAt: strField(fd, 'enteredAt', 64),
    exitedAt: strField(fd, 'exitedAt', 64),
    riskPercent: riskRaw !== undefined ? Number(riskRaw) : undefined,
    resultR: resultRRaw !== undefined ? Number(resultRRaw) : undefined,
    status: strField(fd, 'status', 32),
    session: strField(fd, 'session', 32),
    setup: strField(fd, 'setup', 200),
    tags: tagsField(fd),
    notes: strField(fd, 'notes', 4000),
    screenshotUrl: strField(fd, 'screenshotUrl', 1024),
    // T5 audit fix #14 — HTML checkbox absent = unchecked. Fallback DOIT être
    // `false`, sinon `<input type="checkbox" defaultChecked={false}>` non touché
    // par l'admin enverrait null → fallback `true` → impossible de créer un
    // brouillon. Le form set `defaultChecked={true}` au create (le browser
    // envoie 'on' tant que l'admin ne décoche pas) ⇒ default = published OK.
    isPublished: boolField(fd, 'isPublished', false),
  };
}

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
    console.error('[admin.track-record.create] failed', err);
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

  const shaped = shapeFormData(formData);
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
    console.error('[admin.track-record.update] failed', err);
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
    console.error('[admin.track-record.delete] failed', err);
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
    const updated = await setPublished(publicTradeId, published);
    await logAudit({
      action: published ? 'admin.public_trade.published' : 'admin.public_trade.unpublished',
      userId: gate.userId,
      metadata: { publicTradeId: updated.id, ordinal: updated.ordinal },
    });
    revalidatePath('/admin/track-record');
    return { ok: true };
  } catch (err) {
    if (err instanceof PublicTradeNotFoundError) return { ok: false, error: 'not_found' };
    console.error('[admin.track-record.setPublished] failed', err);
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
    revalidatePath(`/admin/track-record/${publicTradeId}/edit`);
    return {
      ok: true,
      id: partial.id,
      message: `Leg ${partial.closedAtR}R ajoutée.`,
    };
  } catch (err) {
    if (err instanceof PublicTradeNotFoundError) return { ok: false, error: 'not_found' };
    console.error('[admin.track-record.partial.create] failed', err);
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
    revalidatePath(`/admin/track-record/${publicTradeId}/edit`);
    return { ok: true };
  } catch (err) {
    if (err instanceof PublicTradePartialNotFoundError) return { ok: false, error: 'not_found' };
    console.error('[admin.track-record.partial.delete] failed', err);
    return { ok: false, error: 'unknown' };
  }
}
