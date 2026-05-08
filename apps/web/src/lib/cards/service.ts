import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { parseTriggerRule } from '@/lib/triggers/schema';

import type {
  CardExercise,
  CardListFilters,
  SerializedCard,
  SerializedDelivery,
  SerializedFavorite,
} from './types';

/**
 * Member-facing service for the Mark Douglas card module (J7).
 *
 * Trust boundary: every function takes `userId` explicitly — callers (Server
 * Actions, RSC pages) MUST pass the authenticated session ID, never trust an
 * input field. The service does NOT re-check auth (that's the route's job).
 *
 * Public surface:
 *   - Catalog browsing : `listPublishedCards`, `getCardBySlug`,
 *     `listCategories`.
 *   - My deliveries   : `listMyDeliveries`, `getDelivery`,
 *     `markDeliverySeen`, `markDeliveryDismissed`, `setDeliveryHelpful`,
 *     `countUnseenDeliveries`.
 *   - My favorites    : `toggleFavorite`, `listMyFavorites`,
 *     `isFavorite`.
 *
 * Posture: members see only `published=true` cards. Drafts are admin-only.
 */

export class CardNotFoundError extends Error {
  constructor(message = 'Card not found') {
    super(message);
    this.name = 'CardNotFoundError';
  }
}

export class DeliveryNotFoundError extends Error {
  constructor(message = 'Delivery not found') {
    super(message);
    this.name = 'DeliveryNotFoundError';
  }
}

// =============================================================================
// Catalog browsing
// =============================================================================

export async function listPublishedCards(filters: CardListFilters = {}): Promise<SerializedCard[]> {
  const rows = await db.markDouglasCard.findMany({
    where: {
      published: true,
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.q ? { title: { contains: filters.q, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(serializeCard);
}

export async function getPublishedCardBySlug(slug: string): Promise<SerializedCard | null> {
  const row = await db.markDouglasCard.findUnique({ where: { slug } });
  if (!row || !row.published) return null;
  return serializeCard(row);
}

/** Distinct list of categories that have at least one published card. */
export async function listPublishedCategories(): Promise<
  { category: SerializedCard['category']; count: number }[]
> {
  const rows = await db.markDouglasCard.groupBy({
    by: ['category'],
    where: { published: true },
    _count: { _all: true },
  });
  return rows.map((r) => ({ category: r.category, count: r._count._all }));
}

// =============================================================================
// My deliveries
// =============================================================================

export interface ListDeliveriesOptions {
  /** Limit number of rows returned. Default 50. */
  take?: number;
  /** Filter to unseen only (badge / dashboard prompt). */
  onlyUnseen?: boolean;
}

export async function listMyDeliveries(
  userId: string,
  options: ListDeliveriesOptions = {},
): Promise<SerializedDelivery[]> {
  const take = options.take ?? 50;
  const rows = await db.markDouglasDelivery.findMany({
    where: { userId, ...(options.onlyUnseen ? { seenAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      card: { select: { slug: true, title: true, category: true } },
    },
  });
  return rows.map(serializeDelivery);
}

export async function countUnseenDeliveries(userId: string): Promise<number> {
  return db.markDouglasDelivery.count({ where: { userId, seenAt: null } });
}

export async function getDelivery(
  userId: string,
  deliveryId: string,
): Promise<SerializedDelivery | null> {
  const row = await db.markDouglasDelivery.findFirst({
    where: { id: deliveryId, userId },
    include: { card: { select: { slug: true, title: true, category: true } } },
  });
  return row === null ? null : serializeDelivery(row);
}

export async function getDeliveryByCardSlug(
  userId: string,
  slug: string,
): Promise<SerializedDelivery | null> {
  const row = await db.markDouglasDelivery.findFirst({
    where: { userId, card: { slug } },
    orderBy: { createdAt: 'desc' },
    include: { card: { select: { slug: true, title: true, category: true } } },
  });
  return row === null ? null : serializeDelivery(row);
}

/**
 * Mark a delivery as seen if it's not already. Idempotent: re-calling with an
 * already-seen delivery is a no-op. Returns whether the row actually changed
 * — caller can audit only on `true`.
 */
export async function markDeliverySeen(userId: string, deliveryId: string): Promise<boolean> {
  const result = await db.markDouglasDelivery.updateMany({
    where: { id: deliveryId, userId, seenAt: null },
    data: { seenAt: new Date() },
  });
  return result.count > 0;
}

/** Mark all the user's unseen deliveries for `cardId` as seen (used when the
 *  reader page opens that card). */
export async function markDeliveriesForCardSeen(userId: string, cardId: string): Promise<number> {
  const result = await db.markDouglasDelivery.updateMany({
    where: { userId, cardId, seenAt: null },
    data: { seenAt: new Date() },
  });
  return result.count;
}

export async function markDeliveryDismissed(userId: string, deliveryId: string): Promise<boolean> {
  const result = await db.markDouglasDelivery.updateMany({
    where: { id: deliveryId, userId, dismissedAt: null },
    data: { dismissedAt: new Date(), seenAt: new Date() },
  });
  return result.count > 0;
}

export async function setDeliveryHelpful(
  userId: string,
  deliveryId: string,
  helpful: boolean,
): Promise<boolean> {
  const result = await db.markDouglasDelivery.updateMany({
    where: { id: deliveryId, userId },
    data: { helpful },
  });
  return result.count > 0;
}

// =============================================================================
// Favorites
// =============================================================================

/**
 * Toggle a favorite. Returns the new state (`true` = favorited, `false` = removed).
 *
 * Catches Prisma P2002 / P2025 to make the operation truly idempotent under
 * race conditions (rapid double-tap on the heart icon).
 */
export async function toggleFavorite(
  userId: string,
  cardId: string,
): Promise<{ favorited: boolean }> {
  const existing = await db.markDouglasFavorite.findUnique({
    where: { userId_cardId: { userId, cardId } },
  });
  if (existing) {
    try {
      await db.markDouglasFavorite.delete({
        where: { userId_cardId: { userId, cardId } },
      });
    } catch (err) {
      // P2025 = record not found — race; treat as already-deleted.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return { favorited: false };
      }
      throw err;
    }
    return { favorited: false };
  }
  // Verify card exists + is published before adding (members shouldn't
  // favorite drafts — drafts are admin-only).
  const card = await db.markDouglasCard.findUnique({
    where: { id: cardId },
    select: { id: true, published: true },
  });
  if (!card || !card.published) {
    throw new CardNotFoundError();
  }
  try {
    await db.markDouglasFavorite.create({
      data: { userId, cardId },
    });
  } catch (err) {
    // P2002 = unique violation (race) — already favorited.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { favorited: true };
    }
    throw err;
  }
  return { favorited: true };
}

export async function isFavorite(userId: string, cardId: string): Promise<boolean> {
  const row = await db.markDouglasFavorite.findUnique({
    where: { userId_cardId: { userId, cardId } },
    select: { userId: true },
  });
  return row !== null;
}

export async function listMyFavorites(userId: string): Promise<SerializedFavorite[]> {
  const rows = await db.markDouglasFavorite.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      card: { select: { slug: true, title: true, category: true, published: true } },
    },
  });
  return rows
    .filter((r) => r.card.published)
    .map((r) => ({
      userId: r.userId,
      cardId: r.cardId,
      cardSlug: r.card.slug,
      cardTitle: r.card.title,
      cardCategory: r.card.category,
      createdAt: r.createdAt.toISOString(),
    }));
}

// =============================================================================
// Serializers
// =============================================================================

interface CardRow {
  id: string;
  slug: string;
  title: string;
  category: SerializedCard['category'];
  quote: string;
  quoteSourceChapter: string;
  paraphrase: string;
  exercises: Prisma.JsonValue;
  triggerRules: Prisma.JsonValue | null;
  hatClass: string;
  priority: number;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeCard(row: CardRow): SerializedCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    quote: row.quote,
    quoteSourceChapter: row.quoteSourceChapter,
    paraphrase: row.paraphrase,
    exercises: parseExercises(row.exercises),
    triggerRules: parseTriggerRule(row.triggerRules),
    hatClass: row.hatClass === 'black' ? 'black' : 'white',
    priority: row.priority,
    published: row.published,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface DeliveryRow {
  id: string;
  userId: string;
  cardId: string;
  triggeredBy: string;
  triggeredOn: Date;
  seenAt: Date | null;
  dismissedAt: Date | null;
  helpful: boolean | null;
  createdAt: Date;
  card: { slug: string; title: string; category: SerializedCard['category'] };
}

export function serializeDelivery(row: DeliveryRow): SerializedDelivery {
  return {
    id: row.id,
    userId: row.userId,
    cardId: row.cardId,
    cardSlug: row.card.slug,
    cardTitle: row.card.title,
    cardCategory: row.card.category,
    triggeredBy: row.triggeredBy,
    triggeredOn: row.triggeredOn.toISOString().slice(0, 10),
    seenAt: row.seenAt ? row.seenAt.toISOString() : null,
    dismissedAt: row.dismissedAt ? row.dismissedAt.toISOString() : null,
    helpful: row.helpful,
    createdAt: row.createdAt.toISOString(),
  };
}

function parseExercises(raw: Prisma.JsonValue): CardExercise[] {
  if (!Array.isArray(raw)) {
    if (raw !== null && raw !== undefined) {
      console.warn('[cards.parseExercises] expected array, got', typeof raw);
    }
    return [];
  }
  const valid = raw.filter(
    (item): item is { id: string; label: string; description: string } =>
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).id === 'string' &&
      typeof (item as Record<string, unknown>).label === 'string' &&
      typeof (item as Record<string, unknown>).description === 'string',
  );
  if (valid.length !== raw.length) {
    console.warn(
      `[cards.parseExercises] dropped ${raw.length - valid.length}/${raw.length} invalid items`,
    );
  }
  return valid.map((item) => ({ id: item.id, label: item.label, description: item.description }));
}
