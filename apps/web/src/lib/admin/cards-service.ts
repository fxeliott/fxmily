import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { serializeCard, serializeDelivery, CardNotFoundError } from '@/lib/cards/service';
import type { CardListFilters, SerializedCard, SerializedDelivery } from '@/lib/cards/types';
import type { CardCreateInput, CardUpdateInput } from '@/lib/schemas/card';

/**
 * Admin-facing service for the Mark Douglas card module (J7).
 *
 * Trust boundary: assumes the caller has already verified `session.user.role
 * === 'admin'`. Routes / Server Actions enforce the gate; this module does
 * not re-check.
 *
 * Public surface:
 *   - CRUD: `listAllCards`, `getCardById`, `createCard`, `updateCard`,
 *     `deleteCard`, `setPublished`.
 *   - Member analytics : `listMemberDeliveries`, `aggregateDeliveryStats`.
 */

export class CardSlugTakenError extends Error {
  constructor(slug: string) {
    super(`Slug already in use: ${slug}`);
    this.name = 'CardSlugTakenError';
  }
}

// =============================================================================
// CRUD
// =============================================================================

export async function listAllCards(filters: CardListFilters = {}): Promise<SerializedCard[]> {
  const rows = await db.markDouglasCard.findMany({
    where: {
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.published !== undefined ? { published: filters.published } : {}),
      ...(filters.q ? { title: { contains: filters.q, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ published: 'desc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
  });
  return rows.map(serializeCard);
}

export async function getCardById(id: string): Promise<SerializedCard | null> {
  const row = await db.markDouglasCard.findUnique({ where: { id } });
  return row === null ? null : serializeCard(row);
}

export async function createCard(input: CardCreateInput): Promise<SerializedCard> {
  try {
    const row = await db.markDouglasCard.create({
      data: {
        slug: input.slug,
        title: input.title,
        category: input.category,
        quote: input.quote,
        quoteSourceChapter: input.quoteSourceChapter,
        paraphrase: input.paraphrase,
        exercises: input.exercises as unknown as Prisma.InputJsonValue,
        triggerRules:
          input.triggerRules === null
            ? Prisma.JsonNull
            : (input.triggerRules as unknown as Prisma.InputJsonValue),
        hatClass: input.hatClass,
        priority: input.priority,
        published: input.published,
      },
    });
    return serializeCard(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CardSlugTakenError(input.slug);
    }
    throw err;
  }
}

export async function updateCard(id: string, input: CardUpdateInput): Promise<SerializedCard> {
  try {
    const row = await db.markDouglasCard.update({
      where: { id },
      data: {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.quote !== undefined ? { quote: input.quote } : {}),
        ...(input.quoteSourceChapter !== undefined
          ? { quoteSourceChapter: input.quoteSourceChapter }
          : {}),
        ...(input.paraphrase !== undefined ? { paraphrase: input.paraphrase } : {}),
        ...(input.exercises !== undefined
          ? { exercises: input.exercises as unknown as Prisma.InputJsonValue }
          : {}),
        ...(input.triggerRules !== undefined
          ? {
              triggerRules:
                input.triggerRules === null
                  ? Prisma.JsonNull
                  : (input.triggerRules as unknown as Prisma.InputJsonValue),
            }
          : {}),
        ...(input.hatClass !== undefined ? { hatClass: input.hatClass } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.published !== undefined ? { published: input.published } : {}),
      },
    });
    return serializeCard(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CardSlugTakenError(input.slug ?? '<unknown>');
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new CardNotFoundError();
    }
    throw err;
  }
}

export async function deleteCard(id: string): Promise<void> {
  try {
    await db.markDouglasCard.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new CardNotFoundError();
    }
    throw err;
  }
}

export async function setPublished(id: string, published: boolean): Promise<SerializedCard> {
  try {
    const row = await db.markDouglasCard.update({
      where: { id },
      data: { published },
    });
    return serializeCard(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new CardNotFoundError();
    }
    throw err;
  }
}

// =============================================================================
// Member analytics — admin viewing one member's MD activity
// =============================================================================

export async function listMemberDeliveries(
  memberId: string,
  options: { take?: number } = {},
): Promise<SerializedDelivery[]> {
  const take = options.take ?? 50;
  const rows = await db.markDouglasDelivery.findMany({
    where: { userId: memberId },
    orderBy: { createdAt: 'desc' },
    take,
    include: { card: { select: { slug: true, title: true, category: true } } },
  });
  return rows.map(serializeDelivery);
}

export interface MemberDeliveryAggregate {
  total: number;
  unread: number;
  helpful: number;
  notHelpful: number;
  dismissed: number;
}

export async function aggregateMemberDeliveryStats(
  memberId: string,
): Promise<MemberDeliveryAggregate> {
  const [total, unread, helpful, notHelpful, dismissed] = await Promise.all([
    db.markDouglasDelivery.count({ where: { userId: memberId } }),
    db.markDouglasDelivery.count({ where: { userId: memberId, seenAt: null } }),
    db.markDouglasDelivery.count({ where: { userId: memberId, helpful: true } }),
    db.markDouglasDelivery.count({ where: { userId: memberId, helpful: false } }),
    db.markDouglasDelivery.count({
      where: { userId: memberId, dismissedAt: { not: null } },
    }),
  ]);
  return { total, unread, helpful, notHelpful, dismissed };
}

// =============================================================================
// Catalog stats (admin dashboard / cron)
// =============================================================================

export interface CatalogStats {
  totalCards: number;
  publishedCards: number;
  draftCards: number;
  cardsWithTriggers: number;
}

export async function getCatalogStats(): Promise<CatalogStats> {
  const [totalCards, publishedCards, cardsWithTriggers] = await Promise.all([
    db.markDouglasCard.count(),
    db.markDouglasCard.count({ where: { published: true } }),
    db.markDouglasCard.count({ where: { triggerRules: { not: Prisma.JsonNull } } }),
  ]);
  return {
    totalCards,
    publishedCards,
    draftCards: totalCards - publishedCards,
    cardsWithTriggers,
  };
}
