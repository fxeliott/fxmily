/**
 * Seed script for Mark Douglas cards (J7).
 *
 * Idempotent: each card is upserted by `slug`. Re-running the script keeps
 * existing favorites/deliveries intact (the cards table is the parent —
 * cascading FK only fires on hard delete, which we never do here).
 *
 * Usage (PowerShell, from repo root):
 *
 *   $env:DATABASE_URL = "postgresql://fxmily:fxmily_dev@localhost:5432/fxmily?schema=public"
 *   pnpm --filter @fxmily/web exec tsx scripts/seed-mark-douglas-cards.ts
 *
 * Pattern: same shape as `seed-admin.ts` — instantiates a fresh PrismaClient
 * with `@prisma/adapter-pg` so the script can run via `tsx` outside the Next
 * runtime (the `lib/db.ts` singleton is `import 'server-only'` and would fail).
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import type { CardCreateInput } from '../src/lib/schemas/card.js';

import { MARK_DOUGLAS_CARDS_SEED } from './data/cards.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[seed:cards] Missing env var ${name}.`);
    process.exit(2);
  }
  return v;
}

async function main() {
  const databaseUrl = required('DATABASE_URL');
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter });

  console.log(`[seed:cards] starting — ${MARK_DOUGLAS_CARDS_SEED.length} cards to upsert`);

  let created = 0;
  let updated = 0;
  let errors = 0;

  try {
    for (const card of MARK_DOUGLAS_CARDS_SEED) {
      try {
        const result = await upsertCard(db, card);
        if (result === 'created') created++;
        else updated++;
      } catch (err) {
        errors++;
        console.error(`[seed:cards] FAILED ${card.slug}:`, err);
      }
    }
  } finally {
    await db.$disconnect();
  }

  console.log(
    `[seed:cards] done — created=${created} updated=${updated} errors=${errors} total=${MARK_DOUGLAS_CARDS_SEED.length}`,
  );
  if (errors > 0) process.exit(1);
}

async function upsertCard(
  db: PrismaClient,
  input: CardCreateInput,
): Promise<'created' | 'updated'> {
  const existing = await db.markDouglasCard.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });

  const data = {
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
    hatClass: input.hatClass ?? 'white',
    priority: input.priority ?? 5,
    published: input.published ?? false,
  };

  if (existing) {
    await db.markDouglasCard.update({
      where: { slug: input.slug },
      data,
    });
    return 'updated';
  }
  await db.markDouglasCard.create({ data });
  return 'created';
}

main().catch((err) => {
  console.error('[seed:cards] fatal', err);
  process.exit(1);
});
