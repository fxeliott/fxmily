/**
 * Smoke test for the J7 Mark Douglas dispatch pipeline.
 *
 * Validates SPEC §15 J7 "Done quand" criteria:
 *   - Une bibliothèque de fiches est en DB.
 *   - Un système de déclencheurs JSON déterministes est en place.
 *   - Pages `/library` + `/library/[slug]` + `/admin/cards` fonctionnelles.
 *   - **Critère final** : un membre qui clôture 3 trades perdants consécutifs
 *     voit la fiche "sortir-du-tilt" apparaître dans ses fiches suggérées.
 *
 * Pattern: instantiates a fresh PrismaClient (same as `seed-mark-douglas-cards`)
 * and replays the engine's pure logic locally — engine.ts is `server-only` so
 * tsx can't import it. The PURE evaluators and cooldown can however be imported
 * since they don't carry the marker.
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/lib/auth/password.js';
import {
  isOnCooldown,
  pickBestMatch,
  type DeliveryHistoryEntry,
} from '../src/lib/triggers/cooldown.js';
import { evaluateTrigger } from '../src/lib/triggers/evaluators.js';
import { parseTriggerRule } from '../src/lib/triggers/schema.js';
import { isHatClass, type HatClass, type TriggerContext } from '../src/lib/triggers/types.js';

const TEST_EMAIL = 'j7smoke.member.e2e.test@fxmily.local';
const TEST_PASSWORD = 'J7SmokePwd-2026!';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[smoke:j7] Missing env var ${name}.`);
    process.exit(2);
  }
  return v;
}

function localDateOf(instant: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

async function main() {
  const databaseUrl = required('DATABASE_URL');
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter });

  let pass = true;
  const failures: string[] = [];

  try {
    // 0. Cleanup any prior test artefacts.
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    console.log('[smoke:j7] step 0 — cleanup OK');

    // 1. Pre-conditions.
    const tiltCard = await db.markDouglasCard.findUnique({
      where: { slug: 'sortir-du-tilt' },
      select: {
        id: true,
        slug: true,
        published: true,
        triggerRules: true,
        priority: true,
        hatClass: true,
      },
    });
    if (!tiltCard) {
      failures.push('card slug=sortir-du-tilt not in DB — run seed first');
      pass = false;
    } else if (!tiltCard.published) {
      failures.push('card sortir-du-tilt is not published');
      pass = false;
    } else {
      console.log('[smoke:j7] step 1 — sortir-du-tilt present + published');
    }
    if (!pass) {
      console.error('[smoke:j7] aborting:', failures);
      process.exit(1);
    }

    // 2. Create fresh test member.
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const member = await db.user.create({
      data: {
        email: TEST_EMAIL,
        firstName: 'Smoke',
        lastName: 'Member',
        passwordHash,
        role: 'member',
        status: 'active',
        timezone: 'Europe/Paris',
      },
    });
    console.log(`[smoke:j7] step 2 — member created id=${member.id}`);

    // 3. Insert 3 closed losing trades (recent).
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const enteredAt = new Date(now.getTime() - (3 - i) * 60 * 60 * 1000);
      const exitedAt = new Date(enteredAt.getTime() + 30 * 60 * 1000);
      await db.trade.create({
        data: {
          userId: member.id,
          pair: 'EURUSD',
          direction: 'long',
          session: 'london',
          enteredAt,
          entryPrice: new Prisma.Decimal('1.0850'),
          lotSize: new Prisma.Decimal('0.10'),
          stopLossPrice: new Prisma.Decimal('1.0820'),
          plannedRR: new Prisma.Decimal('2.00'),
          emotionBefore: ['confident'],
          planRespected: true,
          hedgeRespected: null,
          screenshotEntryKey: null,
          exitedAt,
          exitPrice: new Prisma.Decimal('1.0820'),
          outcome: 'loss',
          realizedR: new Prisma.Decimal('-1.00'),
          realizedRSource: 'computed',
          emotionAfter: ['frustrated'],
          screenshotExitKey: null,
          closedAt: exitedAt,
        },
      });
    }
    console.log('[smoke:j7] step 3 — 3 losing trades inserted');

    // 4. Replay the engine pipeline locally.
    const todayLocal = localDateOf(now, 'Europe/Paris');
    const trades = await db.trade.findMany({
      where: { userId: member.id },
      select: {
        closedAt: true,
        exitedAt: true,
        enteredAt: true,
        outcome: true,
        session: true,
        planRespected: true,
        hedgeRespected: true,
        emotionBefore: true,
        emotionAfter: true,
      },
    });
    const cards = await db.markDouglasCard.findMany({
      where: { published: true, NOT: { triggerRules: { equals: null as unknown as object } } },
      select: { id: true, slug: true, priority: true, hatClass: true, triggerRules: true },
    });
    console.log(`[smoke:j7] step 4 — fetched ${trades.length} trades + ${cards.length} cards`);

    const ctx: TriggerContext = {
      now,
      timezone: 'Europe/Paris',
      todayLocal,
      recentClosedTrades: trades.filter((t) => t.closedAt !== null),
      recentAllTrades: trades,
      recentCheckins: [],
      userCreatedAt: member.createdAt,
    };

    type Match = {
      cardId: string;
      slug: string;
      priority: number;
      hatClass: HatClass;
      triggeredBy: string;
      snapshot: object;
    };
    const matches: Match[] = [];
    for (const c of cards) {
      const rule = parseTriggerRule(c.triggerRules);
      if (!rule) continue;
      const r = evaluateTrigger(rule, ctx);
      if (r.matched) {
        matches.push({
          cardId: c.id,
          slug: c.slug,
          priority: c.priority,
          hatClass: isHatClass(c.hatClass) ? c.hatClass : 'white',
          triggeredBy: r.triggeredBy,
          snapshot: r.snapshot,
        });
      }
    }
    console.log(
      `[smoke:j7] step 4 — ${matches.length} cards matched: ${matches.map((m) => m.slug).join(', ')}`,
    );

    const history: DeliveryHistoryEntry[] = [];
    const eligible = matches.filter((m) => !isOnCooldown(m.cardId, m.hatClass, history, now));
    const picked = pickBestMatch({
      matched: eligible.map((m) => ({ id: m.cardId, priority: m.priority, hatClass: m.hatClass })),
      history,
      now,
    });
    if (!picked) {
      failures.push('no card picked');
      pass = false;
    } else {
      const winner = matches.find((m) => m.cardId === picked.cardId)!;
      if (winner.slug !== 'sortir-du-tilt') {
        failures.push(`picked "${winner.slug}" instead of "sortir-du-tilt"`);
        pass = false;
      } else {
        // Persist the delivery.
        await db.markDouglasDelivery.create({
          data: {
            userId: member.id,
            cardId: winner.cardId,
            triggeredBy: winner.triggeredBy,
            triggerSnapshot: winner.snapshot as unknown as Prisma.InputJsonValue,
            triggeredOn: parseLocalDate(todayLocal),
          },
        });
        console.log(
          `[smoke:j7] step 4 — sortir-du-tilt picked + persisted: "${winner.triggeredBy}"`,
        );
      }
    }

    // 5. Verify delivery row.
    const deliveries = await db.markDouglasDelivery.findMany({
      where: { userId: member.id },
      include: { card: { select: { slug: true } } },
    });
    if (deliveries.length === 0) {
      failures.push('no delivery row in DB');
      pass = false;
    } else {
      console.log(
        `[smoke:j7] step 5 — ${deliveries.length} delivery: ${deliveries.map((d) => d.card.slug).join(', ')}`,
      );
    }

    // 6. Idempotency: re-attempt the persist for same (user, card, day) — should fail with P2002.
    let p2002Caught = false;
    try {
      await db.markDouglasDelivery.create({
        data: {
          userId: member.id,
          cardId: tiltCard!.id,
          triggeredBy: 'duplicate test',
          triggerSnapshot: {} as Prisma.InputJsonValue,
          triggeredOn: parseLocalDate(todayLocal),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        p2002Caught = true;
      }
    }
    if (!p2002Caught) {
      failures.push('idempotency unique index NOT enforced');
      pass = false;
    } else {
      console.log('[smoke:j7] step 6 — P2002 unique idempotency enforced ✓');
    }

    // 7. Cleanup.
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    console.log('[smoke:j7] step 7 — cleanup OK');
  } finally {
    await db.$disconnect();
  }

  if (pass) {
    console.log('\n[smoke:j7] ALL GREEN — J7 critère "Done quand" validé en live.');
    process.exit(0);
  } else {
    console.error('\n[smoke:j7] FAILED:', failures);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[smoke:j7] fatal', err);
  process.exit(1);
});
