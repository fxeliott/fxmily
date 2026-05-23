import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type {
  PublicTradeSegment,
  PublicTradeStatus,
  TradeDirection,
  TradeSession,
} from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { computeResultPercent, validateLifecycleInvariants } from '@/lib/admin/public-trade-math';
import type {
  PublicTradeCreateInput,
  PublicTradePartialInput,
  PublicTradeUpdateInput,
} from '@/lib/schemas/public-trade';

// Re-export pour les Server Actions / callers existants qui catchent
// l'erreur. Le runtime est identique (même classe extraite).
export { PublicTradeInvalidStateError } from '@/lib/admin/public-trade-math';

/**
 * Admin-facing service for the Public Track Record (`PublicTrade` /
 * `PublicTradePartial`) — T5.
 *
 * Trust boundary : assumes the caller has already verified
 * `session.user.role === 'admin'`. Routes / Server Actions enforce the gate,
 * the service does NOT re-check. Carbon-copy of `lib/admin/cards-service.ts`
 * (J7 canon).
 *
 * `PublicTrade` est monovendeur Eliott (cf. `prisma/schema.prisma:1442-1446`)
 * — pas de relation `User`, donc PAS de scoping `userId` ici (différencie de
 * `Trade` membre-scoped).
 *
 * Public surface :
 *   - CRUD trade        : `listPublicTrades`, `getPublicTradeById`,
 *                         `createPublicTrade`, `updatePublicTrade`,
 *                         `deletePublicTrade`, `setPublished`.
 *   - CRUD partial leg  : `addPartial`, `deletePartial`.
 *   - Stats             : `getCatalogStats`.
 */

// =============================================================================
// Custom errors — discriminable au catch
// =============================================================================

export class PublicTradeNotFoundError extends Error {
  constructor(message = 'Public trade not found') {
    super(message);
    this.name = 'PublicTradeNotFoundError';
  }
}

/** Levée quand `(ordinal)` unique constraint violée (P2002 Prisma). */
export class PublicTradeOrdinalTakenError extends Error {
  constructor(ordinal: number) {
    super(`Ordinal ${ordinal} déjà utilisé.`);
    this.name = 'PublicTradeOrdinalTakenError';
  }
}

export class PublicTradePartialNotFoundError extends Error {
  constructor(message = 'Public trade partial not found') {
    super(message);
    this.name = 'PublicTradePartialNotFoundError';
  }
}

// `PublicTradeInvalidStateError` est défini + re-exporté en haut du module
// (extrait vers `public-trade-math.ts` pour la testabilité pure).

// =============================================================================
// Serialized types — Decimal → string + Date → ISO pour client components
// =============================================================================

export interface SerializedPublicTrade {
  id: string;
  segment: PublicTradeSegment;
  ordinal: number;
  instrument: string;
  direction: TradeDirection | null;
  enteredAt: string;
  exitedAt: string | null;
  riskPercent: string;
  resultR: string | null;
  resultPercent: string | null;
  status: PublicTradeStatus;
  session: TradeSession | null;
  setup: string | null;
  tags: string[];
  notes: string | null;
  screenshotUrl: string | null;
  source: string;
  isPublished: boolean;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  partialsCount: number;
}

export interface SerializedPublicTradePartial {
  id: string;
  publicTradeId: string;
  closedAtR: string;
  closedPercent: string;
  closedAt: string;
  notes: string | null;
  createdAt: string;
}

export interface SerializedPublicTradeWithPartials extends SerializedPublicTrade {
  partials: SerializedPublicTradePartial[];
}

// =============================================================================
// List + read
// =============================================================================

export interface PublicTradeListFilters {
  segment?: PublicTradeSegment | undefined;
  status?: PublicTradeStatus | undefined;
  instrument?: string | undefined;
  /** `true` = published only, `false` = drafts only, `undefined` = all. */
  published?: boolean | undefined;
  /** ILIKE on instrument or setup. */
  q?: string | undefined;
}

export async function listPublicTrades(
  filters: PublicTradeListFilters = {},
): Promise<SerializedPublicTrade[]> {
  const rows = await db.publicTrade.findMany({
    where: {
      ...(filters.segment ? { segment: filters.segment } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.instrument ? { instrument: filters.instrument } : {}),
      ...(filters.published !== undefined ? { isPublished: filters.published } : {}),
      ...(filters.q
        ? {
            OR: [
              { instrument: { contains: filters.q, mode: 'insensitive' as const } },
              { setup: { contains: filters.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ ordinal: 'desc' }],
    include: { _count: { select: { partials: true } } },
  });
  return rows.map(serializePublicTrade);
}

export async function getPublicTradeById(
  id: string,
): Promise<SerializedPublicTradeWithPartials | null> {
  const row = await db.publicTrade.findUnique({
    where: { id },
    include: {
      partials: { orderBy: { closedAt: 'asc' } },
      _count: { select: { partials: true } },
    },
  });
  if (!row) return null;
  return {
    ...serializePublicTrade(row),
    partials: row.partials.map(serializePartial),
  };
}

// =============================================================================
// Create / Update / Delete
// =============================================================================

export async function createPublicTrade(
  input: PublicTradeCreateInput,
): Promise<SerializedPublicTrade> {
  // Lifecycle invariants déjà validés par Zod superRefine. On calcule
  // resultPercent + on auto-derive l'ordinal si absent.
  const resolvedOrdinal = input.ordinal ?? (await nextOrdinal());
  const resultPercent = computeResultPercent(input.status, input.riskPercent, input.resultR);
  try {
    const row = await db.publicTrade.create({
      data: {
        segment: input.segment,
        ordinal: resolvedOrdinal,
        instrument: input.instrument,
        direction: input.direction ?? null,
        enteredAt: input.enteredAt,
        exitedAt: input.exitedAt ?? null,
        riskPercent: new Prisma.Decimal(input.riskPercent),
        resultR: input.resultR != null ? new Prisma.Decimal(input.resultR) : null,
        resultPercent: resultPercent != null ? new Prisma.Decimal(resultPercent) : null,
        status: input.status,
        session: input.session ?? null,
        setup: input.setup ?? null,
        tags: input.tags,
        notes: input.notes ?? null,
        screenshotUrl: input.screenshotUrl ?? null,
        source: 'admin',
        isPublished: input.isPublished,
      },
      include: { _count: { select: { partials: true } } },
    });
    return serializePublicTrade(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new PublicTradeOrdinalTakenError(resolvedOrdinal);
    }
    throw err;
  }
}

export async function updatePublicTrade(
  id: string,
  input: PublicTradeUpdateInput,
): Promise<SerializedPublicTrade> {
  // Lifecycle re-validation post-merge contre l'état DB. Le superRefine Zod
  // sur update est lax (champs optionnels) — c'est ici qu'on enforce les
  // invariants finaux après merge.
  const existing = await db.publicTrade.findUnique({ where: { id } });
  if (!existing) throw new PublicTradeNotFoundError();

  const merged = {
    status: input.status ?? existing.status,
    enteredAt: input.enteredAt ?? existing.enteredAt,
    exitedAt: input.exitedAt !== undefined ? input.exitedAt : existing.exitedAt,
    riskPercent: input.riskPercent ?? Number(existing.riskPercent),
    resultR:
      input.resultR !== undefined
        ? input.resultR
        : existing.resultR != null
          ? Number(existing.resultR)
          : null,
  };

  validateLifecycleInvariants(merged);

  const recomputed = computeResultPercent(merged.status, merged.riskPercent, merged.resultR);

  try {
    const row = await db.publicTrade.update({
      where: { id },
      data: {
        ...(input.segment !== undefined ? { segment: input.segment } : {}),
        ...(input.ordinal !== undefined ? { ordinal: input.ordinal } : {}),
        ...(input.instrument !== undefined ? { instrument: input.instrument } : {}),
        ...(input.direction !== undefined ? { direction: input.direction } : {}),
        ...(input.enteredAt !== undefined ? { enteredAt: input.enteredAt } : {}),
        ...(input.exitedAt !== undefined ? { exitedAt: input.exitedAt } : {}),
        ...(input.riskPercent !== undefined
          ? { riskPercent: new Prisma.Decimal(input.riskPercent) }
          : {}),
        ...(input.resultR !== undefined
          ? { resultR: input.resultR != null ? new Prisma.Decimal(input.resultR) : null }
          : {}),
        // resultPercent toujours recomputé pour rester cohérent avec
        // status/risk/R (single source of truth — pas un champ form).
        resultPercent: recomputed != null ? new Prisma.Decimal(recomputed) : null,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.session !== undefined ? { session: input.session } : {}),
        ...(input.setup !== undefined ? { setup: input.setup } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.screenshotUrl !== undefined ? { screenshotUrl: input.screenshotUrl } : {}),
        ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
      },
      include: { _count: { select: { partials: true } } },
    });
    return serializePublicTrade(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new PublicTradeOrdinalTakenError(input.ordinal ?? existing.ordinal);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new PublicTradeNotFoundError();
    }
    throw err;
  }
}

export async function deletePublicTrade(id: string): Promise<void> {
  try {
    // Cascade Prisma supprime les partials automatiquement (FK onDelete:
    // Cascade cf. schema.prisma:1519).
    await db.publicTrade.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new PublicTradeNotFoundError();
    }
    throw err;
  }
}

/**
 * Result envelope for `setPublished` — Phase H+7 idempotence.
 *
 * `wasChanged: false` quand l'état target == état actuel (toggle redondant).
 * Permet à l'action caller de skip `logAudit` pour éviter le spam d'audit
 * rows identiques (api-designer YELLOW #6 closure) — un admin qui clique
 * 5× sur "Publier" sur un trade déjà publié ne pollue plus la timeline
 * audit. Pattern carbone le canon J5 (`enqueueCheckinReminder` skip-if-
 * already-enqueued) + observability hygiene.
 */
export interface SetPublishedResult {
  row: SerializedPublicTrade;
  wasChanged: boolean;
}

export async function setPublished(id: string, published: boolean): Promise<SetPublishedResult> {
  // T5 audit Phase H — code-reviewer BLOQUANT-3 : `publishedAt` est la
  // chronologie publique du track-record (la valeur la plus exposée du
  // module). Bumper à chaque republish = destruction silencieuse du signal.
  // Fix : set-once at first publish — preserve la date d'origine sur tout
  // republish ultérieur. On lit l'état existant pour décider.
  //
  // Phase H+7 — `select` étendu pour récupérer `isPublished` (en plus de
  // `publishedAt`) afin de calculer `wasChanged`. Coût query identique
  // (toujours 1 column extra, négligeable).
  const existing = await db.publicTrade.findUnique({
    where: { id },
    select: { publishedAt: true, isPublished: true },
  });
  if (!existing) throw new PublicTradeNotFoundError();

  const wasChanged = existing.isPublished !== published;

  try {
    const row = await db.publicTrade.update({
      where: { id },
      data: {
        isPublished: published,
        // Bump `publishedAt` UNIQUEMENT au tout premier publish (existing null).
        // Republish d'un trade déjà publié-puis-unpublished préserve la date.
        // Unpublish ne touche jamais `publishedAt` (historique conservé).
        ...(published && existing.publishedAt === null ? { publishedAt: new Date() } : {}),
      },
      include: { _count: { select: { partials: true } } },
    });
    return { row: serializePublicTrade(row), wasChanged };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new PublicTradeNotFoundError();
    }
    throw err;
  }
}

// =============================================================================
// Partials — legs successives (TP1/TP2/...)
// =============================================================================

export async function addPartial(
  publicTradeId: string,
  input: PublicTradePartialInput,
): Promise<SerializedPublicTradePartial> {
  // Vérifie d'abord que le trade parent existe — sinon Prisma renverrait
  // P2003 (FK violation) qu'on devrait re-mapper. Plus clean en 2 queries
  // qu'en try/catch du P2003.
  const parent = await db.publicTrade.findUnique({
    where: { id: publicTradeId },
    select: { id: true },
  });
  if (!parent) throw new PublicTradeNotFoundError();

  const row = await db.publicTradePartial.create({
    data: {
      publicTradeId,
      closedAtR: new Prisma.Decimal(input.closedAtR),
      closedPercent: new Prisma.Decimal(input.closedPercent),
      closedAt: input.closedAt,
      notes: input.notes ?? null,
    },
  });
  return serializePartial(row);
}

export async function deletePartial(partialId: string): Promise<void> {
  try {
    await db.publicTradePartial.delete({ where: { id: partialId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new PublicTradePartialNotFoundError();
    }
    throw err;
  }
}

// =============================================================================
// Stats — admin dashboard header strip
// =============================================================================

export interface PublicTradeCatalogStats {
  total: number;
  historical: number;
  live: number;
  drafts: number;
  open: number;
  closed: number;
  breakEven: number;
}

export async function getCatalogStats(): Promise<PublicTradeCatalogStats> {
  const [total, historical, live, drafts, open, closed, breakEven] = await Promise.all([
    db.publicTrade.count(),
    db.publicTrade.count({ where: { segment: 'historical' } }),
    db.publicTrade.count({ where: { segment: 'live' } }),
    db.publicTrade.count({ where: { isPublished: false } }),
    db.publicTrade.count({ where: { status: 'open' } }),
    db.publicTrade.count({ where: { status: 'closed' } }),
    db.publicTrade.count({ where: { status: 'break_even' } }),
  ]);
  return { total, historical, live, drafts, open, closed, breakEven };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Auto-derive l'ordinal du prochain trade (MAX(ordinal) + 1). Si la table est
 * vide → retourne 1. Race-safe : si 2 admins créent simultanément, le 2e
 * recevra P2002 → `PublicTradeOrdinalTakenError` côté action (UX retry).
 */
async function nextOrdinal(): Promise<number> {
  const top = await db.publicTrade.findFirst({
    orderBy: { ordinal: 'desc' },
    select: { ordinal: true },
  });
  return top ? top.ordinal + 1 : 1;
}

// =============================================================================
// Serializers — Decimal → string, Date → ISO
// =============================================================================

interface PublicTradeRow {
  id: string;
  segment: PublicTradeSegment;
  ordinal: number;
  instrument: string;
  direction: TradeDirection | null;
  enteredAt: Date;
  exitedAt: Date | null;
  riskPercent: Prisma.Decimal;
  resultR: Prisma.Decimal | null;
  resultPercent: Prisma.Decimal | null;
  status: PublicTradeStatus;
  session: TradeSession | null;
  setup: string | null;
  tags: string[];
  notes: string | null;
  screenshotUrl: string | null;
  source: string;
  isPublished: boolean;
  publishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  _count?: { partials: number };
}

export function serializePublicTrade(row: PublicTradeRow): SerializedPublicTrade {
  return {
    id: row.id,
    segment: row.segment,
    ordinal: row.ordinal,
    instrument: row.instrument,
    direction: row.direction,
    enteredAt: row.enteredAt.toISOString(),
    exitedAt: row.exitedAt ? row.exitedAt.toISOString() : null,
    riskPercent: row.riskPercent.toString(),
    resultR: row.resultR ? row.resultR.toString() : null,
    resultPercent: row.resultPercent ? row.resultPercent.toString() : null,
    status: row.status,
    session: row.session,
    setup: row.setup,
    tags: row.tags,
    notes: row.notes,
    screenshotUrl: row.screenshotUrl,
    source: row.source,
    isPublished: row.isPublished,
    publishedAt: row.publishedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    partialsCount: row._count?.partials ?? 0,
  };
}

interface PartialRow {
  id: string;
  publicTradeId: string;
  closedAtR: Prisma.Decimal;
  closedPercent: Prisma.Decimal;
  closedAt: Date;
  notes: string | null;
  createdAt: Date;
}

export function serializePartial(row: PartialRow): SerializedPublicTradePartial {
  return {
    id: row.id,
    publicTradeId: row.publicTradeId,
    closedAtR: row.closedAtR.toString(),
    closedPercent: row.closedPercent.toString(),
    closedAt: row.closedAt.toISOString(),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}
