/**
 * Coaching domain of the demo dataset — the psychological Mark Douglas layer.
 *
 * Surfaces fed (and the read contract each one needs to render):
 *   - `Alert` (repetition alerts) →
 *       • `listRecentAlertsForMember` (verification/alerts.ts) — dashboard
 *         `HubDriftSignal` + /verification feed (30-day window, label from
 *         `ALERT_LABELS`).
 *       • `getMentalMap` (coaching/service.ts) — the « carte mentale » only turns
 *         a *non-dismissed* alert into an entry when `triggerType` is one of the
 *         five `*_repeat` keys of `ALERT_COPY` (mental-map.ts). We therefore seed
 *         live alerts on those exact trigger types so MentalMapCard renders.
 *   - `MarkDouglasDelivery` →
 *       • `listMyDeliveries` / `countUnseenDeliveries` / `listUnseenDeliveryCardIds`
 *         (cards/service.ts) — `DouglasInboxWidget` (dashboard), /library hero
 *         "X nouvelles" badge + grid "Nouvelle" badge, /library/inbox list.
 *       Statuses are varied: seen+helpful, seen+not-helpful, unseen (inbox),
 *       dismissed. Some carry `sourceAlertId` (alert-driven, category
 *       discipline/ego — the S3→S5 junction), the rest are routine pushes.
 *   - `MarkDouglasFavorite` → `listMyFavorites` (cards/service.ts, filtered to
 *       published) — /library hero "X favoris" + /library/favorites.
 *   - `MentalMicroObjective` →
 *       • `getOpenMicroObjective` → MicroObjectiveCard (≤1 open).
 *       • `listRecentMicroObjectives` → EvolutionTraceCard (closed history).
 *       • `getMicroObjectiveProgress` → coaching insight kept-rate.
 *       The DB enforces ≤1 `open` per member (partial unique index); we honour it
 *       by seeding exactly one `open` row (most recent) and closing all the rest.
 *
 * triggerSnapshot shape (mirrors the production write-site `dispatchDouglasForAlert`):
 *   { kind: 'verification_alert', triggerType, motif: { discrepancyTypes,
 *     repeatCount, threshold, cardCategory } }            ← alert-driven
 *   { kind: 'routine', reason }                            ← routine push
 *
 * Idempotent: UPSERT on the two @@unique tables (delivery on
 * userId_cardId_triggeredOn, favorite on userId_cardId); alerts and
 * micro-objectives are reset (deleteMany) then re-created so re-runs converge.
 */
import type { DouglasCategory } from '../../src/generated/prisma/enums.js';
import { type SeedCtx, dbDate, at, makePrng } from './_shared.js';

// MentalAxis values (mirror lib/coaching/mental-map.ts — bounded server-side).
type MentalAxis = 'discipline' | 'honesty' | 'ego' | 'consistency';

// Curated micro-objective titles (mirror MICRO_OBJECTIVE_TITLES in
// lib/coaching/micro-objective.ts — the member-facing copy captured at creation).
const MICRO_TITLES: Record<MentalAxis, string> = {
  discipline: 'Tenir ta routine, un jour à la fois',
  honesty: 'Rester honnête avec toi-même',
  ego: 'Regarder les faits en face, sans te juger',
  consistency: 'Faire de la régularité ton edge silencieux',
};

// =============================================================================
// Alerts (repetition) — the S3 matter the coaching layer builds on.
// =============================================================================

/** One repetition-alert spec. `triggerType` ∈ ALERT_RULES keys (alerts.ts). */
interface AlertSpec {
  readonly triggerType: string;
  readonly repeatCount: number;
  readonly threshold: number;
  readonly status: 'open' | 'delivered' | 'dismissed';
  /** Days back for createdAt (kept ≤30 so the member feed surfaces them). */
  readonly daysAgo: number;
  /** Coaching card category for an alert-driven delivery (discipline | ego). */
  readonly cardCategory: 'discipline' | 'ego';
  readonly discrepancyTypes: readonly string[];
}

const ALERT_SPECS: readonly AlertSpec[] = [
  // Oldest live alert — already delivered, drives an EGO mental-map entry.
  {
    triggerType: 'reality_gap_repeat',
    repeatCount: 3,
    threshold: 3,
    status: 'delivered',
    daysAgo: 26,
    cardCategory: 'ego',
    discrepancyTypes: ['missing_declared', 'mismatch'],
  },
  // Mid-window — delivered, drives a DISCIPLINE entry.
  {
    triggerType: 'forgot_no_reason_repeat',
    repeatCount: 4,
    threshold: 3,
    status: 'delivered',
    daysAgo: 14,
    cardCategory: 'discipline',
    discrepancyTypes: ['unfilled_no_reason'],
  },
  // Dismissed by the member — present in the feed, but NOT in the mental map
  // (buildMentalMap skips `dismissed`). Shows the "écarté" path.
  {
    triggerType: 'meeting_missed_repeat',
    repeatCount: 3,
    threshold: 3,
    status: 'dismissed',
    daysAgo: 9,
    cardCategory: 'discipline',
    discrepancyTypes: ['meeting_missed_no_reason'],
  },
  // Most recent — still `open` (no card slot was free that day): admin sees it,
  // and it drives the current top mental-map entry (honesty / false declaration).
  {
    triggerType: 'false_declaration_repeat',
    repeatCount: 2,
    threshold: 2,
    status: 'open',
    daysAgo: 3,
    cardCategory: 'ego',
    discrepancyTypes: ['false_declared'],
  },
];

async function seedAlerts(
  ctx: SeedCtx,
): Promise<{ count: number; byTrigger: Record<string, string> }> {
  const { db, userId, now } = ctx;
  // Reset prior demo alerts so re-runs converge (cascade also frees deliveries'
  // sourceAlertId via onDelete: SetNull, but we re-link below before any read).
  await db.alert.deleteMany({ where: { memberId: userId } });

  /** triggerType → created alert id (so deliveries can carry sourceAlertId). */
  const byTrigger: Record<string, string> = {};
  for (const spec of ALERT_SPECS) {
    const createdAt = at(now, spec.daysAgo, 11, 30);
    const row = await db.alert.create({
      data: {
        memberId: userId,
        triggerType: spec.triggerType,
        repeatCount: spec.repeatCount,
        threshold: spec.threshold,
        category: 'psychological',
        status: spec.status,
        createdAt,
        updatedAt: createdAt,
      },
      select: { id: true },
    });
    byTrigger[spec.triggerType] = row.id;
  }
  return { count: ALERT_SPECS.length, byTrigger };
}

// =============================================================================
// Mark Douglas deliveries — the inbox / library feed.
// =============================================================================

type DeliveryStatus = 'seen-helpful' | 'seen-unhelpful' | 'unseen' | 'dismissed';

/** A delivery to seed, paired (later) with a concrete published card. */
interface DeliveryPlan {
  readonly daysAgo: number;
  readonly status: DeliveryStatus;
  /** When set, links to the alert of this triggerType (S3→S5 junction). */
  readonly sourceTrigger?: string;
  /** FR member-visible label. */
  readonly triggeredBy: string;
  /** Card category to pick from (kept coherent with the trigger). */
  readonly category: DouglasCategory;
  readonly discrepancyTypes?: readonly string[];
  readonly threshold?: number;
  readonly repeatCount?: number;
}

const DELIVERY_PLANS: readonly DeliveryPlan[] = [
  // ---- Alert-driven deliveries (carry sourceAlertId) ----------------------
  {
    daysAgo: 26,
    status: 'seen-helpful',
    sourceTrigger: 'reality_gap_repeat',
    triggeredBy: 'Plusieurs écarts répétés entre ton déclaré et ton historique réel',
    category: 'ego',
    discrepancyTypes: ['missing_declared', 'mismatch'],
    threshold: 3,
    repeatCount: 3,
  },
  {
    daysAgo: 14,
    status: 'seen-helpful',
    sourceTrigger: 'forgot_no_reason_repeat',
    triggeredBy: 'Plusieurs journées sans suivi, sans motif',
    category: 'discipline',
    discrepancyTypes: ['unfilled_no_reason'],
    threshold: 3,
    repeatCount: 4,
  },
  // ---- Routine deliveries (sourceAlertId null) ----------------------------
  {
    daysAgo: 40,
    status: 'seen-helpful',
    triggeredBy: 'Fiche du jour — accepter l’incertitude',
    category: 'acceptance',
  },
  {
    daysAgo: 33,
    status: 'seen-unhelpful',
    triggeredBy: 'Fiche du jour — la perte fait partie du jeu',
    category: 'loss',
  },
  {
    daysAgo: 20,
    status: 'dismissed',
    triggeredBy: 'Fiche du jour — revenir au process',
    category: 'process',
  },
  {
    daysAgo: 11,
    status: 'seen-helpful',
    triggeredBy: 'Fiche du jour — la discipline est une architecture',
    category: 'discipline',
  },
  // ---- Recent UNSEEN deliveries (light the inbox + "Nouvelle" badges) ------
  {
    daysAgo: 4,
    status: 'unseen',
    triggeredBy: 'Fiche du jour — détacher ton identité du résultat',
    category: 'ego',
  },
  {
    daysAgo: 1,
    status: 'unseen',
    triggeredBy: 'Fiche du jour — chaque instant est unique',
    category: 'acceptance',
  },
];

async function seedDeliveries(
  ctx: SeedCtx,
  alertsByTrigger: Record<string, string>,
): Promise<{ count: number; unseen: number; cardsByCategory: Map<DouglasCategory, string[]> }> {
  const { db, userId, now } = ctx;
  const rand = makePrng(6011);

  // Pull a pool of published cards per category we touch (real slugs/ids).
  const categories: DouglasCategory[] = Array.from(new Set(DELIVERY_PLANS.map((p) => p.category)));
  const pool = await db.markDouglasCard.findMany({
    where: { published: true, category: { in: categories } },
    select: { id: true, category: true },
    orderBy: { priority: 'desc' },
  });
  const cardsByCategory = new Map<DouglasCategory, string[]>();
  for (const c of pool) {
    const list = cardsByCategory.get(c.category) ?? [];
    list.push(c.id);
    cardsByCategory.set(c.category, list);
  }

  // Assign a DISTINCT card per plan from its category pool so the
  // (userId, cardId, triggeredOn) unique key never collides between plans.
  const used = new Set<string>();
  const pickCardFor = (category: DouglasCategory): string | null => {
    const list = cardsByCategory.get(category);
    if (!list || list.length === 0) return null;
    const free = list.find((id) => !used.has(id));
    const chosen = free ?? list[Math.floor(rand() * list.length)];
    if (chosen === undefined) return null;
    used.add(chosen);
    return chosen;
  };

  let count = 0;
  let unseen = 0;
  for (const plan of DELIVERY_PLANS) {
    const cardId = pickCardFor(plan.category);
    if (cardId === null) continue; // category empty in this DB → skip (defensive)

    const triggeredOn = dbDate(now, plan.daysAgo);
    const createdAt = at(now, plan.daysAgo, 7, 15);
    const sourceAlertId =
      plan.sourceTrigger !== undefined ? (alertsByTrigger[plan.sourceTrigger] ?? null) : null;

    // triggerSnapshot: mirror the production shapes (never PII).
    const triggerSnapshot =
      plan.sourceTrigger !== undefined
        ? {
            kind: 'verification_alert',
            triggerType: plan.sourceTrigger,
            motif: {
              discrepancyTypes: [...(plan.discrepancyTypes ?? [])],
              repeatCount: plan.repeatCount ?? 0,
              threshold: plan.threshold ?? 0,
              cardCategory: plan.category,
            },
          }
        : { kind: 'routine', reason: 'daily_card' };

    // Status → seenAt / dismissedAt / helpful (mirror cards/service.ts updates).
    const seenAt = plan.status === 'unseen' ? null : at(now, plan.daysAgo, 18, 40);
    const dismissedAt = plan.status === 'dismissed' ? at(now, plan.daysAgo, 18, 41) : null;
    const helpful =
      plan.status === 'seen-helpful' ? true : plan.status === 'seen-unhelpful' ? false : null;
    if (plan.status === 'unseen') unseen += 1;

    // exactOptionalPropertyTypes: build optional fields conditionally (never `undefined`).
    const optional: {
      sourceAlertId?: string;
      seenAt?: Date;
      dismissedAt?: Date;
      helpful?: boolean;
    } = {};
    if (sourceAlertId !== null) optional.sourceAlertId = sourceAlertId;
    if (seenAt !== null) optional.seenAt = seenAt;
    if (dismissedAt !== null) optional.dismissedAt = dismissedAt;
    if (helpful !== null) optional.helpful = helpful;

    await db.markDouglasDelivery.upsert({
      where: { userId_cardId_triggeredOn: { userId, cardId, triggeredOn } },
      create: {
        userId,
        cardId,
        triggeredBy: plan.triggeredBy,
        triggerSnapshot,
        triggeredOn,
        createdAt,
        ...optional,
      },
      update: {
        triggeredBy: plan.triggeredBy,
        triggerSnapshot,
        // Reset status fields so re-runs converge to the planned state.
        sourceAlertId: optional.sourceAlertId ?? null,
        seenAt: optional.seenAt ?? null,
        dismissedAt: optional.dismissedAt ?? null,
        helpful: optional.helpful ?? null,
      },
    });
    count += 1;
  }

  return { count, unseen, cardsByCategory };
}

// =============================================================================
// Favorites — manual stars on cards.
// =============================================================================

async function seedFavorites(
  ctx: SeedCtx,
  cardsByCategory: Map<DouglasCategory, string[]>,
  rand: () => number,
): Promise<{ count: number }> {
  const { db, userId, now } = ctx;

  // Star a few cards across categories the member engaged with. listMyFavorites
  // filters to published, so any of these (all published) render. The starred
  // card index is drawn from the shared 601 stream (deterministic).
  const wanted: Array<{ category: DouglasCategory; daysAgo: number }> = [
    { category: 'acceptance', daysAgo: 38 },
    { category: 'discipline', daysAgo: 13 },
    { category: 'ego', daysAgo: 5 },
  ];

  let count = 0;
  for (const w of wanted) {
    const list = cardsByCategory.get(w.category);
    if (!list || list.length === 0) continue;
    const idx = Math.floor(rand() * list.length);
    const cardId = list[idx] ?? list[0];
    if (cardId === undefined) continue;
    await db.markDouglasFavorite.upsert({
      where: { userId_cardId: { userId, cardId } },
      create: { userId, cardId, createdAt: at(now, w.daysAgo, 19, 0) },
      update: {},
    });
    count += 1;
  }
  return { count };
}

// =============================================================================
// Mental micro-objectives — the « boucle d'engagement » (≤1 open, DB-enforced).
// =============================================================================

interface MicroPlan {
  readonly axis: MentalAxis;
  readonly sourceKind: 'alert' | 'signal';
  /** alertId trigger key (resolved to id) for 'alert', or score reason for 'signal'. */
  readonly sourceTrigger?: string;
  readonly sourceRef?: string;
  readonly intention: string;
  readonly status: 'open' | 'kept' | 'missed' | 'dismissed';
  readonly createdDaysAgo: number;
  /** Days back for closedAt (closed states only). */
  readonly closedDaysAgo: number | null;
}

const MICRO_PLANS: readonly MicroPlan[] = [
  // Oldest — followed through (kept). Discipline, born from a signal.
  {
    axis: 'discipline',
    sourceKind: 'signal',
    sourceRef: 'forgot_no_reason',
    intention:
      'Refais ton prochain check-in à l’heure. Une routine se répare par le geste suivant, jamais par la culpabilité.',
    status: 'kept',
    createdDaysAgo: 30,
    closedDaysAgo: 23,
  },
  // Born from the EGO repetition alert — not held (missed = progression datum).
  {
    axis: 'ego',
    sourceKind: 'alert',
    sourceTrigger: 'reality_gap_repeat',
    intention:
      'Reprends un écart signalé et nomme-le honnêtement, sans te juger. Voir le fait, c’est déjà commencer à le désamorcer.',
    status: 'missed',
    createdDaysAgo: 21,
    closedDaysAgo: 14,
  },
  // Member set this one aside (dismissed).
  {
    axis: 'consistency',
    sourceKind: 'signal',
    sourceRef: 'tracking_skipped',
    intention: 'Choisis UN suivi en retard et remplis-le maintenant.',
    status: 'dismissed',
    createdDaysAgo: 13,
    closedDaysAgo: 9,
  },
  // Recent discipline loop — kept.
  {
    axis: 'discipline',
    sourceKind: 'signal',
    sourceRef: 'forgot_no_reason',
    intention: 'Ce soir, remplis ton bilan — même en une seule ligne.',
    status: 'kept',
    createdDaysAgo: 8,
    closedDaysAgo: 4,
  },
  // THE single OPEN loop (most recent) — born from the live honesty alert.
  {
    axis: 'honesty',
    sourceKind: 'alert',
    sourceTrigger: 'false_declaration_repeat',
    intention:
      'À ta prochaine déclaration, note seulement ce qui s’est réellement passé. La vérité brute est ton meilleur allié.',
    status: 'open',
    createdDaysAgo: 2,
    closedDaysAgo: null,
  },
];

async function seedMicroObjectives(
  ctx: SeedCtx,
  alertsByTrigger: Record<string, string>,
): Promise<{ count: number; open: number }> {
  const { db, userId, now } = ctx;
  // Reset so we never violate the partial unique « ≤1 open » index across re-runs.
  await db.mentalMicroObjective.deleteMany({ where: { memberId: userId } });

  let count = 0;
  let open = 0;
  for (const plan of MICRO_PLANS) {
    const sourceRef =
      plan.sourceKind === 'alert'
        ? ((plan.sourceTrigger !== undefined ? alertsByTrigger[plan.sourceTrigger] : undefined) ??
          plan.sourceTrigger ??
          'unknown')
        : (plan.sourceRef ?? 'unknown');

    const createdAt = at(now, plan.createdDaysAgo, 9, 0);
    const closedAt = plan.closedDaysAgo !== null ? at(now, plan.closedDaysAgo, 9, 5) : null;

    // exactOptionalPropertyTypes: only set closedAt when closed.
    const optional: { closedAt?: Date } = {};
    if (closedAt !== null) optional.closedAt = closedAt;

    await db.mentalMicroObjective.create({
      data: {
        memberId: userId,
        axis: plan.axis,
        sourceKind: plan.sourceKind,
        sourceRef,
        title: MICRO_TITLES[plan.axis],
        intention: plan.intention,
        status: plan.status,
        createdAt,
        updatedAt: closedAt ?? createdAt,
        ...optional,
      },
    });
    count += 1;
    if (plan.status === 'open') open += 1;
  }
  return { count, open };
}

// =============================================================================
// Orchestrator
// =============================================================================

export async function seedCoaching(ctx: SeedCtx): Promise<Record<string, number>> {
  const { log } = ctx;
  // Dedicated PRNG stream for this domain (sibling seeders use distinct seeds so
  // adding/removing one never shifts another's data). seedDeliveries derives its
  // own 6011 stream for card sampling; favorites draw from this top-level stream.
  const rand = makePrng(601);

  const alerts = await seedAlerts(ctx);
  const deliveries = await seedDeliveries(ctx, alerts.byTrigger);
  const favorites = await seedFavorites(ctx, deliveries.cardsByCategory, rand);
  const micro = await seedMicroObjectives(ctx, alerts.byTrigger);

  log(
    `  coaching: ${alerts.count} alerts, ${deliveries.count} deliveries ` +
      `(${deliveries.unseen} unseen), ${favorites.count} favorites, ` +
      `${micro.count} micro-objectives (${micro.open} open)`,
  );

  return {
    alerts: alerts.count,
    douglasDeliveries: deliveries.count,
    douglasUnseen: deliveries.unseen,
    douglasFavorites: favorites.count,
    microObjectives: micro.count,
    microObjectivesOpen: micro.open,
  };
}
