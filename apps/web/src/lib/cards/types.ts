/**
 * Mark Douglas card service types (J7).
 *
 * `Serialized*` shapes are the JSON-safe variants passed to client components
 * (Decimal → string, Date → ISO, JSON → typed). Same convention as
 * `lib/trades/service.ts` `SerializedTrade`.
 */

import type { DouglasCategory } from '@/generated/prisma/enums';

import type { TriggerRule } from '@/lib/triggers/types';

export interface CardExercise {
  id: string;
  label: string;
  description: string;
}

export interface SerializedCard {
  id: string;
  slug: string;
  title: string;
  category: DouglasCategory;
  quote: string;
  quoteSourceChapter: string;
  paraphrase: string;
  exercises: CardExercise[];
  triggerRules: TriggerRule | null;
  hatClass: 'white' | 'black';
  priority: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedDelivery {
  id: string;
  userId: string;
  cardId: string;
  cardSlug: string;
  cardTitle: string;
  cardCategory: DouglasCategory;
  triggeredBy: string;
  triggeredOn: string; // YYYY-MM-DD
  seenAt: string | null;
  dismissedAt: string | null;
  helpful: boolean | null;
  createdAt: string;
}

export interface SerializedFavorite {
  userId: string;
  cardId: string;
  cardSlug: string;
  cardTitle: string;
  cardCategory: DouglasCategory;
  createdAt: string;
}

export interface CardListFilters {
  category?: DouglasCategory;
  published?: boolean;
  /** Optional text search on title (case-insensitive). */
  q?: string;
}
